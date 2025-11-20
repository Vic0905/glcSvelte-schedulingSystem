<script>
  import { booking } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte.js'

  const dispatch = createEventDispatcher()

  let isDeleting = $state(false)
  let isSaving = $state(false)
  let existingSchedules = $state([])
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // Consolidated computed conflicts
  const conflicts = $derived({
    teacher: booking.data?.teacher?.id ? existingSchedules.find((s) => s.teacher === booking.data.teacher.id) : null,
    student: booking.data?.student?.id
      ? existingSchedules.find(
          (s) =>
            s.student === booking.data.student.id ||
            (Array.isArray(s.student) && s.student.includes(booking.data.student.id))
        )
      : null,
    room: booking.data?.room?.id
      ? existingSchedules.find((s) => s.room === booking.data.room.id || s.grouproom === booking.data.room.id)
      : null,
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

  // Combined data loading on mount
  $effect(() => {
    if (!teachers.length) {
      loadAllData()
    }
  })

  // Load schedules when dependencies change
  $effect(() => {
    if (booking.data?.startDate && booking.data?.endDate && booking.data?.timeslot?.id) {
      loadExistingSchedules()
    }
  })

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, roomsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList(),
        pb.collection('student').getFullList(),
        pb.collection('subject').getFullList(),
        pb.collection('room').getFullList(),
        pb.collection('timeSlot').getFullList(),
      ])

      teachers = teachersData.sort((a, b) => a.name.localeCompare(b.name))
      students = studentsData.sort((a, b) => a.englishName.localeCompare(b.englishName))
      subjects = subjectsData.sort((a, b) => a.name.localeCompare(b.name))
      rooms = roomsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  const loadExistingSchedules = async () => {
    try {
      const { startDate, endDate, timeslot, mode, student, room } = booking.data
      const weekDays = getWeekDays(startDate, endDate)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      const [lessonRecords, groupRecords] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: `(${dateFilter}) && timeslot = "${timeslot.id}"`,
          expand: 'teacher,student,room',
        }),
        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `(${dateFilter}) && timeslot = "${timeslot.id}"`,
            expand: 'teacher,student,grouproom,subject',
          })
          .catch(() => []),
      ])

      // Simple filter: exclude current schedule in edit mode
      existingSchedules =
        mode === 'edit'
          ? [...lessonRecords, ...groupRecords].filter((s) => !(s.student === student?.id && s.room === room?.id))
          : [...lessonRecords, ...groupRecords]
    } catch (error) {
      console.error('Error loading schedules:', error)
      existingSchedules = []
    }
  }

  const getConflictName = (schedule, type) => {
    if (!schedule?.expand) return 'Unknown'

    switch (type) {
      case 'teacher':
        return Array.isArray(schedule.expand.student)
          ? 'Group Class'
          : schedule.expand.student?.englishName || 'Unknown'
      case 'student':
        return schedule.expand.teacher?.name || 'Unknown'
      case 'room':
        const teacher = schedule.expand.teacher?.name || 'Unknown'
        const student = Array.isArray(schedule.expand.student)
          ? 'Group Class'
          : schedule.expand.student?.englishName || 'Unknown'
        return `${teacher} & ${student}`
      default:
        return 'Unknown'
    }
  }

  const validateAndCheckConflicts = () => {
    const { teacher, student, subject, timeslot, startDate, endDate, room } = booking.data

    // Validation
    const validations = [
      [teacher?.id, 'Please select Teacher'],
      [student?.id, 'Please select Student'],
      [subject?.id, 'Please select Subject'],
      [timeslot?.id, 'Please select Timeslot'],
      [startDate, 'Please select Start Date'],
      [endDate, 'Please select End Date'],
      [room?.id, 'Please select Room'],
    ]

    for (const [field, message] of validations) {
      if (!field) {
        toast.error(message, { position: 'bottom-right', duration: 3000 })
        return false
      }
    }

    // Conflict checks
    if (conflicts.teacher) {
      toast.error('Teacher conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${teacher.name} is already booked during this week's timeslot`,
      })
      return false
    }

    if (conflicts.student) {
      toast.error('Student conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${student.englishName} has another lesson scheduled during this week`,
      })
      return false
    }

    if (conflicts.room) {
      toast.error('Room conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${room.name} is already occupied during this week`,
      })
      return false
    }

    return true
  }

  const saveSchedule = async () => {
    if (!validateAndCheckConflicts()) return

    const { timeslot, teacher, student, subject, room, mode, startDate, endDate } = booking.data
    const weekDays = getWeekDays(startDate, endDate)

    const scheduleData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
    }

    try {
      isSaving = true

      if (mode === 'edit') {
        const originalStudentId = booking.data.originalStudentId || student.id
        const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id

        const existingWeekSchedules = await pb.collection('lessonSchedule').getFullList({
          filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${room.id}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
        })

        await Promise.all(
          existingWeekSchedules.map((schedule) =>
            pb.collection('lessonSchedule').update(schedule.id, {
              ...scheduleData,
              date: schedule.date,
            })
          )
        )

        toast.success('Weekly schedule updated!', {
          position: 'bottom-right',
          duration: 3000,
          description: `Updated ${existingWeekSchedules.length} lesson(s)`,
        })
      } else {
        await Promise.all(weekDays.map((date) => pb.collection('lessonSchedule').create({ ...scheduleData, date })))

        toast.success('Weekly schedule created!', {
          position: 'bottom-right',
          duration: 3000,
          description: `Created ${weekDays.length} lessons (Tue-Fri)`,
        })
      }

      dispatch('refresh')
      document.getElementById('editModal').close()
    } catch (error) {
      toast.error(`${mode === 'edit' ? 'Update' : 'Creation'} failed`, {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isSaving = false
    }
  }

  const deleteSchedule = async () => {
    const { startDate, endDate, subject, teacher, student, room, timeslot } = booking.data
    const weekDays = getWeekDays(startDate, endDate)

    const confirmMessage =
      `Are you sure you want to delete this WEEKLY schedule?\n\n` +
      `Week: ${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}\n` +
      `Days: Tuesday - Friday (${weekDays.length} lessons)\n` +
      `Subject: ${subject.name}\n` +
      `Teacher: ${teacher.name}\n` +
      `Student: ${student.englishName}\n` +
      `Room: ${room.name}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n\n` +
      `This will delete ALL ${weekDays.length} lessons for this week. This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    try {
      isDeleting = true

      const originalStudentId = booking.data.originalStudentId || student.id
      const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
      const originalRoomId = booking.data.originalRoomId || room.id

      const schedulesToDelete = await pb.collection('lessonSchedule').getFullList({
        filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${originalRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
      })

      await Promise.all(schedulesToDelete.map((schedule) => pb.collection('lessonSchedule').delete(schedule.id)))

      toast.success('Weekly schedule deleted!', {
        position: 'bottom-right',
        duration: 3000,
        description: `Deleted ${schedulesToDelete.length} lesson(s)`,
      })
      dispatch('refresh')
      document.getElementById('editModal').close()
    } catch (error) {
      toast.error(`Failed to delete: ${error.message}`, {
        position: 'bottom-right',
        duration: 5000,
      })
    } finally {
      isDeleting = false
    }
  }
</script>

<dialog id="editModal" class="modal">
  <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
    <h3 class="text-xl font-bold text-center">
      {booking.data?.mode === 'edit' ? 'Edit' : 'Create'} Weekly Schedule
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
        This will {booking.data?.mode === 'edit' ? 'update' : 'create'} schedules for Tuesday through Friday (4 lessons per
        week)
      </span>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Left column -->
      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.subject.id} required>
            <option value="">Select Subject</option>
            {#each subjects as subject}
              <option value={subject.id}>{subject.name}</option>
            {/each}
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.student.id} required>
            <option value="">Select Student</option>
            {#each students as student (student.id)}
              {@const isGraduated = student.status === 'graduated'}
              {@const isCurrentStudent = student.id === booking.data.student.id}
              {@const conflictSchedule = existingSchedules.find(
                (s) => s.student === student.id || (Array.isArray(s.student) && s.student.includes(student.id))
              )}

              {#if !isGraduated || isCurrentStudent}
                <option
                  value={student.id}
                  disabled={isGraduated || !!conflictSchedule}
                  class:text-gray-400={isGraduated || conflictSchedule}
                  class:italic={isGraduated}
                >
                  {student.englishName}
                  {#if isGraduated}
                    (Graduated)
                  {:else if conflictSchedule}
                    (Booked with {getConflictName(conflictSchedule, 'student')})
                  {/if}
                </option>
              {/if}
            {/each}
          </select>
          {#if conflicts.student}
            <div class="label">
              <span class="label-text-alt text-warning">
                ⚠️ This student is already booked for this week's timeslot
              </span>
            </div>
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Week Range</legend>
          <div class="space-y-2">
            <input
              type="date"
              bind:value={booking.data.startDate}
              class="input input-bordered w-full input-sm"
              disabled
            />
            <div class="text-center text-xs text-gray-500">to</div>
            <input
              type="date"
              bind:value={booking.data.endDate}
              class="input input-bordered w-full input-sm"
              disabled
            />
          </div>
          <div class="label">
            <span class="label-text-alt">Lessons: Tuesday - Friday</span>
          </div>
        </fieldset>
      </div>

      <!-- Right column -->
      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.teacher.id} required>
            <option value="">Select Teacher</option>
            {#each teachers as teacher}
              {@const conflictSchedule = existingSchedules.find((s) => s.teacher === teacher.id)}
              <option value={teacher.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                {teacher.name}
                {#if conflictSchedule}(Booked with {getConflictName(conflictSchedule, 'teacher')}){/if}
              </option>
            {/each}
          </select>
          {#if conflicts.teacher}
            <div class="label">
              <span class="label-text-alt text-warning">⚠️ This teacher is already booked</span>
            </div>
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.room.id} required>
            <option value="">Select Room</option>
            {#each rooms as room}
              {@const conflictSchedule = existingSchedules.find((s) => s.room === room.id || s.grouproom === room.id)}
              <option value={room.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                {room.name}
                {#if conflictSchedule}(Occupied by {getConflictName(conflictSchedule, 'room')}){/if}
              </option>
            {/each}
          </select>
          {#if conflicts.room}
            <div class="label">
              <span class="label-text-alt text-warning">⚠️ This room is already occupied</span>
            </div>
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.timeslot.id} required>
            <option value="">Select Timeslot</option>
            {#each timeslots as slot}
              <option value={slot.id}>{slot.start} - {slot.end}</option>
            {/each}
          </select>
        </fieldset>
      </div>
    </div>

    <!-- Buttons -->
    <div class="modal-action">
      {#if booking.data?.mode === 'edit' && booking.data.id}
        <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={isDeleting || isSaving}>
          {#if isDeleting}
            <span class="loading loading-spinner loading-sm"></span>
            Deleting...
          {:else}
            Delete Week
          {/if}
        </button>
      {/if}

      <button class="btn btn-primary" onclick={saveSchedule} disabled={isSaving || isDeleting}>
        {#if isSaving}
          <span class="loading loading-spinner loading-sm"></span>
          Saving...
        {:else}
          {booking.data?.mode === 'edit' ? 'Update' : 'Save'} Week
        {/if}
      </button>

      <form method="dialog">
        <button class="btn" disabled={isSaving || isDeleting}>Close</button>
      </form>
    </div>
  </div>
</dialog>
