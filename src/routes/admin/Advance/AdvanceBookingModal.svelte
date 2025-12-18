<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  let { show = $bindable(false), advanceBooking = $bindable(), onSave } = $props()

  let existingBookings = $state([])
  let groupLessonBookings = $state([])

  // Cache reference data globally (shared across all modal instances)
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let timeslots = $state([])
  let dataLoaded = $state(false)

  // Enhanced cache with smart invalidation
  let bookingsCache = new Map()
  let isLoading = $state(false)
  let lastTimeslotId = null // Track last loaded timeslot

  // Optimized conflict detection
  const conflicts = $derived(() => {
    if (!advanceBooking.timeslot?.id) {
      return { teacher: null, student: null, room: null }
    }

    const teacherId = advanceBooking.teacher?.id
    const studentId = advanceBooking.student?.id
    const roomId = advanceBooking.room?.id

    if (!teacherId && !studentId && !roomId) {
      return { teacher: null, student: null, room: null }
    }

    let teacherConflict = null
    let studentConflict = null
    let roomConflict = null

    // Check existing bookings
    for (const booking of existingBookings) {
      if (teacherId && booking.teacher === teacherId) teacherConflict = booking
      if (studentId && booking.student === studentId) studentConflict = booking
      if (roomId && booking.room === roomId) roomConflict = booking

      if (teacherConflict && studentConflict && roomConflict) break
    }

    // Check group bookings if needed
    if ((!teacherConflict && teacherId) || (!studentConflict && studentId)) {
      for (const booking of groupLessonBookings) {
        if (!teacherConflict && teacherId && booking.teacher === teacherId) {
          teacherConflict = booking
        }
        if (!studentConflict && studentId && Array.isArray(booking.student) && booking.student.includes(studentId)) {
          studentConflict = booking
        }

        if ((teacherId ? teacherConflict : true) && (studentId ? studentConflict : true)) break
      }
    }

    return { teacher: teacherConflict, student: studentConflict, room: roomConflict }
  })

  // Load reference data ONCE globally
  onMount(async () => {
    if (!dataLoaded) {
      await loadAllData()
    }
  })

  // OPTIMIZED: Only load bookings when timeslot CHANGES (not every modal open)
  $effect(() => {
    if (show && advanceBooking.timeslot?.id && advanceBooking.timeslot.id !== lastTimeslotId) {
      lastTimeslotId = advanceBooking.timeslot.id
      loadExistingBookingsOptimized(advanceBooking.timeslot.id)
    }
  })

  const loadAllData = async () => {
    if (dataLoaded) return

    try {
      const [teachersData, studentsData, subjectsData, timeslotsData] = await Promise.all([
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
        pb.collection('timeSlot').getFullList({
          sort: 'start',
          fields: 'id,start,end',
        }),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      timeslots = timeslotsData
      dataLoaded = true
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  // OPTIMIZED: Use cache more aggressively, only reload if stale
  const loadExistingBookingsOptimized = async (timeslotId) => {
    if (!timeslotId) return

    const cached = bookingsCache.get(timeslotId)
    const cacheAge = cached ? Date.now() - cached.timestamp : Infinity
    const cacheStale = cacheAge > 30000 // 30 seconds

    // Use cache if fresh
    if (cached && !cacheStale) {
      existingBookings = cached.existingBookings
      groupLessonBookings = cached.groupLessonBookings
      return
    }

    // Load in background, don't block UI the ui
    isLoading = true
    try {
      const excludeFilter =
        advanceBooking.mode === 'edit' && advanceBooking.id ? ` && id != "${advanceBooking.id}"` : ''

      const [advanceRecords, groupRecords] = await Promise.all([
        pb.collection('advanceBooking').getFullList({
          filter: `timeslot = "${timeslotId}"${excludeFilter}`,
          expand: 'teacher,student,room',
          fields: 'id,teacher,student,room,expand',
          $autoCancel: false,
        }),
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `timeslot = "${timeslotId}"`,
            expand: 'teacher,student,grouproom',
            fields: 'id,teacher,student,expand',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      existingBookings = advanceRecords
      groupLessonBookings = groupRecords

      // Cache with timestamp
      bookingsCache.set(timeslotId, {
        existingBookings: advanceRecords,
        groupLessonBookings: groupRecords,
        timestamp: Date.now(),
      })

      cleanupCache()
    } catch (error) {
      console.error('Error loading existing bookings:', error)
      existingBookings = []
      groupLessonBookings = []
    } finally {
      isLoading = false
    }
  }

  const cleanupCache = () => {
    const now = Date.now()
    const fiveMinutes = 5 * 60 * 1000

    for (const [key, value] of bookingsCache.entries()) {
      if (now - value.timestamp > fiveMinutes) {
        bookingsCache.delete(key)
      }
    }
  }

  const getConflictLabel = (booking, type) => {
    if (!booking?.expand) {
      return type === 'student' ? 'Group Lesson' : 'Unknown'
    }

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

  // OPTIMIZED: Optimistic update + smart cache invalidation
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
      let savedBooking
      if (mode === 'edit' && id) {
        savedBooking = await pb.collection('advanceBooking').update(id, bookingData)
        toast.success('Advance booking updated successfully')
      } else {
        savedBooking = await pb.collection('advanceBooking').create(bookingData)
        toast.success('Advance booking created successfully')
      }

      // OPTIMIZED: Only invalidate THIS timeslot's cache, not all
      const affectedTimeslot = timeslot.id
      bookingsCache.delete(affectedTimeslot)

      // Optimistically update local state
      if (mode === 'create') {
        existingBookings = [
          ...existingBookings,
          {
            id: savedBooking.id,
            teacher: teacher.id,
            student: student.id,
            room: room.id,
            expand: {
              teacher,
              student,
              room,
            },
          },
        ]
      } else if (mode === 'edit') {
        // Update existing booking in local state
        existingBookings = existingBookings.map((b) =>
          b.id === id
            ? {
                id: savedBooking.id,
                teacher: teacher.id,
                student: student.id,
                room: room.id,
                expand: {
                  teacher,
                  student,
                  room,
                },
              }
            : b
        )
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

      // Invalidate cache
      bookingsCache.delete(timeslot.id)

      // Optimistically update local state
      existingBookings = existingBookings.filter((b) => b.id !== advanceBooking.id)

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
            <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
            <select
              class="select select-bordered w-full"
              bind:value={advanceBooking.student.id}
              disabled={!dataLoaded}
              required
            >
              <option value="">Select Student</option>
              {#each students as student (student.id)}
                {@const isGraduated = student.status === 'graduated'}
                {@const isCurrentStudent = student.id === advanceBooking.student.id}
                {@const conflictBooking =
                  conflicts.student && student.id === advanceBooking.student.id
                    ? conflicts.student
                    : existingBookings.find((b) => b.student === student.id) ||
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
                <span class="label-text-alt text-warning">
                  ⚠️ This student is already booked for this timeslot ({getConflictLabel(conflicts.student, 'student')})
                </span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
            <select
              class="select select-bordered w-full"
              bind:value={advanceBooking.subject.id}
              disabled={!dataLoaded}
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
              disabled={!dataLoaded}
              required
            >
              <option value="">Select Teacher</option>
              {#each teachers as teacher}
                {@const isDisabled = teacher.status === 'disabled'}
                {@const isCurrentTeacher = teacher.id === advanceBooking.teacher.id}
                {@const conflictBooking =
                  conflicts.teacher && teacher.id === advanceBooking.teacher.id
                    ? conflicts.teacher
                    : existingBookings.find((b) => b.teacher === teacher.id) ||
                      groupLessonBookings.find((b) => b.teacher === teacher.id)}

                {#if !isDisabled || isCurrentTeacher}
                  <option
                    value={teacher.id}
                    disabled={isDisabled || !!conflictBooking}
                    class:text-gray-400={isDisabled || conflictBooking}
                    class:italic={isDisabled}
                  >
                    {teacher.name}
                    {#if isDisabled}
                      (Disabled)
                    {:else if conflictBooking}
                      ({getConflictLabel(conflictBooking, 'teacher')})
                    {/if}
                  </option>
                {/if}
              {/each}
            </select>

            {#if conflicts.teacher}
              <div class="label">
                <span class="label-text-alt text-warning">
                  ⚠️ This teacher is already booked for this timeslot ({getConflictLabel(conflicts.teacher, 'teacher')})
                </span>
              </div>
            {/if}
          </fieldset>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
            <select
              class="select select-bordered w-full"
              bind:value={advanceBooking.timeslot.id}
              disabled={!dataLoaded}
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

            {#if conflicts.room}
              <div class="label">
                <span class="label-text-alt text-warning">
                  ⚠️ This room is already occupied for this timeslot ({getConflictLabel(conflicts.room, 'room')})
                </span>
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
