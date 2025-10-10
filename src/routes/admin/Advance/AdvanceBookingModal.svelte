<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), advanceBooking = $bindable(), onSave } = $props()

  let existingBookings = $state([])
  let groupLessonBookings = $state([])
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])

  // Load all reference data once
  const loadReferenceData = async () => {
    try {
      const [teachersData, studentsData, subjectsData] = await Promise.all([
        pb.collection('teacher').getFullList(),
        pb.collection('student').getFullList(),
        pb.collection('subject').getFullList(),
      ])

      teachers = teachersData.sort((a, b) => a.name.localeCompare(b.name))
      students = studentsData.sort((a, b) => a.englishName.localeCompare(b.englishName))
      subjects = subjectsData.sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  // Load existing bookings for conflict detection
  const loadExistingBookings = async () => {
    try {
      const timeslotId = advanceBooking.timeslot.id
      if (!timeslotId) {
        existingBookings = []
        groupLessonBookings = []
        return
      }

      // Load advance bookings
      const advanceRecords = await pb.collection('advanceBooking').getFullList({
        filter: `timeslot = "${timeslotId}"${
          advanceBooking.mode === 'edit' && advanceBooking.id ? ` && id != "${advanceBooking.id}"` : ''
        }`,
        expand: 'teacher,student,room',
      })

      existingBookings = advanceRecords

      // Load group advance bookings for the same timeslot
      const groupRecords = await pb.collection('groupAdvanceBooking').getFullList({
        filter: `timeslot = "${timeslotId}"`,
        expand: 'teacher,student,grouproom',
      })

      groupLessonBookings = groupRecords
    } catch (error) {
      console.error('Error loading existing bookings:', error)
      existingBookings = []
      groupLessonBookings = []
    }
  }

  // Conflict detection helpers
  const isResourceBooked = (resourceId, type) => {
    return existingBookings.some((booking) => booking[type] === resourceId)
  }

  const isStudentInGroupLesson = (studentId) => {
    return groupLessonBookings.some((booking) => Array.isArray(booking.student) && booking.student.includes(studentId))
  }

  const isTeacherInGroupLesson = (teacherId) => {
    return groupLessonBookings.some((booking) => booking.teacher === teacherId)
  }

  const getConflictInfo = (resourceId, type) => {
    const booking = existingBookings.find((b) => b[type] === resourceId)
    if (!booking?.expand) return ''

    switch (type) {
      case 'teacher':
        return booking.expand.student?.englishName || 'Unknown Student'
      case 'student':
        return booking.expand.teacher?.name || 'Unknown Teacher'
      case 'room':
        return `${booking.expand.teacher?.name || 'Unknown Teacher'} & ${booking.expand.student?.englishName || 'Unknown Student'}`
      default:
        return ''
    }
  }

  const getGroupLessonConflictInfo = (studentId) => {
    const booking = groupLessonBookings.find((b) => Array.isArray(b.student) && b.student.includes(studentId))
    if (!booking?.expand) return 'Group Lesson'

    return `Group Lesson with ${booking.expand.teacher?.name || 'Unknown Teacher'}`
  }

  const getGroupLessonTeacherConflictInfo = (teacherId) => {
    const booking = groupLessonBookings.find((b) => b.teacher === teacherId)
    if (!booking?.expand) return 'Group Lesson'

    const studentCount = Array.isArray(booking.student) ? booking.student.length : 0
    return `Group Lesson (${studentCount} students)`
  }

  // Validation and conflict checking
  const validateAndCheckConflicts = async () => {
    const data = advanceBooking

    // Required field validation
    const requiredFields = [
      { field: data.teacher.id, message: 'Please select Teacher' },
      { field: data.student.id, message: 'Please select Student' },
      { field: data.subject.id, message: 'Please select Subject' },
    ]

    for (const { field, message } of requiredFields) {
      if (!field) {
        toast.error(message)
        return false
      }
    }

    // Conflict checking with database queries
    const timeslotId = data.timeslot.id
    const excludeFilter = data.mode === 'edit' && data.id ? ` && id != "${data.id}"` : ''

    try {
      // Check teacher conflict
      await pb
        .collection('advanceBooking')
        .getFirstListItem(`teacher = "${data.teacher.id}" && timeslot = "${timeslotId}"${excludeFilter}`)
      toast.error('Teacher is already booked at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    try {
      // Check room conflict
      await pb
        .collection('advanceBooking')
        .getFirstListItem(`room = "${data.room.id}" && timeslot = "${timeslotId}"${excludeFilter}`)
      toast.error('Room is already occupied at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    return true
  }

  // Save advance booking
  const saveAdvanceBooking = async () => {
    if (!(await validateAndCheckConflicts())) return

    const data = advanceBooking
    const bookingData = {
      timeslot: data.timeslot.id,
      teacher: data.teacher.id,
      student: data.student.id,
      subject: data.subject.id,
      room: data.room.id,
    }

    try {
      if (data.mode === 'edit' && data.id) {
        await pb.collection('advanceBooking').update(data.id, bookingData)
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

  // Delete advance booking
  const deleteAdvanceBooking = async () => {
    if (!advanceBooking.id) return

    const confirmMessage =
      `Are you sure you want to delete this advance booking?\n\n` +
      `Subject: ${advanceBooking.subject.name}\n` +
      `Teacher: ${advanceBooking.teacher.name}\n` +
      `Student: ${advanceBooking.student.englishName}\n` +
      `Room: ${advanceBooking.room.name}\n` +
      `Time: ${advanceBooking.timeslot.start} - ${advanceBooking.timeslot.end}\n\n` +
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

  // Load data when timeslot changes
  $effect(() => {
    if (advanceBooking.timeslot.id) {
      loadExistingBookings()
    }
  })

  // Load reference data once
  $effect(() => {
    if (!teachers.length) {
      loadReferenceData()
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
              {#each students as student}
                {@const isBooked = isResourceBooked(student.id, 'student')}
                {@const isInGroupLesson = isStudentInGroupLesson(student.id)}
                {@const conflictInfo = isBooked
                  ? getConflictInfo(student.id, 'student')
                  : getGroupLessonConflictInfo(student.id)}
                {@const hasConflict = isBooked || isInGroupLesson}
                <option value={student.id} disabled={hasConflict} class={hasConflict ? 'text-gray-400' : ''}>
                  {student.englishName}
                  {#if hasConflict}({conflictInfo}){/if}
                </option>
              {/each}
            </select>
            {#if advanceBooking.student.id && (isResourceBooked(advanceBooking.student.id, 'student') || isStudentInGroupLesson(advanceBooking.student.id))}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This student is already booked for this timeslot</span>
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

        <!-- Right column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
            <select class="select select-bordered w-full" bind:value={advanceBooking.teacher.id} required>
              <option value="">Select Teacher</option>
              {#each teachers as teacher}
                {@const isBooked = isResourceBooked(teacher.id, 'teacher')}
                {@const isInGroupLesson = isTeacherInGroupLesson(teacher.id)}
                {@const conflictInfo = isBooked
                  ? getConflictInfo(teacher.id, 'teacher')
                  : getGroupLessonTeacherConflictInfo(teacher.id)}
                {@const hasConflict = isBooked || isInGroupLesson}
                <option value={teacher.id} disabled={hasConflict} class={hasConflict ? 'text-gray-400' : ''}>
                  {teacher.name}
                  {#if hasConflict}({conflictInfo}){/if}
                </option>
              {/each}
            </select>
            {#if advanceBooking.teacher.id && (isResourceBooked(advanceBooking.teacher.id, 'teacher') || isTeacherInGroupLesson(advanceBooking.teacher.id))}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This teacher is already booked for this timeslot</span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
            <input type="text" value={advanceBooking.room.name} class="input input-bordered w-full" readonly />
            {#if advanceBooking.room.id && isResourceBooked(advanceBooking.room.id, 'room')}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This room is already occupied for this timeslot</span>
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
