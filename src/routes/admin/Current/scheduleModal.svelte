<script>
  import { booking } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte.js'

  const dispatch = createEventDispatcher()

  let isDeleting = $state(false)
  let isSaving = $state(false)

  // Store reference data
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // Load reference data ONCE
  $effect(() => {
    if (teachers.length === 0) {
      loadAllData()
    }
  })

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

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, roomsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList({
          sort: 'name',
          fields: 'id,name,status',
        }),
        pb.collection('student').getFullList({
          sort: 'englishName',
          fields: 'id,englishName,status',
        }),
        pb.collection('subject').getFullList({
          sort: 'name',
          fields: 'id,name',
        }),
        pb.collection('room').getFullList({
          sort: 'name',
          fields: 'id,name',
        }),
        pb.collection('timeSlot').getFullList({
          sort: 'start',
          fields: 'id,start,end',
        }),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      rooms = roomsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
      toast.error('Failed to load data')
    }
  }

  const checkForConflicts = async () => {
    const { teacher, student, timeslot, room, startDate, endDate, mode } = booking.data
    if (!teacher?.id || !student?.id || !timeslot?.id || !room?.id) return true

    try {
      const weekDays = getWeekDays(startDate, endDate)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // 1. Get IDs to exclude if editing (keep this part)
      let excludeIds = []
      if (mode === 'edit') {
        const existing = await pb
          .collection('lessonSchedule')
          .getFullList({
            filter: `student = "${booking.data.originalStudentId || student.id}" && timeslot = "${timeslot.id}" && (${dateFilter})`,
            fields: 'id',
          })
          .catch(() => [])
        excludeIds = existing.map((s) => s.id)
      }

      // 2. THE OPTIMIZED CALL: Fetch all potential conflicts for individual lessons in ONE go
      let individualFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && (teacher = "${teacher.id}" || student = "${student.id}" || room = "${room.id}")`

      if (excludeIds.length > 0) {
        const excludeFilter = excludeIds.map((id) => `id != "${id}"`).join(' && ')
        individualFilter += ` && (${excludeFilter})`
      }

      // We still need group lessons because they live in a different collection
      const [individualBookings, groupBookings] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: individualFilter,
          expand: 'teacher,student,room',
          $autoCancel: false,
        }),
        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `(${dateFilter}) && timeslot = "${timeslot.id}"`, // Simplified check
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      // 3. LOGIC CHECK (In-memory)

      // Check Teacher Conflict
      const tConflict =
        individualBookings.find((b) => b.teacher === teacher.id) || groupBookings.find((b) => b.teacher === teacher.id)
      if (tConflict) {
        toast.error(`Teacher is already booked for this timeslot`)
        return false
      }

      // Check Student Conflict
      const sConflict =
        individualBookings.find((b) => b.student === student.id) ||
        groupBookings.find((b) => Array.isArray(b.student) && b.student.includes(student.id))
      if (sConflict) {
        toast.error(`Student is already booked for this timeslot`)
        return false
      }

      // Check Room Conflict
      const rConflict =
        individualBookings.find((b) => b.room === room.id) || groupBookings.find((b) => b.grouproom === room.id)
      if (rConflict) {
        toast.error(`Room is already occupied for this timeslot`)
        return false
      }

      return true
    } catch (error) {
      console.error('Error checking conflicts:', error)
      return true
    }
  }

  const validateForm = () => {
    const { teacher, student, subject, timeslot, startDate, endDate, room } = booking.data

    if (!teacher?.id) {
      toast.error('Please select Teacher')
      return false
    }
    if (!student?.id) {
      toast.error('Please select Student')
      return false
    }
    if (!subject?.id) {
      toast.error('Please select Subject')
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
    if (!room?.id) {
      toast.error('Please select Room')
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

  const saveSchedule = async () => {
    if (!validateForm()) return

    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { timeslot, teacher, student, subject, room, mode, startDate, endDate } = booking.data
    const weekDays = getWeekDays(startDate, endDate)

    const scheduleData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
    }

    toast.promise(
      async () => {
        // 1. Initialize the Batch
        const batch = pb.createBatch()

        if (mode === 'edit') {
          const originalStudentId = booking.data.originalStudentId || student.id
          const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
          const originalRoomId = booking.data.originalRoomId || room.id

          const existingWeekSchedules = await pb.collection('lessonSchedule').getFullList({
            filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${originalRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
          })

          // 2. Add updates to the batch
          existingWeekSchedules.forEach((schedule) => {
            batch.collection('lessonSchedule').update(schedule.id, { ...scheduleData, date: schedule.date })
          })

          // 3. Execute batch
          await batch.send()
          return 'Weekly schedule updated!'
        } else {
          // 2. Add creations to the batch
          weekDays.forEach((date) => {
            batch.collection('lessonSchedule').create({ ...scheduleData, date })
          })

          // 3. Execute batch
          await batch.send()
          return 'Weekly schedule created!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          booking.data = null
          dispatch('refresh')
          return 'Schedule saved successfully!'
        },
        error: (error) => `Failed to save: ${error.message}`,
      }
    )
  }

  const deleteSchedule = async () => {
    if (!booking.data.id) return

    const { startDate, endDate, student, room, timeslot } = booking.data
    const weekDays = getWeekDays(startDate, endDate)

    if (!confirm(`Are you sure you want to delete all ${weekDays.length} lessons?`)) return

    toast.promise(
      async () => {
        const originalStudentId = booking.data.originalStudentId || student.id
        const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
        const originalRoomId = booking.data.originalRoomId || room.id

        const schedulesToDelete = await pb.collection('lessonSchedule').getFullList({
          filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${originalRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
        })

        // 1. Initialize Batch
        const batch = pb.createBatch()

        // 2. Add delete actions
        schedulesToDelete.forEach((schedule) => {
          batch.collection('lessonSchedule').delete(schedule.id)
        })

        // 3. Send Batch
        await batch.send()
      },
      {
        loading: 'Deleting...',
        success: () => {
          booking.data = null
          dispatch('refresh')
          return 'Weekly schedule deleted!'
        },
        error: (error) => `Failed to delete: ${error.message}`,
      }
    )
  }
</script>

<!-- Dialog always in DOM, content conditionally rendered -->
{#if booking.data}
  <dialog id="editModal" class="modal modal-open">
    <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
      {#if booking.data?.teacher && booking.data?.student && booking.data?.subject && booking.data?.room && booking.data?.timeslot}
        <h3 class="text-xl font-bold text-center">
          {booking.data.mode === 'edit' ? 'Edit' : 'Create'} Weekly Schedule
        </h3>

        <div class="alert alert-info text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <span>
            This will {booking.data.mode === 'edit' ? 'update' : 'create'} schedules for Tuesday through Friday (4 lessons
            per week)
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Left column -->
          <div class="space-y-4">
            <fieldset class="fieldset">
              <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
              <select
                class="select select-bordered w-full"
                bind:value={booking.data.student.id}
                disabled={students.length === 0}
                required
              >
                <option value="">Select Student</option>
                {#each students as student (student.id)}
                  {#if student.status !== 'graduated' || student.id === booking.data.student.id}
                    <option
                      value={student.id}
                      disabled={student.status === 'graduated'}
                      class:italic={student.status === 'graduated'}
                    >
                      {student.englishName}
                      {#if student.status === 'graduated'}(Graduated){/if}
                    </option>
                  {/if}
                {/each}
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
              <select
                class="select select-bordered w-full"
                bind:value={booking.data.subject.id}
                disabled={subjects.length === 0}
                required
              >
                <option value="">Select Subject</option>
                {#each subjects as subject}
                  <option value={subject.id}>{subject.name}</option>
                {/each}
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
              <select
                class="select select-bordered w-full"
                bind:value={booking.data.teacher.id}
                disabled={teachers.length === 0}
                required
              >
                <option value="">Select Teacher</option>
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
            </fieldset>
          </div>

          <!-- Right column -->
          <div class="space-y-4">
            <fieldset class="fieldset">
              <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
              <select
                class="select select-bordered w-full"
                bind:value={booking.data.timeslot.id}
                disabled={timeslots.length === 0}
                required
              >
                <option value="">Select Timeslot</option>
                {#each timeslots as slot}
                  <option value={slot.id}>{slot.start} - {slot.end}</option>
                {/each}
              </select>
            </fieldset>

            <fieldset class="fieldset">
              <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
              <select
                class="select select-bordered w-full"
                bind:value={booking.data.room.id}
                disabled={rooms.length === 0}
                required
              >
                <option value="">Select Room</option>
                {#each rooms as room}
                  <option value={room.id}>{room.name}</option>
                {/each}
              </select>
            </fieldset>
          </div>
        </div>

        <!-- Buttons -->
        <div class="modal-action">
          {#if booking.data.mode === 'edit' && booking.data.id}
            <button class="btn btn-error mr-auto" onclick={deleteSchedule}> Delete Week </button>
          {/if}

          <button class="btn btn-primary" onclick={saveSchedule}>
            {booking.data.mode === 'edit' ? 'Update' : 'Save'} Week
          </button>

          <button class="btn" onclick={() => (booking.data = null)}>Close</button>
        </div>
      {:else}
        <!-- Loading fallback -->
        <div class="flex justify-center items-center py-10">
          <span class="loading loading-spinner loading-lg"></span>
        </div>
        <form method="dialog" class="modal-action">
          <button class="btn">Close</button>
        </form>
      {/if}
    </div>
  </dialog>
{/if}
