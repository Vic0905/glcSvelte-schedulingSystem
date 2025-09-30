<script>
  import { booking } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte.js'

  const dispatch = createEventDispatcher()

  let isDeleting = $state(false)
  let existingSchedules = $state([])
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // Load all reference data once
  const loadReferenceData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, roomsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList(),
        pb.collection('student').getFullList(),
        pb.collection('subject').getFullList(),
        pb.collection('room').getFullList(),
        pb.collection('timeSlot').getFullList(),
      ])

      teachers = teachersData.sort((a, b) => a.name.localeCompare(b.name))
      students = studentsData.sort((a, b) => a.name.localeCompare(b.name))
      subjects = subjectsData.sort((a, b) => a.name.localeCompare(b.name))
      rooms = roomsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  // Load existing schedules for conflict detection
  const loadExistingSchedules = async () => {
    try {
      const currentDate = booking.data.date
      const timeslotId = booking.data.timeslot.id

      if (!currentDate || !timeslotId) {
        existingSchedules = []
        return
      }

      const [lessonRecords, groupRecords] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: `date = "${currentDate}" && timeslot = "${timeslotId}"${
            booking.data.mode === 'edit' && booking.data.id ? ` && id != "${booking.data.id}"` : ''
          }`,
          expand: 'teacher,student,room',
        }),
        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `date = "${currentDate}" && timeslot = "${timeslotId}"`,
            expand: 'teacher,student,grouproom,subject',
          })
          .catch(() => []), // Handle if collection doesn't exist
      ])

      existingSchedules = [...lessonRecords, ...groupRecords]
    } catch (error) {
      console.error('Error loading schedules:', error)
      existingSchedules = []
    }
  }

  // Conflict detection helpers
  const isResourceBooked = (resourceId, type) => {
    return existingSchedules.some((schedule) => {
      switch (type) {
        case 'teacher':
          return schedule.teacher === resourceId
        case 'student':
          return (
            schedule.student === resourceId ||
            (Array.isArray(schedule.student) && schedule.student.includes(resourceId))
          )
        case 'room':
          return schedule.room === resourceId || schedule.grouproom === resourceId
        default:
          return false
      }
    })
  }

  const getConflictInfo = (resourceId, type) => {
    const schedule = existingSchedules.find((s) => {
      switch (type) {
        case 'teacher':
          return s.teacher === resourceId
        case 'student':
          return s.student === resourceId || (Array.isArray(s.student) && s.student.includes(resourceId))
        case 'room':
          return s.room === resourceId || s.grouproom === resourceId
        default:
          return false
      }
    })

    if (!schedule?.expand) return ''

    switch (type) {
      case 'teacher':
        return Array.isArray(schedule.expand.student)
          ? 'Group Class'
          : schedule.expand.student?.name || 'Unknown Student'
      case 'student':
        return schedule.expand.teacher?.name || 'Unknown Teacher'
      case 'room':
        const teacher = schedule.expand.teacher?.name || 'Unknown Teacher'
        const student = Array.isArray(schedule.expand.student)
          ? schedule.expand.student.map((s) => s.name).join(', ')
          : schedule.expand.student?.name || 'Group Students'
        return `${teacher} & ${student}`
      default:
        return ''
    }
  }

  // Validation and conflict checking
  const validateAndCheckConflicts = () => {
    const { data } = booking

    // Required field validation
    const requiredFields = [
      { field: data.teacher.id, message: 'Please select Teacher' },
      { field: data.student.id, message: 'Please select Student' },
      { field: data.subject.id, message: 'Please select Subject' },
      { field: data.timeslot.id, message: 'Please select Timeslot' },
      { field: data.date, message: 'Please select Date' },
    ]

    for (const { field, message } of requiredFields) {
      if (!field) {
        toast.error(message, { position: 'bottom-right', duration: 3000 })
        return false
      }
    }

    // Conflict checking
    const conflicts = [
      {
        condition: isResourceBooked(data.teacher.id, 'teacher'),
        message: 'Teacher conflict',
        description: `${data.teacher.name} is already booked at this timeslot`,
      },
      {
        condition: isResourceBooked(data.student.id, 'student'),
        message: 'Student conflict',
        description: `${data.student.name} has another lesson scheduled`,
      },
      {
        condition: isResourceBooked(data.room.id, 'room'),
        message: 'Room conflict',
        description: `${data.room.name} is already occupied`,
      },
    ]

    for (const { condition, message, description } of conflicts) {
      if (condition) {
        toast.error(message, { position: 'bottom-right', duration: 5000, description })
        return false
      }
    }

    return true
  }

  // Save schedule
  const saveSchedule = async () => {
    if (!validateAndCheckConflicts()) return

    const { data } = booking
    const scheduleData = {
      date: data.date,
      timeslot: data.timeslot.id,
      teacher: data.teacher.id,
      student: data.student.id,
      subject: data.subject.id,
      room: data.room.id,
    }

    try {
      if (data.mode === 'edit' && data.id) {
        await pb.collection('lessonSchedule').update(data.id, scheduleData)
        toast.success('Schedule updated!', {
          position: 'bottom-right',
          duration: 3000,
          description: `Changes saved for ${data.teacher.name} and ${data.student.name}`,
        })
      } else {
        await pb.collection('lessonSchedule').create(scheduleData)
        toast.success('Schedule created!', {
          position: 'bottom-right',
          duration: 3000,
          description: `New lesson scheduled for ${data.student.name} with ${data.teacher.name}`,
        })
      }

      dispatch('refresh')
      document.getElementById('editModal').close()
    } catch (error) {
      toast.error(`${data.mode === 'edit' ? 'Update' : 'Creation'} failed`, {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    }
  }

  // Delete schedule
  const deleteSchedule = async () => {
    const { data } = booking

    if (!data.id) {
      toast.error('No schedule selected to delete', { position: 'bottom-right', duration: 3000 })
      return
    }

    const confirmMessage =
      `Are you sure you want to delete this schedule?\n\n` +
      `Date: ${new Date(data.date).toLocaleDateString()}\n` +
      `Subject: ${data.subject.name}\n` +
      `Teacher: ${data.teacher.name}\n` +
      `Student: ${data.student.name}\n` +
      `Room: ${data.room.name}\n` +
      `Time: ${data.timeslot.start} - ${data.timeslot.end}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    try {
      isDeleting = true
      await pb.collection('lessonSchedule').delete(data.id)

      toast.success('Schedule deleted successfully!', { position: 'bottom-right', duration: 3000 })
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

  // Load data when modal opens (only when date and timeslot are set)
  $effect(() => {
    if (booking.data.date && booking.data.timeslot.id) {
      loadExistingSchedules()
    }
  })

  // Load reference data once on mount
  $effect(() => {
    if (!teachers.length) {
      loadReferenceData()
    }
  })
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
            {#each students as student}
              {@const isBooked = isResourceBooked(student.id, 'student')}
              {@const conflictInfo = getConflictInfo(student.id, 'student')}
              <option value={student.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                {student.name}
                {#if isBooked}(Booked with {conflictInfo}){/if}
              </option>
            {/each}
          </select>
          {#if booking.data.student.id && isResourceBooked(booking.data.student.id, 'student')}
            <div class="label">
              <span class="label-text-alt text-warning">⚠️ This student is already booked for this timeslot</span>
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
            <option value="">Select Teacher</option>
            {#each teachers as teacher}
              {@const isBooked = isResourceBooked(teacher.id, 'teacher')}
              {@const conflictInfo = getConflictInfo(teacher.id, 'teacher')}
              <option value={teacher.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                {teacher.name}
                {#if isBooked}(Booked with {conflictInfo}){/if}
              </option>
            {/each}
          </select>
          {#if booking.data.teacher.id && isResourceBooked(booking.data.teacher.id, 'teacher')}
            <div class="label">
              <span class="label-text-alt text-warning">⚠️ This teacher is already booked for this timeslot</span>
            </div>
          {/if}
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
          <select class="select select-bordered w-full" bind:value={booking.data.room.id} required>
            <option value="">Select Room</option>
            {#each rooms as room}
              {@const isBooked = isResourceBooked(room.id, 'room')}
              {@const conflictInfo = getConflictInfo(room.id, 'room')}
              <option value={room.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                {room.name}
                {#if isBooked}(Occupied by {conflictInfo}){/if}
              </option>
            {/each}
          </select>
          {#if booking.data.room.id && isResourceBooked(booking.data.room.id, 'room')}
            <div class="label">
              <span class="label-text-alt text-warning">⚠️ This room is already occupied for this timeslot</span>
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

      <button class="btn btn-primary" onclick={saveSchedule}>
        {booking.data.mode === 'edit' ? 'Update' : 'Save'}
      </button>

      <form method="dialog">
        <button class="btn">Close</button>
      </form>
    </div>
  </div>
</dialog>
