<script>
  import { pb } from '../../lib/Pocketbase.svelte.js'
  import { booking, grid } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'

  const getTeacher = async () => {
    const data = await pb.collection('teacher').getFullList()
    return data.sort((a, b) => a.name.localeCompare(b.name))
  }
  const getStudent = async () => {
    const data = await pb.collection('student').getFullList()
    return data.sort((a, b) => a.name.localeCompare(b.name))
  }
  const getSubject = async () => {
    const data = await pb.collection('subject').getFullList()
    return data.sort((a, b) => a.name.localeCompare(b.name))
  }
  const getRoom = async () => await pb.collection('room').getFullList()
  const getTimeslot = async () => await pb.collection('timeSlot').getFullList()
  const dispatch = createEventDispatcher()

  let isDeleting = $state(false)
  let existingSchedules = $state([])

  //  Load existing schedules from BOTH collections
  const loadExistingSchedules = async () => {
    try {
      const currentDate = booking.data.date
      if (!currentDate || !booking.data.timeslot.id) {
        existingSchedules = []
        return
      }

      // lessonSchedule
      const lessonRecords = await pb.collection('lessonSchedule').getFullList({
        filter: `date = "${currentDate}" && timeslot = "${booking.data.timeslot.id}"${booking.data.mode === 'edit' && booking.data.id ? ` && id != "${booking.data.id}"` : ''}`,
        expand: 'teacher,student,room',
      })

      // groupLessonSchedule - using correct field names
      const groupRecords = await pb.collection('groupLessonSchedule').getFullList({
        filter: `date = "${currentDate}" && timeslot = "${booking.data.timeslot.id}"`,
        expand: 'teacher,student,grouproom,subject', // student is array, grouproom instead of room
      })

      // Merge both
      existingSchedules = [...lessonRecords, ...groupRecords]
    } catch (error) {
      console.error('Error loading schedules:', error)
      existingSchedules = []
    }
  }

  // Conflict helpers
  const isTeacherBooked = (teacherId) => {
    return existingSchedules.some((s) => s.teacher === teacherId)
  }

  const isStudentBooked = (studentId) => {
    return existingSchedules.some(
      (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
    )
  }

  const isRoomBooked = (roomId) => {
    return existingSchedules.some((s) => s.room === roomId || s.grouproom === roomId)
  }

  const getConflictInfo = (resourceId, type) => {
    const schedule = existingSchedules.find((s) => {
      if (type === 'student') {
        return s.student === resourceId || (Array.isArray(s.student) && s.student.includes(resourceId))
      } else if (type === 'room') {
        return s.room === resourceId || s.grouproom === resourceId
      }
      return s[type] === resourceId
    })

    if (!schedule) return ''

    switch (type) {
      case 'teacher':
        // If group lesson (students array), just show "Booked for Group Class"
        if (Array.isArray(schedule.expand?.student)) {
          return 'Group Class'
        }
        // Otherwise, show the individual student name
        return schedule.expand?.student?.name || 'Unknown Student'

      case 'student':
        return schedule.expand?.teacher?.name || 'Unknown Teacher'

      case 'room':
        const teacherName = schedule.expand?.teacher?.name || 'Unknown Teacher'
        let studentNames = ''

        if (schedule.expand?.student?.name) {
          studentNames = schedule.expand.student.name
        } else if (Array.isArray(schedule.expand?.student)) {
          studentNames = schedule.expand.student.map((st) => st.name).join(', ')
        } else {
          studentNames = 'Group Students'
        }

        return `${teacherName} & ${studentNames}`

      default:
        return ''
    }
  }

  //  Reload schedules when date/timeslot changes
  $effect(() => {
    const currentDate = booking.data.date
    const timeslotId = booking.data.timeslot.id
    if (currentDate && timeslotId) {
      loadExistingSchedules()
    }
  })

  //  Check conflict across both collections with proper field mapping
  const checkConflictInCollection = async (collection, baseFilter, resourceType, resourceId) => {
    try {
      let filter = baseFilter

      // Handle different field names between collections
      if (collection === 'groupLessonSchedule') {
        if (resourceType === 'student') {
          // Check if student is in the student array (note: field is "student", not "students")
          filter += ` && student ~ "${resourceId}"`
        } else if (resourceType === 'teacher') {
          filter += ` && teacher = "${resourceId}"`
        } else if (resourceType === 'room') {
          // Use "grouproom" field instead of "room"
          filter += ` && grouproom = "${resourceId}"`
        }

        console.log(`Checking groupLessonSchedule with filter: ${filter}`)

        await pb.collection(collection).getFirstListItem(filter, {
          expand: 'teacher,student,grouproom,subject',
        })
      } else {
        // lessonSchedule collection
        if (resourceType === 'student') {
          filter += ` && student = "${resourceId}"`
        } else if (resourceType === 'teacher') {
          filter += ` && teacher = "${resourceId}"`
        } else if (resourceType === 'room') {
          filter += ` && room = "${resourceId}"`
        }

        console.log(`Checking lessonSchedule with filter: ${filter}`)

        await pb.collection(collection).getFirstListItem(filter, {
          expand: 'teacher,student,room',
        })
      }

      return true
    } catch (error) {
      console.log(`No conflict found in ${collection}: ${error.status || error.message || 'not found'}`)
      // If it's a 400 error on groupLessonSchedule, the collection might not exist or have different schema
      if (error.status === 400 && collection === 'groupLessonSchedule') {
        console.warn('groupLessonSchedule collection may not exist or have different field names')
      }
      return false
    }
  }

  const checkConflict = async (resourceType, resourceId, excludeCurrentRecord = false) => {
    const currentDate = booking.data.date
    const timeslotId = booking.data.timeslot.id

    if (!currentDate || !timeslotId) return false

    // Check individual lessons (lessonSchedule)
    let lessonBaseFilter = `date = "${currentDate}" && timeslot = "${timeslotId}"`

    // Add exclusion for edit mode (only for the same collection type)
    if (excludeCurrentRecord && booking.data.mode === 'edit' && booking.data.id) {
      lessonBaseFilter += ` && id != "${booking.data.id}"`
    }

    const lessonConflict = await checkConflictInCollection('lessonSchedule', lessonBaseFilter, resourceType, resourceId)
    if (lessonConflict) return true

    // Try to check group lessons, but skip if collection has issues
    try {
      const groupBaseFilter = `date = "${currentDate}" && timeslot = "${timeslotId}"`
      const groupConflict = await checkConflictInCollection(
        'groupLessonSchedule',
        groupBaseFilter,
        resourceType,
        resourceId
      )
      if (groupConflict) return true
    } catch (error) {
      console.warn('Skipping groupLessonSchedule check due to collection issues:', error)
    }

    return false
  }

  //  Delete schedule
  const deleteSchedule = async () => {
    const { data } = booking

    if (!data.id) {
      toast.error('No schedule selected to delete', {
        position: 'bottom-right',
        duration: 3000,
      })
      return
    }

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

      toast.success('Schedule deleted successfully!', {
        position: 'bottom-right',
        duration: 3000,
      })

      dispatch('refresh')
      document.getElementById('editModal').close()
    } catch (error) {
      console.error('Error deleting schedule:', error)
      toast.error(`Failed to delete schedule: ${error.message}`, {
        position: 'bottom-right',
        duration: 5000,
      })
    } finally {
      isDeleting = false
    }
  }

  //  Save schedule with proper conflict checking
  const saveData = async () => {
    const { data } = booking

    const required = [
      { field: data.teacher.id, msg: 'Please select Teacher' },
      { field: data.student.id, msg: 'Please select Student' },
      { field: data.subject.id, msg: 'Please select Subject' },
      { field: data.timeslot.id, msg: 'Please select Timeslot' },
      { field: data.date, msg: 'Please select Date' },
    ]

    for (const { field, msg } of required) {
      if (!field) {
        toast.error(msg, { position: 'bottom-right', duration: 3000 })
        return
      }
    }

    // Check conflicts using the new function
    const isEditMode = data.mode === 'edit' && data.id

    if (await checkConflict('teacher', data.teacher.id, isEditMode)) {
      toast.error('Teacher conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${data.teacher.name} is already booked at this timeslot`,
      })
      return
    }

    if (await checkConflict('student', data.student.id, isEditMode)) {
      toast.error('Student conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${data.student.name} has another lesson scheduled`,
      })
      return
    }

    if (await checkConflict('room', data.room.id, isEditMode)) {
      toast.error('Room conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${data.room.name} is already occupied`,
      })
      return
    }

    // Edit mode
    if (isEditMode) {
      try {
        await pb.collection('lessonSchedule').update(data.id, {
          date: data.date,
          timeslot: data.timeslot.id,
          teacher: data.teacher.id,
          student: data.student.id,
          subject: data.subject.id,
          room: data.room.id,
        })

        toast.success('Schedule updated!', {
          position: 'bottom-right',
          duration: 3000,
          description: `Changes saved for ${data.teacher.name} and ${data.student.name}`,
        })

        dispatch('refresh')
        document.getElementById('editModal').close()
      } catch (error) {
        toast.error('Update failed', {
          position: 'bottom-right',
          duration: 5000,
          description: error.message,
        })
      }
      return
    }

    // Create mode
    try {
      await pb.collection('lessonSchedule').create({
        date: data.date,
        timeslot: data.timeslot.id,
        teacher: data.teacher.id,
        student: data.student.id,
        subject: data.subject.id,
        room: data.room.id,
      })

      toast.success('Schedule created!', {
        position: 'bottom-right',
        duration: 5000,
        description: `
          teacher: ${data.teacher.name ?? 'N/A'} 
          student: ${data.student.name ?? 'N/A'} 
          subject: ${data.subject.name ?? 'N/A'}
          room: ${data.room.name ?? 'N/A'}
          timeslot: ${data.timeslot.start} - ${data.timeslot.end}
          date: ${new Date(data.date).toLocaleDateString()}
        `,
      })

      dispatch('refresh')
      document.getElementById('editModal').close()
    } catch (error) {
      toast.error('Creation failed', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    }
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
          <legend class="fieldset-legend font-semibold text-gray-700">Date</legend>
          <input type="date" bind:value={booking.data.date} class="input input-bordered w-full" required />
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
    </div>

    <!-- Buttons -->
    <div class="modal-action">
      {#if booking.data.mode === 'edit' && booking.data.id}
        <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={isDeleting}>
          {#if isDeleting}
            <span class="loading loading-spinner loading-sm"></span>
            Deleting...
          {:else}
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
