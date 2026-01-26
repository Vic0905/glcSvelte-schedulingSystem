<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  let { show = $bindable(false), mondayBooking = $bindable(), onSave } = $props()

  // Store reference data
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let timeslots = $state([])

  // Load reference data ONCE
  onMount(async () => {
    if (teachers.length === 0) {
      await loadAllData()
    }
  })

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }), // KEEP status field
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }), // KEEP status field
        pb.collection('subject').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('timeSlot').getFullList({ sort: 'start', fields: 'id,start,end' }),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    }
  }

  const checkForConflicts = async () => {
    const { teacher, student, timeslot } = mondayBooking

    if (!teacher?.id || !student?.id || !timeslot?.id) return true // No conflicts yet

    try {
      // 1. Check Monday individual advance bookings
      let mondayIndividualFilter = `timeslot = "${timeslot.id}" && (teacher = "${teacher.id}" || student = "${student.id}")`

      if (mondayBooking.mode === 'edit' && mondayBooking.id) {
        mondayIndividualFilter += ` && id != "${mondayBooking.id}"`
      }

      const [mondayIndividualBookings, mondayGroupBookings, studentRecords] = await Promise.all([
        pb.collection('mondayAdvanceBooking').getFullList({
          filter: mondayIndividualFilter,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        // 2. Check Monday group advance bookings
        pb.collection('mondayAdvanceGroupBooking').getFullList({
          filter: `timeslot = "${timeslot.id}"`,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        // 3. Get student names for reference
        pb.collection('student').getFullList({
          fields: 'id,englishName',
          $autoCancel: false,
        }),
      ])

      // Create a map of student IDs to names for quick lookup
      const studentMap = new Map()
      studentRecords.forEach((s) => studentMap.set(s.id, s.englishName))

      // Combine both types of Monday bookings for conflict checking
      const allMondayBookings = [...mondayIndividualBookings, ...mondayGroupBookings]

      // Check for teacher conflicts in Monday bookings
      const teacherConflict = allMondayBookings.find((b) => {
        return b.teacher === teacher.id
      })

      if (teacherConflict) {
        const teacherName =
          teacherConflict.expand?.teacher?.name ||
          teachers.find((t) => t.id === teacherConflict.teacher)?.name ||
          'Unknown Teacher'

        // Determine if it's a group booking
        const isGroupBooking = Array.isArray(teacherConflict.student)

        if (isGroupBooking) {
          const studentCount = Array.isArray(teacherConflict.student) ? teacherConflict.student.length : 0
          toast.error(
            `${teacherName} is already teaching a Monday group lesson (${studentCount} students) for this timeslot`
          )
        } else {
          // Individual booking conflict
          const studentId = teacherConflict.student
          const studentName =
            teacherConflict.expand?.student?.englishName || studentMap.get(studentId) || 'Unknown Student'
          toast.error(`${teacherName} is already booked with ${studentName} for Monday at this timeslot`)
        }
        return false
      }

      // Check for student conflicts in Monday bookings
      const studentConflict = allMondayBookings.find((b) => {
        // Check for individual booking conflict
        if (b.student === student.id) return true

        // Check for group booking conflict
        if (Array.isArray(b.student) && b.student.includes(student.id)) return true

        return false
      })

      if (studentConflict) {
        const currentStudentName = mondayBooking.student?.englishName || studentMap.get(student.id) || 'Unknown Student'

        // Check if it's a group booking
        const isGroupBooking = Array.isArray(studentConflict.student)

        if (isGroupBooking) {
          const teacherId = studentConflict.teacher
          const teacherName =
            studentConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          toast.error(`${currentStudentName} is already in a Monday group lesson with ${teacherName} for this timeslot`)
        } else {
          // Individual booking conflict
          const teacherId = studentConflict.teacher
          const teacherName =
            studentConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          toast.error(`${currentStudentName} is already booked with ${teacherName} for Monday at this timeslot`)
        }
        return false
      }

      return true
    } catch (error) {
      console.error('Error checking conflicts:', error)
      return true // Allow save on error
    }
  }

  const validateForm = () => {
    const { teacher, student, subject, timeslot, room } = mondayBooking

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
    if (!room?.id) {
      toast.error('Please select Room')
      return false
    }

    return true
  }

  const saveMondayBooking = async () => {
    if (!validateForm()) return

    // Check for conflicts and show toast if found
    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { timeslot, teacher, student, subject, room, mode, id } = mondayBooking

    const bookingData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
    }

    toast.promise(
      async () => {
        let savedBooking
        if (mode === 'edit' && id) {
          savedBooking = await pb.collection('mondayAdvanceBooking').update(id, bookingData)
          return 'Monday booking updated successfully!'
        } else {
          savedBooking = await pb.collection('mondayAdvanceBooking').create(bookingData)
          return 'Monday booking created successfully!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          closeModal()
          onSave()
          return 'Monday booking saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
  }

  const deleteMondayBooking = async () => {
    if (!mondayBooking.id) return

    const { subject, teacher, student, room, timeslot } = mondayBooking

    const confirmMessage =
      `Are you sure you want to delete this Monday booking?\n\n` +
      `Subject: ${subject.name}\n` +
      `Teacher: ${teacher.name}\n` +
      `Student: ${student.englishName}\n` +
      `Room: ${room.name}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    toast.promise(
      async () => {
        await pb.collection('mondayAdvanceBooking').delete(mondayBooking.id)
      },
      {
        loading: 'Deleting...',
        success: () => {
          closeModal()
          onSave()
          return 'Monday booking deleted successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to delete: ${error.message}`
        },
      }
    )
  }

  const closeModal = () => {
    show = false
  }
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {mondayBooking.mode === 'edit' ? 'Edit' : 'Create'} Monday Template
      </h3>

      <div class="alert alert-info">
        <span>ℹ️ This template will be used to create Monday schedules when published</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
            <select
              class="select select-bordered w-full"
              bind:value={mondayBooking.subject.id}
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
            <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
            <select
              class="select select-bordered w-full"
              bind:value={mondayBooking.student.id}
              disabled={students.length === 0}
              required
            >
              <option value="">Select Student</option>
              {#each students as student (student.id)}
                {#if student.status !== 'graduated' || student.id === mondayBooking.student.id}
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
            <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
            <select
              class="select select-bordered w-full"
              bind:value={mondayBooking.teacher.id}
              disabled={teachers.length === 0}
              required
            >
              <option value="">Select Teacher</option>
              {#each teachers as teacher}
                {#if teacher.status !== 'disabled' || teacher.id === mondayBooking.teacher.id}
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
              bind:value={mondayBooking.timeslot.id}
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
            <input type="text" value={mondayBooking.room.name} class="input input-bordered w-full" readonly />
          </fieldset>
        </div>
      </div>

      <!-- Buttons -->
      <div class="modal-action">
        {#if mondayBooking.mode === 'edit' && mondayBooking.id}
          <button class="btn btn-error mr-auto" onclick={deleteMondayBooking}>
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

        <button class="btn btn-primary" onclick={saveMondayBooking}>
          {mondayBooking.mode === 'edit' ? 'Update' : 'Create'}
        </button>

        <button class="btn" onclick={closeModal}>Close</button>
      </div>
    </div>
  </dialog>
{/if}
