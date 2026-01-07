<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  let { show = $bindable(false), advanceBooking = $bindable(), onSave } = $props()

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
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }),
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
    const { teacher, student, timeslot } = advanceBooking

    if (!teacher?.id || !student?.id || !timeslot?.id) return true // No conflicts yet

    try {
      // 1. Check individual advance bookings
      let individualFilter = `timeslot = "${timeslot.id}" && (teacher = "${teacher.id}" || student = "${student.id}")`

      if (advanceBooking.mode === 'edit' && advanceBooking.id) {
        individualFilter += ` && id != "${advanceBooking.id}"`
      }

      const [individualBookings, groupBookings, studentRecords] = await Promise.all([
        pb.collection('advanceBooking').getFullList({
          filter: individualFilter,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        // 2. Check group advance bookings
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `timeslot = "${timeslot.id}"`,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => []), // Handle case if collection doesn't exist or error

        // 3. Get student names for reference
        pb
          .collection('student')
          .getFullList({
            filter: 'id != ""', // Get all students
            fields: 'id,englishName',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      // Create a map of student IDs to names for quick lookup
      const studentMap = new Map()
      studentRecords.forEach((s) => studentMap.set(s.id, s.englishName))

      // Combine both types of bookings for conflict checking
      const allBookings = [...individualBookings, ...groupBookings]

      // Check for teacher conflicts
      const teacherConflict = allBookings.find((b) => {
        // Check based on collection type or structure
        if (b.collectionName === 'groupAdvanceBooking' || b.collectionId === 'groupAdvanceBooking') {
          return b.teacher === teacher.id
        }
        return b.teacher === teacher.id
      })

      if (teacherConflict) {
        const teacherName =
          teacherConflict.expand?.teacher?.name ||
          teachers.find((t) => t.id === teacherConflict.teacher)?.name ||
          'Unknown Teacher'

        // Determine if it's a group lesson
        const isGroupLesson =
          teacherConflict.collectionName === 'groupAdvanceBooking' ||
          teacherConflict.collectionId === 'groupAdvanceBooking' ||
          Array.isArray(teacherConflict.student)

        if (isGroupLesson) {
          const studentCount = Array.isArray(teacherConflict.student) ? teacherConflict.student.length : 0
          toast.error(`${teacherName} is already teaching a group lesson (${studentCount} students) for this timeslot`)
        } else {
          // For individual booking
          const studentId = teacherConflict.student
          const studentName =
            teacherConflict.expand?.student?.englishName || studentMap.get(studentId) || 'Unknown Student'
          toast.error(`${teacherName} is already booked with ${studentName} for this timeslot`)
        }
        return false
      }

      // Check for student conflicts
      const studentConflict = allBookings.find((b) => {
        if (b.collectionName === 'groupAdvanceBooking' || b.collectionId === 'groupAdvanceBooking') {
          // For group bookings, student is an array
          return Array.isArray(b.student) && b.student.includes(student.id)
        }
        // For individual bookings
        return b.student === student.id
      })

      if (studentConflict) {
        const currentStudentName =
          advanceBooking.student?.englishName || studentMap.get(student.id) || 'Unknown Student'

        // Determine if it's a group lesson
        const isGroupLesson =
          studentConflict.collectionName === 'groupAdvanceBooking' ||
          studentConflict.collectionId === 'groupAdvanceBooking' ||
          Array.isArray(studentConflict.student)

        if (isGroupLesson) {
          const teacherId = studentConflict.teacher
          const teacherName =
            studentConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          toast.error(`${currentStudentName} is already in a group lesson with ${teacherName} for this timeslot`)
        } else {
          // For individual booking
          const teacherId = studentConflict.teacher
          const teacherName =
            studentConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          toast.error(`${currentStudentName} is already booked with ${teacherName} for this timeslot`)
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
    const { teacher, student, subject, timeslot, room } = advanceBooking

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

  const saveAdvanceBooking = async () => {
    if (!validateForm()) return

    // Check for conflicts and show toast if found
    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { timeslot, teacher, student, subject, room, mode, id } = advanceBooking

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
          savedBooking = await pb.collection('advanceBooking').update(id, bookingData)
          return 'Advance booking updated successfully!'
        } else {
          savedBooking = await pb.collection('advanceBooking').create(bookingData)
          return 'Advance booking created successfully!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          closeModal()
          onSave()
          return 'Advance booking saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
  }

  const deleteAdvanceBooking = async () => {
    if (!advanceBooking.id) return

    const { subject, teacher, student, room, timeslot } = advanceBooking

    const confirmMessage =
      `Are you sure you want to delete this advance booking?\n\n` +
      `Subject: ${subject.name}\n` +
      `Teacher: ${teacher.name}\n` +
      `Student: ${student.englishName}\n` +
      `Room: ${room.name}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    toast.promise(
      async () => {
        await pb.collection('advanceBooking').delete(advanceBooking.id)
      },
      {
        loading: 'Deleting...',
        success: () => {
          closeModal()
          onSave()
          return 'Advance booking deleted successfully!'
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
        {advanceBooking.mode === 'edit' ? 'Edit' : 'Create'} Weekly Template
      </h3>

      <div class="alert alert-info">
        <span>ℹ️ This template will be used to create schedules for Tuesday-Friday when published</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
            <select
              class="select select-bordered w-full"
              bind:value={advanceBooking.student.id}
              disabled={students.length === 0}
              required
            >
              <option value="">Select Student</option>
              {#each students as student (student.id)}
                {#if student.status !== 'graduated' || student.id === advanceBooking.student.id}
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
              bind:value={advanceBooking.subject.id}
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
              bind:value={advanceBooking.teacher.id}
              disabled={teachers.length === 0}
              required
            >
              <option value="">Select Teacher</option>
              {#each teachers as teacher}
                {#if teacher.status !== 'disabled' || teacher.id === advanceBooking.teacher.id}
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
              bind:value={advanceBooking.timeslot.id}
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
            <input type="text" value={advanceBooking.room.name} class="input input-bordered w-full" readonly />
          </fieldset>
        </div>
      </div>

      <!-- Buttons -->
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
