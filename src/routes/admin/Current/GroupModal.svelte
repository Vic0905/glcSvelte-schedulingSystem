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
  let deleting = $state(false)
  let selectedStudents = $state([])
  let maxStudentsAllowed = $state(0)
  let searchTerm = $state('')
  let existingSchedules = $state([])

  // Consolidated conflict detection using $derived
  const conflicts = $derived({
    teacher: existingSchedules.find((s) => s.teacher === booking.data?.teacher?.id),
    grouproom: existingSchedules.find(
      (s) => s.room === booking.data?.groupRoom?.id || s.grouproom === booking.data?.groupRoom?.id
    ),
    students: selectedStudents.filter((studentId) =>
      existingSchedules.some(
        (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
      )
    ),
  })

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
    loadAllData()

    // Initialize selected students from booking data
    if (booking?.data?.mode === 'edit' && Array.isArray(booking.data.students)) {
      selectedStudents = booking.data.students.map((student) => student.id || student)
    } else {
      selectedStudents = []
    }

    setMaxStudentsAllowed()

    // Reload existing schedules when modal opens
    if (booking?.data?.startDate && booking?.data?.endDate && booking?.data?.timeslot?.id) {
      loadExistingSchedules()
    }
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
    existingSchedules = []
  }

  const loadAllData = async () => {
    try {
      const [subjectsData, studentsData, teachersData, groupRoomsData, timeslotsData] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name' }),
        pb.collection('student').getFullList({ sort: 'englishName' }),
        pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('groupRoom').getFullList({ sort: 'name' }),
        pb.collection('timeslot').getFullList({ sort: 'start' }),
      ])

      subjects = subjectsData
      students = studentsData
      teachers = teachersData
      groupRooms = groupRoomsData
      timeslots = timeslotsData

      setMaxStudentsAllowed()
    } catch (err) {
      console.error('Error loading data:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  const loadExistingSchedules = async () => {
    try {
      const startDate = booking?.data?.startDate
      const endDate = booking?.data?.endDate
      const timeslotId = booking?.data?.timeslot?.id

      if (!startDate || !endDate || !timeslotId) {
        existingSchedules = []
        return
      }

      const weekDays = getWeekDays(startDate, endDate)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Exclude schedules being edited
      let excludeFilter = ''
      if (
        booking?.data?.mode === 'edit' &&
        booking?.data?.originalTeacherId &&
        booking?.data?.originalGroupRoomId &&
        booking?.data?.originalTimeslotId
      ) {
        const editingSchedules = await pb.collection('groupLessonSchedule').getFullList({
          filter: `teacher = "${booking.data.originalTeacherId}" && timeslot = "${booking.data.originalTimeslotId}" && grouproom = "${booking.data.originalGroupRoomId}" && (${dateFilter})`,
          fields: 'id',
        })

        if (editingSchedules.length > 0) {
          const excludeIds = editingSchedules.map((s) => `id != "${s.id}"`).join(' && ')
          excludeFilter = ` && (${excludeIds})`
        }
      }

      const [lessonRecords, groupRecords] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: `(${dateFilter}) && timeslot = "${timeslotId}"`,
          expand: 'teacher,student,room',
        }),
        pb.collection('groupLessonSchedule').getFullList({
          filter: `(${dateFilter}) && timeslot = "${timeslotId}"${excludeFilter}`,
          expand: 'teacher,student,grouproom,subject',
        }),
      ])

      existingSchedules = [...lessonRecords, ...groupRecords]
    } catch (error) {
      console.error('Error loading schedules:', error)
      existingSchedules = []
    }
  }

  const getConflictLabel = (schedule, type) => {
    if (!schedule?.expand) return 'Unknown'

    const isGroupLesson = Array.isArray(schedule.student)

    switch (type) {
      case 'teacher':
        if (isGroupLesson) return 'Group Class'
        return schedule.expand.student?.englishName || 'Unknown Student'

      case 'student':
        return schedule.expand.teacher?.name || 'Unknown Teacher'

      case 'grouproom':
        const teacherName = schedule.expand.teacher?.name || 'Unknown Teacher'
        if (isGroupLesson) {
          const studentNames = schedule.expand.student?.map((st) => st.englishName).join(', ') || 'Group Students'
          return `${teacherName} & ${studentNames}`
        }
        const studentName = schedule.expand.student?.englishName || 'Unknown Student'
        return `${teacherName} & ${studentName}`

      default:
        return 'Unknown'
    }
  }

  const getStudentConflict = (studentId) => {
    return existingSchedules.find(
      (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
    )
  }

  // Reload schedules when date/timeslot changes
  $effect(() => {
    if (booking?.data?.startDate && booking?.data?.endDate && booking?.data?.timeslot?.id) {
      loadExistingSchedules()
    }
  })

  function setMaxStudentsAllowed() {
    if (booking?.data?.groupRoom?.id && groupRooms.length > 0) {
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
    const availableStudents = students.filter((s) => s.status !== 'graduated' && !getStudentConflict(s.id))

    if (maxStudentsAllowed > 0) {
      selectedStudents = availableStudents.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (availableStudents.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} students due to room limit`)
      }
    } else {
      selectedStudents = availableStudents.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  const validateSchedule = () => {
    if (!booking?.data?.subject?.id) {
      toast.error('Please select a subject')
      return false
    }
    if (selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return false
    }
    if (!booking?.data?.groupRoom?.id) {
      toast.error('Please select a group room')
      return false
    }
    if (!booking?.data?.teacher?.id) {
      toast.error('Please select a teacher')
      return false
    }
    if (!booking?.data?.timeslot?.id) {
      toast.error('Please select a timeslot')
      return false
    }

    // In-memory conflict checks
    if (conflicts.teacher) {
      const conflictInfo = getConflictLabel(conflicts.teacher, 'teacher')
      toast.error('Teacher conflict', {
        description: `${booking.data.teacher.name || 'Teacher'} is already booked with ${conflictInfo}`,
      })
      return false
    }

    if (conflicts.students.length > 0) {
      const student = students.find((s) => s.id === conflicts.students[0])
      const conflictSchedule = getStudentConflict(conflicts.students[0])
      const conflictInfo = getConflictLabel(conflictSchedule, 'student')
      toast.error('Student conflict', {
        description: `${student?.englishName || 'Student'} is already booked with ${conflictInfo}`,
      })
      return false
    }

    if (conflicts.grouproom) {
      const conflictInfo = getConflictLabel(conflicts.grouproom, 'grouproom')
      toast.error('Room conflict', {
        description: `${booking.data.groupRoom.name || 'Room'} is already occupied by ${conflictInfo}`,
      })
      return false
    }

    return true
  }

  async function saveSchedule() {
    if (!validateSchedule()) return

    const { data } = booking
    const weekDays = getWeekDays(data.startDate, data.endDate)

    const scheduleData = {
      timeslot: data.timeslot.id,
      teacher: data.teacher.id,
      student: selectedStudents,
      subject: data.subject.id,
      grouproom: data.groupRoom.id,
    }

    saving = true
    try {
      if (data.mode === 'edit' && data.id) {
        const originalTeacherId = data.originalTeacherId || data.teacher.id
        const originalTimeslotId = data.originalTimeslotId || data.timeslot.id
        const originalGroupRoomId = data.originalGroupRoomId || data.groupRoom.id

        const existingWeekSchedules = await pb.collection('groupLessonSchedule').getFullList({
          filter: `teacher = "${originalTeacherId}" && timeslot = "${originalTimeslotId}" && grouproom = "${originalGroupRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
        })

        // Use Batch API for updates
        try {
          const batch = pb.createBatch()

          existingWeekSchedules.forEach((schedule) => {
            batch.collection('groupLessonSchedule').update(schedule.id, {
              ...scheduleData,
              date: schedule.date,
            })
          })

          await batch.send()
        } catch (error) {
          // Fallback to individual updates if batch fails
          console.warn('Batch update failed, falling back to individual updates:', error)
          await Promise.all(
            existingWeekSchedules.map((schedule) =>
              pb.collection('groupLessonSchedule').update(schedule.id, {
                ...scheduleData,
                date: schedule.date,
              })
            )
          )
        }

        toast.success('Weekly group schedule updated!', {
          description: `Updated ${existingWeekSchedules.length} group lesson(s)`,
        })
      } else {
        // Use Batch API for creates
        try {
          const batch = pb.createBatch()

          weekDays.forEach((date) => {
            batch.collection('groupLessonSchedule').create({
              ...scheduleData,
              date,
            })
          })

          await batch.send()
        } catch (error) {
          // Fallback to individual creates if batch fails
          console.warn('Batch create failed, falling back to individual creates:', error)
          await Promise.all(
            weekDays.map((date) =>
              pb.collection('groupLessonSchedule').create({
                ...scheduleData,
                date,
              })
            )
          )
        }

        toast.success('Weekly group schedule created!', {
          description: `Created ${weekDays.length} group lessons (Tue-Fri)`,
        })
      }

      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      console.error('Error saving schedule:', err)
      toast.error(`Error saving schedule: ${err.message}`)
    } finally {
      saving = false
    }
  }

  async function deleteSchedule() {
    const { data } = booking

    if (!data?.id) {
      toast.error('No schedule selected to delete')
      return
    }

    const weekDays = getWeekDays(data.startDate, data.endDate)

    const confirmMessage =
      `Are you sure you want to delete this WEEKLY group schedule?\n\n` +
      `Week: ${new Date(data.startDate).toLocaleDateString()} - ${new Date(data.endDate).toLocaleDateString()}\n` +
      `Days: Tuesday - Friday (${weekDays.length} lessons)\n` +
      `Subject: ${data.subject.name}\n` +
      `Teacher: ${data.teacher.name}\n` +
      `Students: ${selectedStudents.length} selected\n` +
      `Room: ${data.groupRoom.name}\n` +
      `Time: ${data.timeslot.start} - ${data.timeslot.end}\n\n` +
      `This will delete ALL ${weekDays.length} group lessons for this week. This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    deleting = true
    try {
      const originalTeacherId = data.originalTeacherId || data.teacher.id
      const originalTimeslotId = data.originalTimeslotId || data.timeslot.id
      const originalGroupRoomId = data.originalGroupRoomId || data.groupRoom.id

      const schedulesToDelete = await pb.collection('groupLessonSchedule').getFullList({
        filter: `teacher = "${originalTeacherId}" && timeslot = "${originalTimeslotId}" && grouproom = "${originalGroupRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
      })

      // Use Batch API for deletes
      try {
        const batch = pb.createBatch()

        schedulesToDelete.forEach((schedule) => {
          batch.collection('groupLessonSchedule').delete(schedule.id)
        })

        await batch.send()
      } catch (error) {
        // Fallback to individual deletes if batch fails
        console.warn('Batch delete failed, falling back to individual deletes:', error)
        await Promise.all(schedulesToDelete.map((schedule) => pb.collection('groupLessonSchedule').delete(schedule.id)))
      }

      toast.success('Weekly group schedule deleted!', {
        description: `Deleted ${schedulesToDelete.length} group lesson(s) successfully`,
      })
      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      console.error('Error deleting schedule:', err)
      toast.error(`Error deleting schedule: ${err.message}`)
    } finally {
      deleting = false
    }
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
            <select bind:value={booking.data.subject.id} class="select select-bordered w-full" required>
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
                <button type="button" class="btn btn-xs btn-outline" onclick={selectAllStudents}> Select All </button>
                <button type="button" class="btn btn-xs btn-outline" onclick={clearAllStudents}> Clear All </button>
              </div>
            </label>

            <div class="mb-2">
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="Search student..."
                bind:value={searchTerm}
              />
            </div>

            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto bg-base-100">
              {#each filteredStudents as student (student.id)}
                {#if student.status !== 'graduated' || selectedStudents.includes(student.id)}
                  {@const conflictSchedule = getStudentConflict(student.id)}
                  {@const isGraduated = student.status === 'graduated'}
                  {@const isBooked = !!conflictSchedule}

                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={isGraduated ||
                          isBooked ||
                          (maxStudentsAllowed > 0 &&
                            !selectedStudents.includes(student.id) &&
                            selectedStudents.length >= maxStudentsAllowed)}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text" class:italic={isGraduated || isBooked}>
                        {student.englishName}
                        {#if isGraduated}
                          <span class="text-xs text-gray-400">(Graduated)</span>
                        {:else if isBooked}
                          <span class="text-warning text-xs">
                            (Booked with {getConflictLabel(conflictSchedule, 'student')})
                          </span>
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
            <select bind:value={booking.data.teacher.id} class="select select-bordered w-full" required>
              <option value="">-- Select Teacher --</option>
              {#each teachers as teacher}
                {@const conflictSchedule = existingSchedules.find((s) => s.teacher === teacher.id)}
                <option value={teacher.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                  {teacher.name}
                  {#if conflictSchedule}
                    (Booked with {getConflictLabel(conflictSchedule, 'teacher')})
                  {/if}
                </option>
              {/each}
            </select>
            {#if conflicts.teacher}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This teacher is already booked</span>
              </div>
            {/if}
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={booking.data.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as room}
                {@const conflictSchedule = existingSchedules.find((s) => s.room === room.id || s.grouproom === room.id)}
                <option value={room.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                  {room.name} (Max: {room.maxstudents} students)
                  {#if conflictSchedule}
                    - (Occupied by {getConflictLabel(conflictSchedule, 'grouproom')})
                  {/if}
                </option>
              {/each}
            </select>
            {#if conflicts.grouproom}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This room is already occupied</span>
              </div>
            {/if}
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select bind:value={booking.data.timeslot.id} class="select select-bordered w-full" required>
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
                {booking.data.groupRoom.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {booking.data.timeslot.start && booking.data.timeslot.end
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
          <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={deleting || saving}>
            {#if deleting}
              <span class="loading loading-spinner loading-sm"></span>
              Deleting...
            {:else}
              Delete Week
            {/if}
          </button>
        {/if}

        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving || deleting}>
          {#if saving}
            <span class="loading loading-spinner loading-sm"></span>
            Saving...
          {:else}
            {booking.data?.mode === 'edit' ? 'Update' : 'Save'} Week
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving || deleting}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
