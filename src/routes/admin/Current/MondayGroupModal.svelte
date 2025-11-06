<script>
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking } from './schedule.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const dispatch = createEventDispatcher()

  let show = false
  let subjects = []
  let students = []
  let teachers = []
  let groupRooms = []
  let timeslots = []
  let saving = false
  let deleting = false
  let selectedStudents = []
  let maxStudentsAllowed = 0
  let searchTerm = ''
  let existingSchedules = []

  // Show modal method (called from parent)
  export function showModal() {
    show = true
    loadDropdowns()

    // Initialize selected students from booking data with null safety
    if (booking?.mondayData?.mode === 'edit' && Array.isArray(booking.mondayData.students)) {
      selectedStudents = booking.mondayData.students.map((student) => student.id || student)
    } else {
      selectedStudents = []
    }

    setMaxStudentsAllowed()

    // Always reload existing schedules when modal opens with null safety
    if (booking?.mondayData?.selectedDate && booking?.mondayData?.timeslot?.id) {
      loadExistingSchedules()
    }
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
    existingSchedules = []
  }

  async function loadDropdowns() {
    try {
      subjects = await pb.collection('subject').getFullList({ sort: 'name' })
      students = await pb.collection('student').getFullList({ sort: 'englishName' })
      teachers = await pb.collection('teacher').getFullList({ sort: 'name' })
      groupRooms = await pb.collection('groupRoom').getFullList({ sort: 'name' })
      timeslots = await pb.collection('timeslot').getFullList({ sort: 'start' })

      setMaxStudentsAllowed()
    } catch (err) {
      console.error('Error loading dropdowns:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  // Load existing schedules for conflict detection - UPDATED TO INCLUDE MONDAY LESSONS
  const loadExistingSchedules = async () => {
    try {
      const selectedDate = booking?.mondayData?.selectedDate
      const timeslotId = booking?.mondayData?.timeslot?.id

      if (!selectedDate || !timeslotId) {
        existingSchedules = []
        return
      }

      // Exclude schedules being edited
      let excludeFilter = ''
      if (
        booking?.mondayData?.mode === 'edit' &&
        booking?.mondayData?.originalTeacherId &&
        booking?.mondayData?.originalGroupRoomId &&
        booking?.mondayData?.originalTimeslotId
      ) {
        const editingSchedules = await pb.collection('mondayGroupLessonSchedule').getFullList({
          filter: `teacher = "${booking.mondayData.originalTeacherId}" && timeslot = "${booking.mondayData.originalTimeslotId}" && grouproom = "${booking.mondayData.originalGroupRoomId}" && date = "${selectedDate}"`,
          fields: 'id',
        })

        if (editingSchedules.length > 0) {
          const excludeIds = editingSchedules.map((s) => `id != "${s.id}"`).join(' && ')
          excludeFilter = ` && (${excludeIds})`
        }
      }

      // UPDATED: Include both Monday individual and group lessons
      const [mondayLessonRecords, mondayGroupRecords] = await Promise.all([
        pb.collection('mondayLessonSchedule').getFullList({
          filter: `date = "${selectedDate}" && timeslot = "${timeslotId}"`,
          expand: 'teacher,student,room',
        }),
        pb.collection('mondayGroupLessonSchedule').getFullList({
          filter: `date = "${selectedDate}" && timeslot = "${timeslotId}"${excludeFilter}`,
          expand: 'teacher,student,grouproom,subject',
        }),
      ])

      existingSchedules = [...mondayLessonRecords, ...mondayGroupRecords]
    } catch (error) {
      console.error('Error loading Monday schedules:', error)
      existingSchedules = []
    }
  }

  const isTeacherBooked = (teacherId) => {
    return existingSchedules.some((s) => s.teacher === teacherId)
  }

  const isStudentBooked = (studentId) => {
    return existingSchedules.some(
      (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
    )
  }

  const isGroupRoomBooked = (roomId) => {
    return existingSchedules.some((s) => s.room === roomId || s.grouproom === roomId)
  }

  const getConflictInfo = (resourceId, type) => {
    const schedule = existingSchedules.find((s) => {
      if (type === 'student') {
        return s.student === resourceId || (Array.isArray(s.student) && s.student.includes(resourceId))
      } else if (type === 'grouproom') {
        return s.room === resourceId || s.grouproom === resourceId
      }
      return s[type] === resourceId
    })

    if (!schedule) return ''

    switch (type) {
      case 'teacher':
        if (Array.isArray(schedule.expand?.student)) {
          return 'Group Class'
        }
        return schedule.expand?.student?.englishName || 'Unknown Student'

      case 'student':
        return schedule.expand?.teacher?.name || 'Unknown Teacher'

      case 'grouproom':
        const teacherName = schedule.expand?.teacher?.name || 'Unknown Teacher'
        let studentNames = ''

        if (schedule.expand?.student?.englishName) {
          studentNames = schedule.expand.student.englishName
        } else if (Array.isArray(schedule.expand?.student)) {
          studentNames = schedule.expand.student.map((st) => st.englishName).join(', ')
        } else {
          studentNames = 'Group Students'
        }

        return `${teacherName} & ${studentNames}`

      default:
        return ''
    }
  }

  // Reload schedules when date/timeslot changes - with null safety
  $: if (booking?.mondayData?.selectedDate && booking?.mondayData?.timeslot?.id) {
    loadExistingSchedules()
  }

  function setMaxStudentsAllowed() {
    if (booking?.mondayData?.groupRoom?.id && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === booking.mondayData.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = booking?.mondayData?.groupRoom?.maxstudents || 0
    }
  }

  function onGroupRoomChange() {
    setMaxStudentsAllowed()
    if (selectedStudents.length > maxStudentsAllowed && maxStudentsAllowed > 0) {
      selectedStudents = selectedStudents.slice(0, maxStudentsAllowed)
      toast.warning(`Student selection limited to ${maxStudentsAllowed} students for this room`)
    }
  }

  function toggleStudent(studentId) {
    if (selectedStudents.includes(studentId)) {
      selectedStudents = selectedStudents.filter((id) => id !== studentId)
    } else {
      if (maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed) {
        toast.warning(`Maximum ${maxStudentsAllowed} students allowed for this room`)
        return
      }
      selectedStudents = [...selectedStudents, studentId]
    }
  }

  function selectAllStudents() {
    if (maxStudentsAllowed > 0) {
      selectedStudents = students.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (students.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} students due to room limit`)
      }
    } else {
      selectedStudents = students.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  // Validation
  const validateSchedule = () => {
    if (!booking?.mondayData?.subject?.id) {
      toast.error('Please select a subject')
      return false
    }
    if (selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return false
    }
    if (!booking?.mondayData?.groupRoom?.id) {
      toast.error('Please select a group room')
      return false
    }
    if (!booking?.mondayData?.teacher?.id) {
      toast.error('Please select a teacher')
      return false
    }
    if (!booking?.mondayData?.timeslot?.id) {
      toast.error('Please select a timeslot')
      return false
    }

    // Check conflicts
    if (isTeacherBooked(booking.mondayData.teacher.id)) {
      const conflictInfo = getConflictInfo(booking.mondayData.teacher.id, 'teacher')
      toast.error('Teacher conflict', {
        description: `${booking.mondayData.teacher.name || 'Teacher'} is already booked with ${conflictInfo}`,
      })
      return false
    }

    for (const studentId of selectedStudents) {
      if (isStudentBooked(studentId)) {
        const student = students.find((s) => s.id === studentId)
        const conflictInfo = getConflictInfo(studentId, 'student')
        toast.error('Student conflict', {
          description: `${student?.englishName || 'Student'} is already booked with ${conflictInfo}`,
        })
        return false
      }
    }

    if (isGroupRoomBooked(booking.mondayData.groupRoom.id)) {
      const conflictInfo = getConflictInfo(booking.mondayData.groupRoom.id, 'grouproom')
      toast.error('Room conflict', {
        description: `${booking.mondayData.groupRoom.name || 'Room'} is already occupied by ${conflictInfo}`,
      })
      return false
    }

    return true
  }

  async function saveSchedule() {
    if (!validateSchedule()) return

    const { mondayData } = booking

    const scheduleData = {
      date: mondayData.selectedDate,
      timeslot: mondayData.timeslot.id,
      teacher: mondayData.teacher.id,
      student: selectedStudents,
      subject: mondayData.subject.id,
      grouproom: mondayData.groupRoom.id,
    }

    saving = true
    try {
      if (mondayData.mode === 'edit' && mondayData.id) {
        await pb.collection('mondayGroupLessonSchedule').update(mondayData.id, scheduleData)
        toast.success('Monday group schedule updated!', {
          description: 'Schedule updated successfully',
        })
      } else {
        await pb.collection('mondayGroupLessonSchedule').create(scheduleData)
        toast.success('Monday group schedule created!', {
          description: 'New Monday schedule created successfully',
        })
      }

      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      console.error('Error saving Monday schedule:', err)
      toast.error(`Error saving schedule: ${err.message}`)
    } finally {
      saving = false
    }
  }

  async function deleteSchedule() {
    const { mondayData } = booking

    if (!mondayData?.id) {
      toast.error('No schedule selected to delete')
      return
    }

    const confirmMessage =
      `Are you sure you want to delete this Monday group schedule?\n\n` +
      `Date: ${new Date(mondayData.selectedDate).toLocaleDateString()}\n` +
      `Subject: ${mondayData.subject.name}\n` +
      `Teacher: ${mondayData.teacher.name}\n` +
      `Students: ${selectedStudents.length} selected\n` +
      `Room: ${mondayData.groupRoom.name}\n` +
      `Time: ${mondayData.timeslot.start} - ${mondayData.timeslot.end}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    deleting = true
    try {
      await pb.collection('mondayGroupLessonSchedule').delete(mondayData.id)

      toast.success('Monday group schedule deleted!', {
        description: 'Schedule deleted successfully',
      })
      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      console.error('Error deleting Monday schedule:', err)
      toast.error(`Error deleting schedule: ${err.message}`)
    } finally {
      deleting = false
    }
  }

  $: filteredStudents = students.filter((s) => s.englishName.toLowerCase().includes(searchTerm.toLowerCase()))
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.mondayData.mode === 'edit' ? 'Edit Monday Group Schedule' : 'Create Monday Group Schedule'}
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
          >This will {booking.mondayData.mode === 'edit' ? 'update' : 'create'} a group schedule for Monday only</span
        >
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <label class="label"><span class="label-text">Subject</span></label>
            <select bind:value={booking.mondayData.subject.id} class="select select-bordered w-full" required>
              <option value="">-- Select Subject --</option>
              {#each subjects as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>

          <!-- Students -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Students ({selectedStudents.length} selected
                {#if maxStudentsAllowed > 0}
                  / {maxStudentsAllowed} max
                {/if})
              </span>
              <div class="space-x-2">
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={selectAllStudents}
                  disabled={maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed}
                >
                  Select All
                </button>
                <button type="button" class="btn btn-xs btn-outline" onclick={clearAllStudents}> Clear All </button>
              </div>
            </label>

            <div class="mb-2">
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="Search student..."
                bind:value={searchTerm}
              />
            </div>

            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto bg-base-100">
              {#each filteredStudents as student (student.id)}
                {#if student.status !== 'graduated' || selectedStudents.includes(student.id)}
                  {@const isBooked = isStudentBooked(student.id)}
                  {@const conflictInfo = getConflictInfo(student.id, 'student')}
                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={student.status === 'graduated' ||
                          isBooked ||
                          (maxStudentsAllowed > 0 &&
                            !selectedStudents.includes(student.id) &&
                            selectedStudents.length >= maxStudentsAllowed)}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text {student.status === 'graduated' || isBooked ? 'italic' : ''}">
                        {student.englishName}
                        {#if student.status === 'graduated'}
                          <span class="text-xs text-gray-400">(Graduated)</span>
                        {:else if isBooked}
                          <span class="text-warning text-xs">(Booked with {conflictInfo})</span>
                        {/if}
                      </span>
                    </label>
                  </div>
                {/if}
              {/each}

              {#if filteredStudents.filter((s) => s.status !== 'graduated' || selectedStudents.includes(s.id)).length === 0}
                <p class="text-sm text-base-content/100 text-center py-4">No matching students</p>
              {/if}
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <!-- Teacher -->
          <div class="form-control">
            <label class="label"><span class="label-text">Teacher</span></label>
            <select bind:value={booking.mondayData.teacher.id} class="select select-bordered w-full" required>
              <option value="">-- Select Teacher --</option>
              {#each teachers as teacher}
                {@const isBooked = isTeacherBooked(teacher.id)}
                {@const conflictInfo = getConflictInfo(teacher.id, 'teacher')}
                <option value={teacher.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {teacher.name}
                  {#if isBooked}
                    (Booked with {conflictInfo})
                  {/if}
                </option>
              {/each}
            </select>
            {#if booking.mondayData.teacher.id && isTeacherBooked(booking.mondayData.teacher.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This teacher is already booked </span>
              </div>
            {/if}
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={booking.mondayData.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as room}
                {@const isBooked = isGroupRoomBooked(room.id)}
                {@const conflictInfo = getConflictInfo(room.id, 'grouproom')}
                <option value={room.id} disabled={isBooked} class={isBooked ? 'text-gray-400' : ''}>
                  {room.name} (Max: {room.maxstudents} students)
                  {#if isBooked}
                    - (Occupied by {conflictInfo})
                  {/if}
                </option>
              {/each}
            </select>
            {#if booking.mondayData.groupRoom.id && isGroupRoomBooked(booking.mondayData.groupRoom.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This room is already occupied </span>
              </div>
            {/if}
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select bind:value={booking.mondayData.timeslot.id} class="select select-bordered w-full" required>
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Schedule Info Display -->
          <div class="form-control">
            <label class="label"><span class="label-text">Schedule Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Date:</span>
                {booking.mondayData.selectedDate
                  ? new Date(booking.mondayData.selectedDate).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {booking.mondayData.groupRoom.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {booking.mondayData.timeslot.start && booking.mondayData.timeslot.end
                  ? `${booking.mondayData.timeslot.start} - ${booking.mondayData.timeslot.end}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Students:</span>
                {selectedStudents.length} selected
                {#if maxStudentsAllowed > 0}
                  (Max: {maxStudentsAllowed})
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Buttons -->
      <div class="modal-action">
        {#if booking.mondayData.mode === 'edit'}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={deleting || saving}>
            {#if deleting}
              <span class="loading loading-spinner loading-sm"></span>
              Deleting...
            {:else}
              Delete Schedule
            {/if}
          </button>
        {/if}

        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving || deleting}>
          {#if saving}
            <span class="loading loading-spinner loading-sm"></span>
            Saving...
          {:else}
            {booking.mondayData.mode === 'edit' ? 'Update Schedule' : 'Save Schedule'}
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving || deleting}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
