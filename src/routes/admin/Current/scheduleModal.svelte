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

  $effect(() => {
    if (!booking.data) booking.data = {}
    if (!booking.data.subject) booking.data.subject = { name: '', id: '' }
    if (!booking.data.teacher) booking.data.teacher = { name: '', id: '' }
    if (!booking.data.student) booking.data.student = { englishName: '', id: '' }
    if (!booking.data.room) booking.data.room = { name: '', id: '' }
    if (!booking.data.timeslot) booking.data.timeslot = { id: '', start: '', end: '' }
  })

  // Get week days (Tue-Fri)
  const getWeekDays = (startDate, endDate) => {
    const days = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay()
      // Include only Tue(2) to Fri(5)
      if (dayOfWeek >= 2 && dayOfWeek <= 5) {
        days.push(new Date(d).toISOString().split('T')[0])
      }
    }
    return days
  }

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
      students = studentsData.sort((a, b) => a.englishName.localeCompare(b.englishName))
      subjects = subjectsData.sort((a, b) => a.name.localeCompare(b.name))
      rooms = roomsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  // Load existing schedules for conflict detection
  // Load existing schedules for conflict detection
  const loadExistingSchedules = async () => {
    try {
      const startDate = booking.data.startDate
      const endDate = booking.data.endDate
      const timeslotId = booking.data.timeslot.id

      if (!startDate || !endDate || !timeslotId) {
        existingSchedules = []
        return
      }

      const weekDays = getWeekDays(startDate, endDate)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      const [lessonRecords, groupRecords] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: `(${dateFilter}) && timeslot = "${timeslotId}"`,
          expand: 'teacher,student,room',
        }),
        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `(${dateFilter}) && timeslot = "${timeslotId}"`,
            expand: 'teacher,student,grouproom,subject',
          })
          .catch(() => []),
      ])

      // Filter out the current schedule being edited (if in edit mode)
      let allSchedules = [...lessonRecords, ...groupRecords]

      if (
        booking.data.mode === 'edit' &&
        booking.data.teacher?.id &&
        booking.data.student?.id &&
        booking.data.room?.id
      ) {
        allSchedules = allSchedules.filter((schedule) => {
          return !(
            schedule.teacher === booking.data.teacher.id &&
            schedule.student === booking.data.student.id &&
            schedule.room === booking.data.room.id
          )
        })
      }

      existingSchedules = allSchedules
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
          : schedule.expand.student?.englishName || 'Unknown Student'
      case 'student':
        return schedule.expand.teacher?.name || 'Unknown Teacher'
      case 'room':
        const teacher = schedule.expand.teacher?.name || 'Unknown Teacher'
        const student = Array.isArray(schedule.expand.student)
          ? schedule.expand.student.map((s) => s.englishName).join(', ')
          : schedule.expand.student?.englishName || 'Group Students'
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
      { field: data.startDate, message: 'Please select Start Date' },
      { field: data.endDate, message: 'Please select End Date' },
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
        description: `${data.teacher.name} is already booked during this week's timeslot`,
      },
      {
        condition: isResourceBooked(data.student.id, 'student'),
        message: 'Student conflict',
        description: `${data.student.englishName} has another lesson scheduled during this week`,
      },
      {
        condition: isResourceBooked(data.room.id, 'room'),
        message: 'Room conflict',
        description: `${data.room.name} is already occupied during this week`,
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

  // Save schedule for the entire week
  const saveSchedule = async () => {
    if (!validateAndCheckConflicts()) return

    const { data } = booking
    const weekDays = getWeekDays(data.startDate, data.endDate)

    const scheduleData = {
      timeslot: data.timeslot.id,
      teacher: data.teacher.id,
      student: data.student.id,
      subject: data.subject.id,
      room: data.room.id,
    }

    try {
      isSaving = true

      if (data.mode === 'edit' && data.id) {
        // Update: Find all schedules for this student/timeslot/room combo in the week
        // We use the original student ID from when modal was opened to find the right schedules
        const originalStudentId = data.originalStudentId || data.student.id
        const originalTimeslotId = data.originalTimeslotId || data.timeslot.id

        const existingWeekSchedules = await pb.collection('lessonSchedule').getFullList({
          filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${data.room.id}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
        })

        // Update existing schedules with new data
        await Promise.all(
          existingWeekSchedules.map((schedule) =>
            pb.collection('lessonSchedule').update(schedule.id, {
              ...scheduleData,
              date: schedule.date, // Keep original date
            })
          )
        )

        toast.success('Weekly schedule updated!', {
          position: 'bottom-right',
          duration: 3000,
          description: `Updated ${existingWeekSchedules.length} lesson(s) for ${data.student.englishName}`,
        })
      } else {
        // Create: Add schedule for each day in the week (Tue-Fri)
        await Promise.all(
          weekDays.map((date) =>
            pb.collection('lessonSchedule').create({
              ...scheduleData,
              date,
            })
          )
        )

        toast.success('Weekly schedule created!', {
          position: 'bottom-right',
          duration: 3000,
          description: `Created ${weekDays.length} lessons for ${data.student.englishName} (Tue-Fri)`,
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
    } finally {
      isSaving = false
    }
  }

  // Delete schedule for the entire week
  const deleteSchedule = async () => {
    const { data } = booking

    if (!data.id) {
      toast.error('No schedule selected to delete', { position: 'bottom-right', duration: 3000 })
      return
    }

    const weekDays = getWeekDays(data.startDate, data.endDate)

    const confirmMessage =
      `Are you sure you want to delete this WEEKLY schedule?\n\n` +
      `Week: ${new Date(data.startDate).toLocaleDateString()} - ${new Date(data.endDate).toLocaleDateString()}\n` +
      `Days: Tuesday - Friday (${weekDays.length} lessons)\n` +
      `Subject: ${data.subject.name}\n` +
      `Teacher: ${data.teacher.name}\n` +
      `Student: ${data.student.englishName}\n` +
      `Room: ${data.room.name}\n` +
      `Time: ${data.timeslot.start} - ${data.timeslot.end}\n\n` +
      `This will delete ALL ${weekDays.length} lessons for this week. This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    try {
      isDeleting = true

      // Find all schedules using original IDs to ensure we delete the right ones
      const originalStudentId = data.originalStudentId || data.student.id
      const originalTimeslotId = data.originalTimeslotId || data.timeslot.id
      const originalRoomId = data.originalRoomId || data.room.id

      const schedulesToDelete = await pb.collection('lessonSchedule').getFullList({
        filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${originalRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
      })

      // Delete all schedules
      await Promise.all(schedulesToDelete.map((schedule) => pb.collection('lessonSchedule').delete(schedule.id)))

      toast.success('Weekly schedule deleted!', {
        position: 'bottom-right',
        duration: 3000,
        description: `Deleted ${schedulesToDelete.length} lesson(s) successfully`,
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

  // Load data when modal opens
  $effect(() => {
    if (booking.data.startDate && booking.data.endDate && booking.data.timeslot.id) {
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

{#if booking.data && booking.data.teacher && booking.data.student && booking.data.subject && booking.data.room && booking.data.timeslot}
  <dialog id="editModal" class="modal">
    <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.data.mode === 'edit' ? 'Edit Weekly Schedule' : 'Create Weekly Schedule'}
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
          >This will {booking.data.mode === 'edit' ? 'update' : 'create'} schedules for Tuesday through Friday (4 lessons
          per week)</span
        >
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
                {#if student.status !== 'graduated' || student.id === booking.data.student.id}
                  {@const isBooked = isResourceBooked(student.id, 'student')}
                  {@const conflictInfo = getConflictInfo(student.id, 'student')}
                  <option
                    value={student.id}
                    disabled={student.status === 'graduated' || isBooked}
                    class={student.status === 'graduated' ? 'text-gray-400 italic' : isBooked ? 'text-gray-400' : ''}
                  >
                    {student.englishName}
                    {#if student.status === 'graduated'}
                      (Graduated)
                    {:else if isBooked}
                      (Booked with {conflictInfo})
                    {/if}
                  </option>
                {/if}
              {/each}
            </select>

            {#if booking.data.student.id && isResourceBooked(booking.data.student.id, 'student')}
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
                <span class="label-text-alt text-warning">⚠️ This teacher is already booked</span>
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
                <span class="label-text-alt text-warning"
                  >⚠️ This room is already occupied for this week's timeslot</span
                >
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
            {booking.data.mode === 'edit' ? 'Update Week' : 'Save Week'}
          {/if}
        </button>

        <form method="dialog">
          <button class="btn" disabled={isSaving || isDeleting}>Close</button>
        </form>
      </div>
    </div>
  </dialog>
{/if}
