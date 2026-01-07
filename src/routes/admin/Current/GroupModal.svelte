<script>
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking } from './schedule.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const dispatch = createEventDispatcher()

  let show = $state(false)
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let groupRooms = $state([])
  let timeslots = $state([])
  let saving = $state(false)
  let selectedStudents = $state([])
  let maxStudentsAllowed = $state(0)
  let searchTerm = $state('')
  let dataLoaded = $state(false)

  // Get week days (Tue-Fri)
  const getWeekDays = (startDate, endDate) => {
    const days = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay()
      if (dayOfWeek >= 2 && dayOfWeek <= 5) {
        days.push(new Date(d).toISOString().split('T')[0])
      }
    }
    return days
  }

  // Show modal method (called from parent)
  export function showModal() {
    show = true

    if (!dataLoaded) {
      loadAllData()
    }

    // Initialize selected students from booking data
    if (booking?.data?.mode === 'edit' && Array.isArray(booking.data.students)) {
      selectedStudents = booking.data.students.map((student) => student.id || student).filter((id) => id)
    } else {
      selectedStudents = []
    }

    setMaxStudentsAllowed()
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
  }

  const loadAllData = async () => {
    if (dataLoaded) return

    try {
      const [subjectsData, studentsData, teachersData, groupRoomsData, timeslotsData] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }),
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('groupRoom').getFullList({ sort: 'name', fields: 'id,name,maxstudents' }),
        pb.collection('timeslot').getFullList({ sort: 'start', fields: 'id,start,end' }),
      ])

      subjects = subjectsData
      students = studentsData
      teachers = teachersData
      groupRooms = groupRoomsData
      timeslots = timeslotsData
      dataLoaded = true
    } catch (err) {
      console.error('Error loading data:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  const checkForConflicts = async () => {
    const { teacher, timeslot, startDate, endDate, groupRoom, mode } = booking.data

    if (!teacher?.id || !timeslot?.id || !startDate || !endDate || !groupRoom?.id) return true

    try {
      const weekDays = getWeekDays(startDate, endDate)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Get IDs of schedules being edited to exclude them
      let excludeIds = []

      if (mode === 'edit') {
        const originalTeacherId = booking.data.originalTeacherId || teacher.id
        const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
        const originalGroupRoomId = booking.data.originalGroupRoomId || groupRoom.id

        // Get all schedules for this week that belong to the original booking
        const existingSchedules = await pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `teacher = "${originalTeacherId}" && timeslot = "${originalTimeslotId}" && grouproom = "${originalGroupRoomId}" && (${dateFilter})`,
            fields: 'id',
            $autoCancel: false,
          })
          .catch(() => [])

        excludeIds = existingSchedules.map((s) => s.id)
      }

      // Build filters
      let teacherGroupFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && teacher = "${teacher.id}"`
      let studentGroupFilter = `(${dateFilter}) && timeslot = "${timeslot.id}"`
      let roomGroupFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && grouproom = "${groupRoom.id}"`

      // Exclude all schedules from the original booking when editing
      if (excludeIds.length > 0) {
        const excludeFilter = excludeIds.map((id) => `id != "${id}"`).join(' && ')
        teacherGroupFilter += ` && (${excludeFilter})`
        studentGroupFilter += ` && (${excludeFilter})`
        roomGroupFilter += ` && (${excludeFilter})`
      }

      const [teacherIndividualBookings, teacherGroupBookings, studentRecords] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: `(${dateFilter}) && timeslot = "${timeslot.id}" && teacher = "${teacher.id}"`,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: teacherGroupFilter,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => []),

        pb
          .collection('student')
          .getFullList({
            filter: 'id != ""',
            fields: 'id,englishName',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      const studentMap = new Map()
      studentRecords.forEach((s) => studentMap.set(s.id, s.englishName))

      // Check for teacher conflict
      const teacherConflict = teacherIndividualBookings[0] || teacherGroupBookings[0]

      if (teacherConflict) {
        const teacherName =
          teacherConflict.expand?.teacher?.name ||
          teachers.find((t) => t.id === teacherConflict.teacher)?.name ||
          'Unknown Teacher'

        const isGroupLesson = Array.isArray(teacherConflict.student)

        if (isGroupLesson) {
          const studentCount = teacherConflict.student?.length || 0
          toast.error(`${teacherName} is already teaching a group lesson (${studentCount} students) for this timeslot`)
        } else {
          const studentId = teacherConflict.student
          const studentName =
            teacherConflict.expand?.student?.englishName || studentMap.get(studentId) || 'Unknown Student'
          toast.error(`${teacherName} is already booked with ${studentName} for this timeslot`)
        }
        return false
      }

      // Check for student conflicts (only check selected students)
      if (selectedStudents.length > 0) {
        // Check individual bookings for student conflicts
        const studentIndividualFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && (${selectedStudents.map((id) => `student = "${id}"`).join(' || ')})`

        const studentIndividualBookings = await pb
          .collection('lessonSchedule')
          .getFullList({
            filter: studentIndividualFilter,
            expand: 'teacher,student',
            $autoCancel: false,
          })
          .catch(() => [])

        // Check group bookings for student conflicts (excludes current booking schedules)
        const studentGroupBookings = await pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: studentGroupFilter,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => [])

        // Find conflicted students
        for (const studentId of selectedStudents) {
          // Check individual bookings
          const individualConflict = studentIndividualBookings.find((b) => b.student === studentId)
          if (individualConflict) {
            const studentName = studentMap.get(studentId) || 'Unknown Student'
            const teacherName = individualConflict.expand?.teacher?.name || 'Unknown Teacher'
            toast.error(`${studentName} is already booked with ${teacherName} for this timeslot`)
            return false
          }

          // Check group bookings (already excludes current booking schedules)
          const groupConflict = studentGroupBookings.find(
            (b) => Array.isArray(b.student) && b.student.includes(studentId)
          )
          if (groupConflict) {
            const studentName = studentMap.get(studentId) || 'Unknown Student'
            const teacherName = groupConflict.expand?.teacher?.name || 'Unknown Teacher'
            toast.error(`${studentName} is already in a group lesson with ${teacherName} for this timeslot`)
            return false
          }
        }
      }

      // Check for room conflicts (excludes current booking schedules)
      const roomGroupBookings = await pb
        .collection('groupLessonSchedule')
        .getFullList({
          filter: roomGroupFilter,
          expand: 'teacher',
          $autoCancel: false,
        })
        .catch(() => [])

      // Check group room bookings
      const roomConflict = roomGroupBookings[0]
      if (roomConflict) {
        const teacherName = roomConflict.expand?.teacher?.name || 'Unknown Teacher'
        const studentCount = Array.isArray(roomConflict.student) ? roomConflict.student.length : 0
        toast.error(`Room is already occupied by a group lesson with ${teacherName} (${studentCount} students)`)
        return false
      }

      return true
    } catch (error) {
      console.error('Error checking conflicts:', error)
      return true // Allow save on error
    }
  }

  const validateForm = () => {
    const { subject, groupRoom, teacher, timeslot, startDate, endDate } = booking.data

    if (!subject?.id) {
      toast.error('Please select Subject')
      return false
    }

    if (!groupRoom?.id) {
      toast.error('Please select Group Room')
      return false
    }

    if (!teacher?.id) {
      toast.error('Please select Teacher')
      return false
    }

    if (!timeslot?.id) {
      toast.error('Please select Timeslot')
      return false
    }

    if (!startDate) {
      toast.error('Please select Start Date')
      return false
    }

    if (!endDate) {
      toast.error('Please select End Date')
      return false
    }

    if (!Array.isArray(selectedStudents) || selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return false
    }

    // Validate date range
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (start > end) {
      toast.error('Start date must be before end date')
      return false
    }

    return true
  }

  function setMaxStudentsAllowed() {
    if (booking?.data?.groupRoom?.id && Array.isArray(groupRooms) && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === booking.data.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = booking?.data?.groupRoom?.maxstudents || 0
    }
  }

  function onGroupRoomChange() {
    setMaxStudentsAllowed()
    if (selectedStudents.length > maxStudentsAllowed && maxStudentsAllowed > 0) {
      selectedStudents = selectedStudents.slice(0, maxStudentsAllowed)
      toast.warning(`Student selection limited to ${maxStudentsAllowed} students for this room`)
    }
  }

  function toggleStudent(studentId) {
    // Check if student is graduated
    const student = students.find((s) => s.id === studentId)
    if (student?.status === 'graduated' && !selectedStudents.includes(studentId)) {
      toast.error('Cannot select graduated student')
      return
    }

    if (selectedStudents.includes(studentId)) {
      selectedStudents = selectedStudents.filter((id) => id !== studentId)
    } else {
      if (maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed) {
        toast.warning(`Maximum ${maxStudentsAllowed} students allowed for this room`)
        return
      }
      selectedStudents = [...selectedStudents, studentId]
    }
  }

  function selectAllStudents() {
    // Filter out graduated students only
    const availableStudents = students.filter((s) => s.status !== 'graduated')

    if (maxStudentsAllowed > 0) {
      selectedStudents = availableStudents.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (availableStudents.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} available students due to room limit`)
      }
    } else {
      selectedStudents = availableStudents.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  const saveSchedule = async () => {
    if (!validateForm()) return

    // Check for conflicts and show toast if found
    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { subject, groupRoom, teacher, timeslot, mode, startDate, endDate } = booking.data
    const weekDays = getWeekDays(startDate, endDate)

    const scheduleData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: selectedStudents,
      subject: subject.id,
      grouproom: groupRoom.id,
    }

    toast.promise(
      async () => {
        if (mode === 'edit') {
          const originalTeacherId = booking.data.originalTeacherId || teacher.id
          const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
          const originalGroupRoomId = booking.data.originalGroupRoomId || groupRoom.id

          const existingWeekSchedules = await pb.collection('groupLessonSchedule').getFullList({
            filter: `teacher = "${originalTeacherId}" && timeslot = "${originalTimeslotId}" && grouproom = "${originalGroupRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
          })

          // Update all schedules for the week
          await Promise.all(
            existingWeekSchedules.map((schedule) =>
              pb.collection('groupLessonSchedule').update(schedule.id, { ...scheduleData, date: schedule.date })
            )
          )

          return 'Weekly group schedule updated!'
        } else {
          // Create all schedules for the week
          await Promise.all(
            weekDays.map((date) => pb.collection('groupLessonSchedule').create({ ...scheduleData, date }))
          )

          return 'Weekly group schedule created!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          closeModal()
          dispatch('refresh')
          return 'Group schedule saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
  }

  const deleteSchedule = async () => {
    const { startDate, endDate, subject, teacher, groupRoom, timeslot } = booking.data
    const weekDays = getWeekDays(startDate, endDate)

    const confirmMessage =
      `Are you sure you want to delete this WEEKLY group schedule?\n\n` +
      `Week: ${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}\n` +
      `Days: Tuesday - Friday (${weekDays.length} lessons)\n` +
      `Subject: ${subject.name}\n` +
      `Teacher: ${teacher.name}\n` +
      `Students: ${selectedStudents.length} students\n` +
      `Room: ${groupRoom.name}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n\n` +
      `This will delete ALL ${weekDays.length} group lessons for this week. This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    toast.promise(
      async () => {
        const originalTeacherId = booking.data.originalTeacherId || teacher.id
        const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
        const originalGroupRoomId = booking.data.originalGroupRoomId || groupRoom.id

        const schedulesToDelete = await pb.collection('groupLessonSchedule').getFullList({
          filter: `teacher = "${originalTeacherId}" && timeslot = "${originalTimeslotId}" && grouproom = "${originalGroupRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
        })

        await Promise.all(schedulesToDelete.map((schedule) => pb.collection('groupLessonSchedule').delete(schedule.id)))
      },
      {
        loading: 'Deleting...',
        success: () => {
          closeModal()
          dispatch('refresh')
          return 'Weekly group schedule deleted!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to delete: ${error.message}`
        },
      }
    )
  }

  const filteredStudents = $derived(
    students.filter((s) => s.englishName.toLowerCase().includes(searchTerm.toLowerCase()))
  )
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.data?.mode === 'edit' ? 'Edit' : 'Create'} Weekly Group Schedule
      </h3>

      <div class="alert alert-info text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <span>
          This will {booking.data?.mode === 'edit' ? 'update' : 'create'} group schedules for Tuesday through Friday (4 lessons
          per week)
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <label class="label"><span class="label-text">Subject</span></label>
            <select
              bind:value={booking.data.subject.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded}
            >
              <option value="">-- Select Subject --</option>
              {#each subjects as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>

          <!-- Students -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Students ({selectedStudents.length} selected
                {#if maxStudentsAllowed > 0}
                  / {maxStudentsAllowed} max
                {/if})
              </span>
              <div class="space-x-2">
                <button type="button" class="btn btn-xs btn-outline" onclick={selectAllStudents} disabled={!dataLoaded}>
                  Select All
                </button>
                <button type="button" class="btn btn-xs btn-outline" onclick={clearAllStudents} disabled={!dataLoaded}>
                  Clear All
                </button>
              </div>
            </label>

            <div class="mb-2">
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="Search student..."
                bind:value={searchTerm}
                disabled={!dataLoaded}
              />
            </div>

            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto bg-base-100">
              {#each filteredStudents as student (student.id)}
                {#if student.status !== 'graduated' || selectedStudents.includes(student.id)}
                  {@const isGraduated = student.status === 'graduated'}
                  {@const isDisabled =
                    isGraduated ||
                    (maxStudentsAllowed > 0 &&
                      !selectedStudents.includes(student.id) &&
                      selectedStudents.length >= maxStudentsAllowed)}

                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={isDisabled}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text" class:italic={isGraduated}>
                        {student.englishName}
                        {#if isGraduated}
                          <span class="text-xs text-gray-400">(Graduated)</span>
                        {/if}
                      </span>
                    </label>
                  </div>
                {/if}
              {/each}

              {#if filteredStudents.filter((s) => s.status !== 'graduated' || selectedStudents.includes(s.id)).length === 0}
                <p class="text-sm text-base-content/100 text-center py-4">No matching students</p>
              {/if}
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <!-- Teacher -->
          <div class="form-control">
            <label class="label"><span class="label-text">Teacher</span></label>
            <select
              bind:value={booking.data.teacher.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded}
            >
              <option value="">-- Select Teacher --</option>
              {#each teachers as teacher}
                {#if teacher.status !== 'disabled' || teacher.id === booking.data.teacher.id}
                  <option
                    value={teacher.id}
                    disabled={teacher.status === 'disabled'}
                    class:italic={teacher.status === 'disabled'}
                  >
                    {teacher.name}
                    {#if teacher.status === 'disabled'}(Disabled){/if}
                  </option>
                {/if}
              {/each}
            </select>
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={booking.data.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
              disabled={!dataLoaded}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as room}
                <option value={room.id}>
                  {room.name} (Max: {room.maxstudents} students)
                </option>
              {/each}
            </select>
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select
              bind:value={booking.data.timeslot.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded}
            >
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Schedule Info Display -->
          <div class="form-control">
            <label class="label"><span class="label-text">Schedule Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Week:</span>
                {booking.data.startDate && booking.data.endDate
                  ? `${new Date(booking.data.startDate).toLocaleDateString()} - ${new Date(booking.data.endDate).toLocaleDateString()}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {booking.data.groupRoom?.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {booking.data.timeslot?.start && booking.data.timeslot?.end
                  ? `${booking.data.timeslot.start} - ${booking.data.timeslot.end}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Students:</span>
                {selectedStudents.length} selected
                {#if maxStudentsAllowed > 0}
                  (Max: {maxStudentsAllowed})
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Buttons -->
      <div class="modal-action">
        {#if booking.data?.mode === 'edit'}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule}> Delete Week </button>
        {/if}

        <button class="btn btn-primary" onclick={saveSchedule}>
          {booking.data?.mode === 'edit' ? 'Update' : 'Save'} Week
        </button>

        <button class="btn" onclick={closeModal}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
