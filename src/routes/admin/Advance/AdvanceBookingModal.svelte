<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), advanceBooking = $bindable(), onSave } = $props()

  let existingBookings = $state([])
  let groupLessonBookings = $state([])
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let timeslots = $state([])

  // Consolidated conflict detection using $derived
  const conflicts = $derived({
    teacher:
      existingBookings.find((b) => b.teacher === advanceBooking.teacher?.id) ||
      groupLessonBookings.find((b) => b.teacher === advanceBooking.teacher?.id),
    student:
      existingBookings.find((b) => b.student === advanceBooking.student?.id) ||
      groupLessonBookings.find((b) => Array.isArray(b.student) && b.student.includes(advanceBooking.student?.id)),
    room: existingBookings.find((b) => b.room === advanceBooking.room?.id),
  })

  // Combined data loading
  $effect(() => {
    if (!teachers.length) {
      loadAllData()
    }
  })

  $effect(() => {
    if (advanceBooking.timeslot?.id) {
      loadExistingBookings()
    }
  })

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList(),
        pb.collection('student').getFullList(),
        pb.collection('subject').getFullList(),
        pb.collection('timeSlot').getFullList(),
      ])

      teachers = teachersData.sort((a, b) => a.name.localeCompare(b.name))
      students = studentsData.sort((a, b) => a.englishName.localeCompare(b.englishName))
      subjects = subjectsData.sort((a, b) => a.name.localeCompare(b.name))
      timeslots = timeslotsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  const loadExistingBookings = async () => {
    try {
      const timeslotId = advanceBooking.timeslot.id
      const excludeFilter =
        advanceBooking.mode === 'edit' && advanceBooking.id ? ` && id != "${advanceBooking.id}"` : ''

      const [advanceRecords, groupRecords] = await Promise.all([
        pb.collection('advanceBooking').getFullList({
          filter: `timeslot = "${timeslotId}"${excludeFilter}`,
          expand: 'teacher,student,room',
        }),
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `timeslot = "${timeslotId}"`,
            expand: 'teacher,student,grouproom',
          })
          .catch(() => []),
      ])

      existingBookings = advanceRecords
      groupLessonBookings = groupRecords
    } catch (error) {
      console.error('Error loading existing bookings:', error)
      existingBookings = []
      groupLessonBookings = []
    }
  }

  const getConflictLabel = (booking, type) => {
    if (!booking?.expand) {
      return type === 'student' ? 'Group Lesson' : 'Unknown'
    }

    // Check if it's a group lesson
    const isGroupLesson = Array.isArray(booking.student)

    switch (type) {
      case 'teacher':
        if (isGroupLesson) {
          const count = booking.student?.length || 0
          return `Group Lesson (${count} students)`
        }
        return booking.expand.student?.englishName || 'Unknown Student'

      case 'student':
        if (isGroupLesson) {
          return `Group Lesson with ${booking.expand.teacher?.name || 'Unknown Teacher'}`
        }
        return booking.expand.teacher?.name || 'Unknown Teacher'

      case 'room':
        const teacher = booking.expand.teacher?.name || 'Unknown Teacher'
        const student = booking.expand.student?.englishName || 'Unknown Student'
        return `${teacher} & ${student}`

      default:
        return 'Unknown'
    }
  }

  const validateAndCheckConflicts = () => {
    const { teacher, student, subject } = advanceBooking

    // Validation
    const validations = [
      [teacher?.id, 'Please select Teacher'],
      [student?.id, 'Please select Student'],
      [subject?.id, 'Please select Subject'],
    ]

    for (const [field, message] of validations) {
      if (!field) {
        toast.error(message)
        return false
      }
    }

    // In-memory conflict checks (no database queries needed)
    if (conflicts.teacher) {
      toast.error('Teacher is already booked at this timeslot')
      return false
    }

    if (conflicts.student) {
      toast.error('Student is already booked at this timeslot')
      return false
    }

    if (conflicts.room) {
      toast.error('Room is already occupied at this timeslot')
      return false
    }

    return true
  }

  const saveAdvanceBooking = async () => {
    if (!validateAndCheckConflicts()) return

    const { timeslot, teacher, student, subject, room, mode, id } = advanceBooking

    const bookingData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
    }

    try {
      if (mode === 'edit' && id) {
        await pb.collection('advanceBooking').update(id, bookingData)
        toast.success('Advance booking updated successfully')
      } else {
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
            <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.subject.id} required>
              <option value="">Select Subject</option>
              {#each subjects as subject}
                <option value={subject.id}>{subject.name}</option>
              {/each}
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.student.id} required>
              <option value="">Select Student</option>
              {#each students as student (student.id)}
                {@const isGraduated = student.status === 'graduated'}
                {@const isCurrentStudent = student.id === advanceBooking.student.id}
                {@const conflictBooking =
                  existingBookings.find((b) => b.student === student.id) ||
                  groupLessonBookings.find((b) => Array.isArray(b.student) && b.student.includes(student.id))}

                {#if !isGraduated || isCurrentStudent}
                  <option
                    value={student.id}
                    disabled={isGraduated || !!conflictBooking}
                    class:text-gray-400={isGraduated || conflictBooking}
                    class:italic={isGraduated}
                  >
                    {student.englishName}
                    {#if isGraduated}
                      (Graduated)
                    {:else if conflictBooking}
                      ({getConflictLabel(conflictBooking, 'student')})
                    {/if}
                  </option>
                {/if}
              {/each}
            </select>

            {#if conflicts.student}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This student is already booked for this timeslot </span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.timeslot.id} required>
              <option value="">Select Timeslot</option>
              {#each timeslots as slot}
                <option value={slot.id}>{slot.start} - {slot.end}</option>
              {/each}
            </select>
          </fieldset>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.teacher.id} required>
              <option value="">Select Teacher</option>
              {#each teachers as teacher}
                {@const conflictBooking =
                  existingBookings.find((b) => b.teacher === teacher.id) ||
                  groupLessonBookings.find((b) => b.teacher === teacher.id)}
                <option value={teacher.id} disabled={!!conflictBooking} class:text-gray-400={conflictBooking}>
                  {teacher.name}
                  {#if conflictBooking}
                    ({getConflictLabel(conflictBooking, 'teacher')})
                  {/if}
                </option>
              {/each}
            </select>

            {#if conflicts.teacher}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This teacher is already booked for this timeslot </span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
            <input type="text" value={advanceBooking.room.name} class="input input-bordered w-full" readonly />

            {#if conflicts.room}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This room is already occupied for this timeslot </span>
              </div>
            {/if}
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
