<script>
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let { show = $bindable(false), advanceBooking = $bindable(), onSave } = $props()

  let existingBookings = $state([])

  const getTeacher = async () => await pb.collection('teacher').getFullList()
  const getStudent = async () => await pb.collection('student').getFullList()
  const getSubject = async () => await pb.collection('subject').getFullList()

  const loadExistingBookings = async () => {
    try {
      const timeslotId = advanceBooking.timeslot.id
      if (!timeslotId) {
        existingBookings = []
        return
      }
      const records = await pb.collection('advanceBooking').getFullList({
        filter: `timeslot = "${timeslotId}"${advanceBooking.mode === 'edit' && advanceBooking.id ? ` && id != "${advanceBooking.id}"` : ''}`,
        expand: 'teacher,student,room',
      })
      existingBookings = records
    } catch (error) {
      console.error('Error loading existing bookings:', error)
      existingBookings = []
    }
  }

  const isTeacherBooked = (teacherId) => {
    return existingBookings.some((booking) => booking.teacher === teacherId)
  }

  const isStudentBooked = (studentId) => {
    return existingBookings.some((booking) => booking.student === studentId)
  }

  const isRoomBooked = (roomId) => {
    return existingBookings.some((booking) => booking.room === roomId)
  }

  const getConflictInfo = (resourceId, type) => {
    const booking = existingBookings.find((s) => s[type] === resourceId)
    if (!booking) return ''
    switch (type) {
      case 'teacher':
        return booking.expand?.student?.name || 'Unknown Student'
      case 'student':
        return booking.expand?.teacher?.name || 'Unknown Teacher'
      case 'room':
        return `${booking.expand?.teacher?.name || 'Unknown Teacher'} & ${booking.expand?.student?.name || 'Unknown Student'}`
      default:
        return ''
    }
  }

  const checkConflict = async (collection, filter) => {
    try {
      await pb.collection(collection).getFirstListItem(filter)
      return true
    } catch {
      return false
    }
  }

  const saveAdvanceBooking = async () => {
    try {
      const { data } = { data: advanceBooking }
      const required = [
        { field: data.teacher.id, msg: 'Please select Teacher' },
        { field: data.student.id, msg: 'Please select Student' },
        { field: data.subject.id, msg: 'Please select Subject' },
      ]
      for (const { field, msg } of required) {
        if (!field) {
          toast.error(msg)
          return
        }
      }
      if (data.mode === 'edit' && data.id) {
        const excludeId = `&& id != "${data.id}"`
        if (
          await checkConflict(
            'advanceBooking',
            `teacher = "${data.teacher.id}" && timeslot = "${data.timeslot.id}" ${excludeId}`
          )
        ) {
          toast.error('Teacher is already booked at this timeslot')
          return
        }
        if (
          await checkConflict(
            'advanceBooking',
            `room = "${data.room.id}" && timeslot = "${data.timeslot.id}" ${excludeId}`
          )
        ) {
          toast.error('Room is already occupied at this timeslot')
          return
        }
        await pb.collection('advanceBooking').update(data.id, {
          timeslot: data.timeslot.id,
          teacher: data.teacher.id,
          student: data.student.id,
          subject: data.subject.id,
          room: data.room.id,
        })
        toast.success('Advance booking updated successfully')
      } else {
        if (
          await checkConflict('advanceBooking', `teacher = "${data.teacher.id}" && timeslot = "${data.timeslot.id}"`)
        ) {
          toast.error('Teacher is already booked at this timeslot')
          return
        }
        if (await checkConflict('advanceBooking', `room = "${data.room.id}" && timeslot = "${data.timeslot.id}"`)) {
          toast.error('Room is already occupied at this timeslot')
          return
        }
        const bookingData = {
          room: data.room.id,
          timeslot: data.timeslot.id,
          teacher: data.teacher.id,
          student: data.student.id,
          subject: data.subject.id,
        }
        await pb.collection('advanceBooking').create(bookingData)
        toast.success('Advance booking created successfully')
      }
      closeModal()
      onSave()
    } catch (error) {
      console.error('Error saving advance booking:', error)
      toast.error('Failed to save advance booking')
    }
  }

  const deleteAdvanceBooking = async () => {
    if (!advanceBooking.id) return
    const confirmDelete = confirm(
      `Are you sure you want to delete this advance booking?\n\n` +
        `Subject: ${advanceBooking.subject.name}\n` +
        `Teacher: ${advanceBooking.teacher.name}\n` +
        `Student: ${advanceBooking.student.name}\n` +
        `Room: ${advanceBooking.room.name}\n` +
        `Time: ${advanceBooking.timeslot.start} - ${advanceBooking.timeslot.end}\n\n` +
        `This action cannot be undone.`
    )
    if (!confirmDelete) return
    try {
      await pb.collection('advanceBooking').delete(advanceBooking.id)
      toast.success('Advance booking deleted successfully')
      closeModal()
      onSave()
    } catch (error) {
      console.error('Error deleting advance booking:', error)
      toast.error('Failed to delete advance booking')
    }
  }

  const closeModal = () => {
    show = false
  }

  $effect(() => {
    const timeslotId = advanceBooking.timeslot.id
    if (timeslotId) {
      loadExistingBookings()
    }
  })
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {advanceBooking.mode === 'edit' ? 'Edit Weekly Template' : 'Create Weekly Template'}
      </h3>

      <div class="alert alert-info">
        <span>ℹ️ This template will be used to create schedules for Monday-Friday when published</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.subject.id} required>
              <option value="" disabled selected>Select Subject</option>
              {#await getSubject()}
                <option disabled>Fetching...</option>
              {:then data}
                {#each data as subject}
                  <option value={subject.id}>{subject.name}</option>
                {/each}
              {/await}
            </select>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.student.id} required>
              <option value="" disabled selected>Select Student</option>
              {#await getStudent()}
                <option disabled>Fetching...</option>
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
            {#if advanceBooking.student.id && isStudentBooked(advanceBooking.student.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This student is already booked for this timeslot </span>
              </div>
            {/if}
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
            <input
              type="text"
              value="{advanceBooking.timeslot.start} - {advanceBooking.timeslot.end}"
              class="input input-bordered w-full"
              readonly
            />
          </fieldset>
        </div>

        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.teacher.id} required>
              <option value="" disabled selected>Select Teacher</option>
              {#await getTeacher()}
                <option disabled>Fetching...</option>
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
            {#if advanceBooking.teacher.id && isTeacherBooked(advanceBooking.teacher.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This teacher is already booked for this timeslot </span>
              </div>
            {/if}
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
            <input type="text" value={advanceBooking.room.name} class="input input-bordered w-full" readonly />
            {#if advanceBooking.room.id && isRoomBooked(advanceBooking.room.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This room is already occupied for this timeslot </span>
              </div>
            {/if}
          </fieldset>
        </div>
      </div>

      <div class="modal-action">
        {#if advanceBooking.mode === 'edit' && advanceBooking.id}
          <button class="btn btn-error mr-auto" onclick={deleteAdvanceBooking}>
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
          </button>
        {/if}

        <button class="btn btn-primary" onclick={saveAdvanceBooking}>
          {advanceBooking.mode === 'edit' ? 'Update' : 'Create'}
        </button>

        <button class="btn" onclick={closeModal}>Close</button>
      </div>
    </div>
  </dialog>
{/if}
