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
    const { teacher, student, timeslot, room, startDate, endDate } = booking.data

    if (!teacher?.id || !student?.id || !timeslot?.id || !room?.id) return true

    try {
      const weekDays = getWeekDays(startDate, endDate)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Check for teacher conflicts in BOTH collections
      let teacherFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && teacher = "${teacher.id}"`

      const [teacherIndividualBookings, teacherGroupBookings, studentRecords] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: teacherFilter,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: teacherFilter,
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

      // Check for student conflicts
      let studentFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && student = "${student.id}"`

      const [studentIndividualBookings, studentGroupBookings] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: studentFilter,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `(${dateFilter}) && timeslot = "${timeslot.id}"`,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      // Check individual bookings
      const studentConflict = studentIndividualBookings[0]
      if (studentConflict) {
        const studentName = booking.data.student?.englishName || studentMap.get(student.id) || 'Unknown Student'
        const teacherName = studentConflict.expand?.teacher?.name || 'Unknown Teacher'
        toast.error(`${studentName} is already booked with ${teacherName} for this timeslot`)
        return false
      }

      // Check group bookings
      const studentGroupConflict = studentGroupBookings.find(
        (b) => Array.isArray(b.student) && b.student.includes(student.id)
      )
      if (studentGroupConflict) {
        const studentName = booking.data.student?.englishName || studentMap.get(student.id) || 'Unknown Student'
        const teacherName = studentGroupConflict.expand?.teacher?.name || 'Unknown Teacher'
        toast.error(`${studentName} is already in a group lesson with ${teacherName} for this timeslot`)
        return false
      }

      // Check for room conflicts
      let roomFilter = `(${dateFilter}) && timeslot = "${timeslot.id}" && room = "${room.id}"`

      const [roomIndividualBookings, roomGroupBookings] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: roomFilter,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        pb
          .collection('groupLessonSchedule')
          .getFullList({
            filter: `(${dateFilter}) && timeslot = "${timeslot.id}" && grouproom = "${room.id}"`,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      // Check individual room bookings
      const roomConflict = roomIndividualBookings[0]
      if (roomConflict) {
        const teacherName = roomConflict.expand?.teacher?.name || 'Unknown Teacher'
        const studentName = roomConflict.expand?.student?.englishName || 'Unknown Student'
        toast.error(`Room is already occupied by ${teacherName} & ${studentName} for this timeslot`)
        return false
      }

      // Check group room bookings
      const roomGroupConflict = roomGroupBookings[0]
      if (roomGroupConflict) {
        const teacherName = roomGroupConflict.expand?.teacher?.name || 'Unknown Teacher'
        const studentCount = Array.isArray(roomGroupConflict.student) ? roomGroupConflict.student.length : 0
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

    // Check for conflicts and show toast if found
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
        if (mode === 'edit') {
          const originalStudentId = booking.data.originalStudentId || student.id
          const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
          const originalRoomId = booking.data.originalRoomId || room.id

          const existingWeekSchedules = await pb.collection('lessonSchedule').getFullList({
            filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${originalRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
          })

          // Update all schedules for the week
          await Promise.all(
            existingWeekSchedules.map((schedule) =>
              pb.collection('lessonSchedule').update(schedule.id, { ...scheduleData, date: schedule.date })
            )
          )

          return 'Weekly schedule updated!'
        } else {
          // Create all schedules for the week
          await Promise.all(weekDays.map((date) => pb.collection('lessonSchedule').create({ ...scheduleData, date })))

          return 'Weekly schedule created!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          dispatch('refresh')
          document.getElementById('editModal').close()
          return 'Schedule saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
  }

  const deleteSchedule = async () => {
    if (!booking.data.id) return

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

    toast.promise(
      async () => {
        const originalStudentId = booking.data.originalStudentId || student.id
        const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
        const originalRoomId = booking.data.originalRoomId || room.id

        const schedulesToDelete = await pb.collection('lessonSchedule').getFullList({
          filter: `student = "${originalStudentId}" && timeslot = "${originalTimeslotId}" && room = "${originalRoomId}" && (${weekDays.map((d) => `date = "${d}"`).join(' || ')})`,
        })

        await Promise.all(schedulesToDelete.map((schedule) => pb.collection('lessonSchedule').delete(schedule.id)))
      },
      {
        loading: 'Deleting...',
        success: () => {
          dispatch('refresh')
          document.getElementById('editModal').close()
          return 'Weekly schedule deleted!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to delete: ${error.message}`
        },
      }
    )
  }
</script>

<!-- Dialog always in DOM, content conditionally rendered -->
<dialog id="editModal" class="modal">
  <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
    {#if booking.data?.teacher && booking.data?.student && booking.data?.subject && booking.data?.room && booking.data?.timeslot}
      <h3 class="text-xl font-bold text-center">
        {booking.data.mode === 'edit' ? 'Edit' : 'Create'} Weekly Schedule
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

        <form method="dialog">
          <button class="btn">Close</button>
        </form>
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
