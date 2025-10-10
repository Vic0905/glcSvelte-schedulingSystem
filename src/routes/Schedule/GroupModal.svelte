<script>
  import { createEventDispatcher } from 'svelte'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking } from './schedule.svelte'

  const dispatch = createEventDispatcher()

  let show = false
  let subjects = []
  let students = []
  let teachers = []
  let groupRooms = []
  let timeslots = []
  let saving = false
  let deleting = false
  let selectedStudents = []
  let maxStudentsAllowed = 0
  let searchTerm = ''
  let existingSchedules = []

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
    loadDropdowns()

    // Initialize selected students from booking data with null safety
    if (booking?.data?.mode === 'edit' && Array.isArray(booking.data.students)) {
      selectedStudents = booking.data.students.map((student) => student.id || student)
    } else {
      selectedStudents = []
    }

    setMaxStudentsAllowed()

    // Always reload existing schedules when modal opens with null safety
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

  async function loadDropdowns() {
    try {
      subjects = await pb.collection('subject').getFullList({ sort: 'name' })
      students = await pb.collection('student').getFullList({ sort: 'englishName' })
      teachers = await pb.collection('teacher').getFullList({ sort: 'name' })
      groupRooms = await pb.collection('groupRoom').getFullList({ sort: 'name' })
      timeslots = await pb.collection('timeslot').getFullList({ sort: 'start' })

      setMaxStudentsAllowed()
    } catch (err) {
      console.error('Error loading dropdowns:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  // Load existing schedules for conflict detection
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

  // Rest of your functions remain the same...
  const isTeacherBooked = (teacherId) => {
    return existingSchedules.some((s) => s.teacher === teacherId)
  }

  const isStudentBooked = (studentId) => {
    return existingSchedules.some(
      (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
    )
  }

  const isGroupRoomBooked = (roomId) => {
    return existingSchedules.some((s) => s.room === roomId || s.grouproom === roomId)
  }

  const getConflictInfo = (resourceId, type) => {
    const schedule = existingSchedules.find((s) => {
      if (type === 'student') {
        return s.student === resourceId || (Array.isArray(s.student) && s.student.includes(resourceId))
      } else if (type === 'grouproom') {
        return s.room === resourceId || s.grouproom === resourceId
      }
      return s[type] === resourceId
    })

    if (!schedule) return ''

    switch (type) {
      case 'teacher':
        if (Array.isArray(schedule.expand?.student)) {
          return 'Group Class'
        }
        return schedule.expand?.student?.englishName || 'Unknown Student'

      case 'student':
        return schedule.expand?.teacher?.name || 'Unknown Teacher'

      case 'grouproom':
        const teacherName = schedule.expand?.teacher?.name || 'Unknown Teacher'
        let studentNames = ''

        if (schedule.expand?.student?.englishName) {
          studentNames = schedule.expand.student.englishName
        } else if (Array.isArray(schedule.expand?.student)) {
          studentNames = schedule.expand.student.map((st) => st.englishName).join(', ')
        } else {
          studentNames = 'Group Students'
        }

        return `${teacherName} & ${studentNames}`

      default:
        return ''
    }
  }

  // Reload schedules when date/timeslot changes - with null safety
  $: if (booking?.data?.startDate && booking?.data?.endDate && booking?.data?.timeslot?.id) {
    loadExistingSchedules()
  }

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
    if (maxStudentsAllowed > 0) {
      selectedStudents = students.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (students.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} students due to room limit`)
      }
    } else {
      selectedStudents = students.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  // Validation
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

    // Check conflicts
    if (isTeacherBooked(booking.data.teacher.id)) {
      const conflictInfo = getConflictInfo(booking.data.teacher.id, 'teacher')
      toast.error('Teacher conflict', {
        description: `${booking.data.teacher.name || 'Teacher'} is already booked with ${conflictInfo}`,
      })
      return false
    }

    for (const studentId of selectedStudents) {
      if (isStudentBooked(studentId)) {
        const student = students.find((s) => s.id === studentId)
        const conflictInfo = getConflictInfo(studentId, 'student')
        toast.error('Student conflict', {
          description: `${student?.englishName || 'Student'} is already booked with ${conflictInfo}`,
        })
        return false
      }
    }

    if (isGroupRoomBooked(booking.data.groupRoom.id)) {
      const conflictInfo = getConflictInfo(booking.data.groupRoom.id, 'grouproom')
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

        await Promise.all(
          existingWeekSchedules.map((schedule) =>
            pb.collection('groupLessonSchedule').update(schedule.id, {
              ...scheduleData,
              date: schedule.date,
            })
          )
        )

        toast.success('Weekly group schedule updated!', {
          description: `Updated ${existingWeekSchedules.length} group lesson(s)`,
        })
      } else {
        await Promise.all(
          weekDays.map((date) =>
            pb.collection('groupLessonSchedule').create({
              ...scheduleData,
              date,
            })
          )
        )

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

      await Promise.all(schedulesToDelete.map((schedule) => pb.collection('groupLessonSchedule').delete(schedule.id)))

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

  $: filteredStudents = students.filter((s) => s.englishName.toLowerCase().includes(searchTerm.toLowerCase()))
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.data.mode === 'edit' ? 'Edit Weekly Group Schedule' : 'Create Weekly Group Schedule'}
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
        <span
          >This will {booking.data.mode === 'edit' ? 'update' : 'create'} group schedules for Tuesday through Friday (4 lessons
          per week)</span
        >
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
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={selectAllStudents}
                  disabled={maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed}
                >
                  Select All
                </button>
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
              {#each filteredStudents as student}
                {@const isBooked = isStudentBooked(student.id)}
                {@const conflictInfo = getConflictInfo(student.id, 'student')}
                <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={selectedStudents.includes(student.id)}
                      disabled={isBooked ||
                        (maxStudentsAllowed > 0 &&
                          !selectedStudents.includes(student.id) &&
                          selectedStudents.length >= maxStudentsAllowed)}
                      onchange={() => toggleStudent(student.id)}
                    />
                    <span
                      class="label-text {isBooked ||
                      (maxStudentsAllowed > 0 &&
                        !selectedStudents.includes(student.id) &&
                        selectedStudents.length >= maxStudentsAllowed)
                        ? 'opacity-50'
                        : ''}"
                    >
                      {student.englishName}
                      {#if isBooked}
                        <span class="text-warning text-xs">(Booked with {conflictInfo})</span>
                      {/if}
                    </span>
                  </label>
                </div>
              {/each}
              {#if filteredStudents.length === 0}
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
                {@const isBooked = isTeacherBooked(teacher.id)}
                {@const conflictInfo = getConflictInfo(teacher.id, 'teacher')}
                <option value={teacher.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {teacher.name}
                  {#if isBooked}
                    (Booked with {conflictInfo})
                  {/if}
                </option>
              {/each}
            </select>
            {#if booking.data.teacher.id && isTeacherBooked(booking.data.teacher.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This teacher is already booked </span>
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
                {@const isBooked = isGroupRoomBooked(room.id)}
                {@const conflictInfo = getConflictInfo(room.id, 'grouproom')}
                <option value={room.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {room.name} (Max: {room.maxstudents} students)
                  {#if isBooked}
                    - (Occupied by {conflictInfo})
                  {/if}
                </option>
              {/each}
            </select>
            {#if booking.data.groupRoom.id && isGroupRoomBooked(booking.data.groupRoom.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This room is already occupied </span>
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

          <!-- Week Range -->
          <!-- <div class="form-control">
            <label class="label"><span class="label-text">Week Range</span></label>
            <div class="space-y-2">
              <input
                type="date"
                bind:value={booking.data.startDate}
                class="input input-bordered w-full input-sm"
                required
                disabled
              />
              <div class="text-center text-xs text-gray-500">to</div>
              <input
                type="date"
                bind:value={booking.data.endDate}
                class="input input-bordered w-full input-sm"
                required
                disabled
              />
            </div>
            <div class="label">
              <span class="label-text-alt">Lessons: Tuesday - Friday</span>
            </div>
          </div> -->

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
        {#if booking.data.mode === 'edit'}
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
            {booking.data.mode === 'edit' ? 'Update Week' : 'Save Week'}
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving || deleting}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
