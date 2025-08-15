<script>
  import { pb } from '../../lib/Pocketbase.svelte.js'
  import { booking, grid } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'

  const getTeacher = async () => await pb.collection('teacher').getFullList()
  const getStudent = async () => await pb.collection('student').getFullList()
  const getSubject = async () => await pb.collection('subject').getFullList()
  const getRoom = async () => await pb.collection('room').getFullList()
  const getTimeslot = async () => await pb.collection('timeSlot').getFullList()
  const dispatch = createEventDispatcher()

  let isDeleting = $state(false)
  let existingSchedules = $state([])

  // Get existing schedules for conflict checking
  const loadExistingSchedules = async () => {
    try {
      const currentDate = booking.data.mode === 'edit' ? booking.data.date : booking.data.startDate
      if (!currentDate || !booking.data.timeslot.id) {
        existingSchedules = []
        return
      }

      const records = await pb.collection('lessonSchedule').getFullList({
        filter: `date = "${currentDate}" && timeslot = "${booking.data.timeslot.id}"${booking.data.mode === 'edit' && booking.data.id ? ` && id != "${booking.data.id}"` : ''}`,
        expand: 'teacher,student,room',
      })

      existingSchedules = records
    } catch (error) {
      console.error('Error loading existing schedules:', error)
      existingSchedules = []
    }
  }

  // Check if teacher is already booked
  const isTeacherBooked = (teacherId) => {
    return existingSchedules.some((schedule) => schedule.teacher === teacherId)
  }

  // Check if student is already booked
  const isStudentBooked = (studentId) => {
    return existingSchedules.some((schedule) => schedule.student === studentId)
  }

  // Check if room is already booked
  const isRoomBooked = (roomId) => {
    return existingSchedules.some((schedule) => schedule.room === roomId)
  }

  // Get the name of who is using the resource
  const getConflictInfo = (resourceId, type) => {
    const schedule = existingSchedules.find((s) => s[type] === resourceId)
    if (!schedule) return ''

    switch (type) {
      case 'teacher':
        return schedule.expand?.student?.name || 'Unknown Student'
      case 'student':
        return schedule.expand?.teacher?.name || 'Unknown Teacher'
      case 'room':
        return `${schedule.expand?.teacher?.name || 'Unknown Teacher'} & ${schedule.expand?.student?.name || 'Unknown Student'}`
      default:
        return ''
    }
  }

  // Reactive statement to reload schedules when date or timeslot changes
  $effect(() => {
    const currentDate = booking.data.mode === 'edit' ? booking.data.date : booking.data.startDate
    const timeslotId = booking.data.timeslot.id

    if (currentDate && timeslotId) {
      loadExistingSchedules()
    }
  })

  const checkConflict = async (collection, filter) => {
    try {
      await pb.collection('lessonSchedule').getFirstListItem(filter)
      return true
    } catch {
      return false
    }
  }

  const deleteSchedule = async () => {
    const { data } = booking

    if (!data.id) {
      toast.error('No schedule selected to delete')
      return
    }

    // Confirmation dialog
    const confirmDelete = confirm(
      `Are you sure you want to delete this schedule?\n\n` +
        `Date: ${new Date(data.date).toLocaleDateString()}\n` +
        `Subject: ${data.subject.name}\n` +
        `Teacher: ${data.teacher.name}\n` +
        `Student: ${data.student.name}\n` +
        `Room: ${data.room.name}\n` +
        `Time: ${data.timeslot.start} - ${data.timeslot.end}\n\n` +
        `This action cannot be undone.`
    )

    if (!confirmDelete) return

    try {
      isDeleting = true

      await pb.collection('lessonSchedule').delete(data.id)

      toast.success('Schedule deleted successfully!')

      dispatch('refresh')
      document.getElementById('editModal').close()
    } catch (error) {
      console.error('Error deleting schedule:', error)
      toast.error(`Failed to delete schedule: ${error.message}`)
    } finally {
      isDeleting = false
    }
  }

  const saveData = async () => {
    const { data } = booking

    // Edit mode
    if (data.mode === 'edit' && data.id) {
      const excludeId = `&& id != "${data.id}"`

      if (
        await checkConflict(
          'lessonSchedule',
          `teacher = "${data.teacher.id}" && date = "${data.date}" && timeslot = "${data.timeslot.id}" ${excludeId}`
        )
      ) {
        alert(
          '⚠ Teacher is already booked at this timeslot on this date. Please select a different timeslot or teacher.'
        )
        return
      }

      if (
        await checkConflict(
          'lessonSchedule',
          `room = "${data.room.id}" && date = "${data.date}" && timeslot = "${data.timeslot.id}" ${excludeId}`
        )
      ) {
        alert('⚠ Room is already occupied at this timeslot on this date. Please select a different room or timeslot.')
        return
      }

      await pb.collection('lessonSchedule').update(data.id, {
        date: data.date,
        timeslot: data.timeslot.id,
        teacher: data.teacher.id,
        student: data.student.id,
        subject: data.subject.id,
        room: data.room.id,
      })

      dispatch('refresh')
      document.getElementById('editModal').close()
      return
    }

    // Validation
    const required = [
      { field: data.teacher.id, msg: 'Please select Teacher' },
      { field: data.student.id, msg: 'Please select Student' },
      { field: data.subject.id, msg: 'Please select Subject' },
      { field: data.timeslot.id, msg: 'Please select Timeslot' },
    ]

    for (const { field, msg } of required) {
      if (!field) {
        alert(msg)
        return
      }
    }

    // Create mode (bulk create)
    if (!data.startDate || !data.endDate) {
      alert('⚠ Please select both start and end dates.')
      return
    }

    const start = new Date(data.startDate)
    const end = new Date(data.endDate)

    if (end < start) {
      alert('⚠ End date cannot be before start date.')
      return
    }

    // Generate weekdays
    const days = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay()
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days.push(new Date(d))
      }
    }

    const bulkData = []
    const conflicts = []

    for (const day of days) {
      const dateStr = day.toISOString().split('T')[0]

      // Check conflicts
      const conflictChecks = [
        {
          filter: `student = "${data.student.id}" && date = "${dateStr}" && timeslot = "${data.timeslot.id}"`,
          type: 'Student',
        },
        {
          filter: `teacher = "${data.teacher.id}" && date = "${dateStr}" && timeslot = "${data.timeslot.id}"`,
          type: 'Teacher',
        },
        { filter: `room = "${data.room.id}" && date = "${dateStr}" && timeslot = "${data.timeslot.id}"`, type: 'Room' },
      ]

      let hasConflict = false
      for (const { filter, type } of conflictChecks) {
        if (await checkConflict('lessonSchedule', filter)) {
          console.log(`⏩ Skipping ${dateStr} (${type.toLowerCase()} conflict)`)
          conflicts.push(`${dateStr} - ${type} conflict`)
          hasConflict = true
          break
        }
      }

      if (!hasConflict) {
        bulkData.push({
          date: dateStr,
          timeslot: data.timeslot.id,
          teacher: data.teacher.id,
          student: data.student.id,
          subject: data.subject.id,
          room: data.room.id,
        })
      }
    }

    if (bulkData.length === 0) {
      if (conflicts.length > 0) {
        alert(`🚫 No schedules created due to conflicts:\n${conflicts.join('\n')}`)
      } else {
        alert('🚫 No schedules created.')
      }
      return
    }

    // Show summary of conflicts
    if (conflicts.length > 0) {
      const proceed = confirm(
        `✅ ${bulkData.length} schedule(s) will be created.\n⚠ ${conflicts.length} conflict(s) were skipped:\n${conflicts.slice(0, 5).join('\n')}${conflicts.length > 5 ? '\n...and more' : ''}\n\nProceed with creating the valid schedules?`
      )
      if (!proceed) return
    }

    await Promise.all(bulkData.map((item) => pb.collection('lessonSchedule').create(item)))

    // Get names for toast
    const getName = async (collection, id, fallback) => {
      try {
        const record = await pb.collection(collection).getOne(id)
        return record.name || record.englishName || record.roomName || fallback
      } catch {
        return fallback
      }
    }

    const [teacherName, studentName, roomName] = await Promise.all([
      getName('teacher', data.teacher.id, 'Unknown Teacher'),
      getName('student', data.student.id, 'Unknown Student'),
      getName('room', data.room.id, 'Unknown Room'),
    ])

    const startDateStr = new Date(data.startDate).toLocaleDateString()
    const endDateStr = new Date(data.endDate).toLocaleDateString()

    const toastMessage = [
      `✅ ${bulkData.length} schedule(s) created successfully!`,
      `👨‍🏫 Teacher: ${teacherName}`,
      `👨‍🎓 Student: ${studentName}`,
      `🏠 Room: ${roomName}`,
      `📅 Period: ${startDateStr} - ${endDateStr}`,
      ...(conflicts.length > 0 ? [`⚠ ${conflicts.length} conflict(s) were skipped`] : []),
    ].join('\n')

    if (typeof toast !== 'undefined') {
      toast.success(toastMessage)
    } else {
      alert(toastMessage)
    }

    dispatch('refresh')
    document.getElementById('editModal').close()
  }
</script>

<dialog id="editModal" class="modal">
  <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
    <h3 class="text-xl font-bold text-center">
      {booking.data.mode === 'edit' ? 'Edit Schedule' : 'Input Schedule'}
    </h3>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Left column -->
      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.subject.id} required>
            {#await getSubject()}
              <option disabled selected>Fetching...</option>
            {:then data}
              {#each data as subject}
                <option value={subject.id}>{subject.name}</option>
              {/each}
            {/await}
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.student.id} required>
            {#await getStudent()}
              <option disabled selected>Fetching...</option>
            {:then data}
              {#each data as student}
                {@const isBooked = isStudentBooked(student.id)}
                {@const conflictInfo = getConflictInfo(student.id, 'student')}
                <option value={student.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {student.name}
                  {#if isBooked}
                    (Booked with {conflictInfo})
                  {/if}
                </option>
              {/each}
            {/await}
          </select>
          {#if booking.data.student.id && isStudentBooked(booking.data.student.id)}
            <div class="label">
              <span class="label-text-alt text-warning"> ⚠️ This student is already booked for this timeslot </span>
            </div>
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">
            {booking.data.mode === 'edit' ? 'Date' : 'Start Date'}
          </legend>
          {#if booking.data.mode === 'edit'}
            <input type="date" bind:value={booking.data.date} class="input input-bordered w-full" required />
          {:else}
            <input type="date" bind:value={booking.data.startDate} class="input input-bordered w-full" required />
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.timeslot.id} required>
            {#await getTimeslot()}
              <option disabled selected>Fetching...</option>
            {:then data}
              {#each data as slot}
                <option value={slot.id}>{slot.start} - {slot.end}</option>
              {/each}
            {/await}
          </select>
        </fieldset>
      </div>

      <!-- Right column -->
      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.teacher.id} required>
            {#await getTeacher()}
              <option disabled selected>Fetching...</option>
            {:then data}
              {#each data as teacher}
                {@const isBooked = isTeacherBooked(teacher.id)}
                {@const conflictInfo = getConflictInfo(teacher.id, 'teacher')}
                <option value={teacher.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {teacher.name}
                  {#if isBooked}
                    (Booked with {conflictInfo})
                  {/if}
                </option>
              {/each}
            {/await}
          </select>
          {#if booking.data.teacher.id && isTeacherBooked(booking.data.teacher.id)}
            <div class="label">
              <span class="label-text-alt text-warning"> ⚠️ This teacher is already booked for this timeslot </span>
            </div>
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.room.id} required>
            {#await getRoom()}
              <option disabled selected>Fetching...</option>
            {:then data}
              {#each data as room}
                {@const isBooked = isRoomBooked(room.id)}
                {@const conflictInfo = getConflictInfo(room.id, 'room')}
                <option value={room.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {room.name}
                  {#if isBooked}
                    (Occupied by {conflictInfo})
                  {/if}
                </option>
              {/each}
            {/await}
          </select>
          {#if booking.data.room.id && isRoomBooked(booking.data.room.id)}
            <div class="label">
              <span class="label-text-alt text-warning"> ⚠️ This room is already occupied for this timeslot </span>
            </div>
          {/if}
        </fieldset>

        {#if booking.data.mode !== 'edit'}
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">End Date</legend>
            <input type="date" bind:value={booking.data.endDate} class="input input-bordered w-full" required />
          </fieldset>
        {/if}
      </div>
    </div>

    <!-- Buttons -->
    <div class="modal-action">
      {#if booking.data.mode === 'edit' && booking.data.id}
        <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={isDeleting}>
          {#if isDeleting}
            <span class="loading loading-spinner loading-sm"></span>
            Deleting...
          {:else}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          {/if}
        </button>
      {/if}

      <button class="btn btn-primary" onclick={saveData}>
        {booking.data.mode === 'edit' ? 'Update' : 'Save'}
      </button>

      <form method="dialog">
        <button class="btn">Close</button>
      </form>
    </div>
  </div>
</dialog>
