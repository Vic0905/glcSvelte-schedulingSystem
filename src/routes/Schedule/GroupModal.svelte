<script>
  import { createEventDispatcher } from 'svelte'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking } from './schedule.svelte'

  const dispatch = createEventDispatcher()

  let show = false
  let subjects = []
  let students = []
  let teachers = []
  let groupRooms = []
  let timeslots = []
  let saving = false
  let selectedStudents = []
  let maxStudentsAllowed = 0
  let searchTerm = ''
  let existingSchedules = []

  // Show modal method (called from parent)
  export function showModal() {
    show = true
    loadDropdowns()

    // Initialize selected students from booking data
    if (booking.data.mode === 'edit' && booking.data.students) {
      selectedStudents = booking.data.students.map((student) => student.id)
    } else {
      selectedStudents = []
    }

    setMaxStudentsAllowed()

    // Always reload existing schedules when modal opens
    if (booking.data.date && booking.data.timeslot.id) {
      loadExistingSchedules()
    }
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
    existingSchedules = [] // Reset existing schedules for clean state
  }

  async function loadDropdowns() {
    try {
      subjects = await pb.collection('subject').getFullList({ sort: 'name' })
      students = await pb.collection('student').getFullList({ sort: 'name' })
      teachers = await pb.collection('teacher').getFullList({ sort: 'name' })
      groupRooms = await pb.collection('groupRoom').getFullList({ sort: 'name' })
      timeslots = await pb.collection('timeslot').getFullList({ sort: 'start' })

      // Set max students after loading group rooms
      setMaxStudentsAllowed()
    } catch (err) {
      toast.error('Failed to load dropdown data')
    }
  }

  // Load existing schedules from BOTH collections
  const loadExistingSchedules = async () => {
    try {
      const currentDate = booking.data.date
      if (!currentDate || !booking.data.timeslot.id) {
        existingSchedules = []
        return
      }

      // lessonSchedule
      const lessonRecords = await pb.collection('lessonSchedule').getFullList({
        filter: `date = "${currentDate}" && timeslot = "${booking.data.timeslot.id}"`,
        expand: 'teacher,student,room',
      })

      // groupLessonSchedule - using correct field names
      const groupRecords = await pb.collection('groupLessonSchedule').getFullList({
        filter: `date = "${currentDate}" && timeslot = "${booking.data.timeslot.id}"${booking.data.mode === 'edit' && booking.data.id ? ` && id != "${booking.data.id}"` : ''}`,
        expand: 'teacher,student,grouproom,subject', // student is array, grouproom instead of room
      })

      // Merge both
      existingSchedules = [...lessonRecords, ...groupRecords]
    } catch (error) {
      console.error('Error loading schedules:', error)
      existingSchedules = []
    }
  }

  // Conflict helpers
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
        // If group lesson (students array), just show "Booked for Group Class"
        if (Array.isArray(schedule.expand?.student)) {
          return 'Group Class'
        }
        // Otherwise, show the individual student name
        return schedule.expand?.student?.name || 'Unknown Student'

      case 'student':
        return schedule.expand?.teacher?.name || 'Unknown Teacher'

      case 'grouproom':
        const teacherName = schedule.expand?.teacher?.name || 'Unknown Teacher'
        let studentNames = ''

        if (schedule.expand?.student?.name) {
          studentNames = schedule.expand.student.name
        } else if (Array.isArray(schedule.expand?.student)) {
          studentNames = schedule.expand.student.map((st) => st.name).join(', ')
        } else {
          studentNames = 'Group Students'
        }

        return `${teacherName} & ${studentNames}`

      default:
        return ''
    }
  }

  // Check conflict across both collections with proper field mapping
  const checkConflictInCollection = async (collection, baseFilter, resourceType, resourceId) => {
    try {
      let filter = baseFilter

      // Handle different field names between collections
      if (collection === 'groupLessonSchedule') {
        if (resourceType === 'student') {
          // Check if student is in the student array
          filter += ` && student ~ "${resourceId}"`
        } else if (resourceType === 'teacher') {
          filter += ` && teacher = "${resourceId}"`
        } else if (resourceType === 'grouproom') {
          // Use "grouproom" field instead of "room"
          filter += ` && grouproom = "${resourceId}"`
        }

        await pb.collection(collection).getFirstListItem(filter, {
          expand: 'teacher,student,grouproom,subject',
        })
      } else {
        // lessonSchedule collection
        if (resourceType === 'student') {
          filter += ` && student = "${resourceId}"`
        } else if (resourceType === 'teacher') {
          filter += ` && teacher = "${resourceId}"`
        } else if (resourceType === 'grouproom') {
          filter += ` && room = "${resourceId}"`
        }

        await pb.collection(collection).getFirstListItem(filter, {
          expand: 'teacher,student,room',
        })
      }

      return true
    } catch (error) {
      console.log(`No conflict found in ${collection}: ${error.status || error.message || 'not found'}`)
      if (error.status === 400 && collection === 'groupLessonSchedule') {
        console.warn('groupLessonSchedule collection may not exist or have different field names')
      }
      return false
    }
  }

  const checkConflict = async (resourceType, resourceId, excludeCurrentRecord = false) => {
    const currentDate = booking.data.date
    const timeslotId = booking.data.timeslot.id

    if (!currentDate || !timeslotId) return false

    // Check individual lessons (lessonSchedule)
    let lessonBaseFilter = `date = "${currentDate}" && timeslot = "${timeslotId}"`

    const lessonConflict = await checkConflictInCollection('lessonSchedule', lessonBaseFilter, resourceType, resourceId)
    if (lessonConflict) return true

    // Check group lessons
    try {
      let groupBaseFilter = `date = "${currentDate}" && timeslot = "${timeslotId}"`

      // Add exclusion for edit mode (only for group lessons)
      if (excludeCurrentRecord && booking.data.mode === 'edit' && booking.data.id) {
        groupBaseFilter += ` && id != "${booking.data.id}"`
      }

      const groupConflict = await checkConflictInCollection(
        'groupLessonSchedule',
        groupBaseFilter,
        resourceType,
        resourceId
      )
      if (groupConflict) return true
    } catch (error) {
      console.warn('Skipping groupLessonSchedule check due to collection issues:', error)
    }

    return false
  }

  // Reload schedules when date/timeslot changes
  $: if (booking.data.date && booking.data.timeslot.id) {
    loadExistingSchedules()
  }

  function setMaxStudentsAllowed() {
    if (booking.data.groupRoom.id && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === booking.data.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = booking.data.groupRoom.maxstudents || 0
    }
  }

  function onGroupRoomChange() {
    setMaxStudentsAllowed()
    // If current selection exceeds new limit, truncate it
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

  async function saveSchedule() {
    if (!booking.data.subject.id) {
      toast.error('Please select a subject')
      return
    }
    if (selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return
    }
    if (!booking.data.groupRoom.id) {
      toast.error('Please select a group room')
      return
    }
    if (!booking.data.teacher.id) {
      toast.error('Please select a teacher')
      return
    }
    if (!booking.data.timeslot.id) {
      toast.error('Please select a timeslot')
      return
    }

    // Check conflicts using the new function
    const isEditMode = booking.data.mode === 'edit' && booking.data.id

    if (await checkConflict('teacher', booking.data.teacher.id, isEditMode)) {
      const conflictInfo = getConflictInfo(booking.data.teacher.id, 'teacher')
      toast.error('Teacher conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${booking.data.teacher.name || 'Teacher'} is already booked with ${conflictInfo}`,
      })
      return
    }

    // Check each selected student for conflicts
    for (const studentId of selectedStudents) {
      if (await checkConflict('student', studentId, isEditMode)) {
        const student = students.find((s) => s.id === studentId)
        const conflictInfo = getConflictInfo(studentId, 'student')
        toast.error('Student conflict', {
          position: 'bottom-right',
          duration: 5000,
          description: `${student?.name || 'Student'} is already booked with ${conflictInfo}`,
        })
        return
      }
    }

    if (await checkConflict('grouproom', booking.data.groupRoom.id, isEditMode)) {
      const conflictInfo = getConflictInfo(booking.data.groupRoom.id, 'grouproom')
      toast.error('Room conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${booking.data.groupRoom.name || 'Room'} is already occupied by ${conflictInfo}`,
      })
      return
    }

    saving = true
    try {
      const payload = {
        date: booking.data.date,
        grouproom: booking.data.groupRoom.id,
        timeslot: booking.data.timeslot.id,
        subject: booking.data.subject.id,
        teacher: booking.data.teacher.id,
        student: selectedStudents,
      }

      if (booking.data.mode === 'edit') {
        await pb.collection('groupLessonSchedule').update(booking.data.id, payload)
        toast.success('Schedule updated!')
      } else {
        await pb.collection('groupLessonSchedule').create(payload)
        toast.success('Schedule created!')
      }

      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      toast.error(`Error saving schedule: ${err.message}`)
    } finally {
      saving = false
    }
  }

  async function deleteSchedule() {
    if (!booking.data.id) return

    if (!confirm('Are you sure you want to delete this schedule?')) return

    saving = true
    try {
      await pb.collection('groupLessonSchedule').delete(booking.data.id)
      toast.success('Schedule deleted!')
      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      toast.error(`Error deleting schedule: ${err.message}`)
    } finally {
      saving = false
    }
  }

  // Computed filtered students
  $: filteredStudents = students.filter((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.data.mode === 'edit' ? 'Edit Group Schedule' : 'Create Group Schedule'}
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Subject</span></label>
            <select bind:value={booking.data.subject.id} class="select select-bordered w-full" required>
              <option value="">-- Select Subject --</option>
              {#each subjects as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>

          <!-- Students -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
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

            <!-- Search input -->
            <div class="mb-2">
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="Search student..."
                bind:value={searchTerm}
              />
            </div>

            <!-- Student list -->
            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto bg-base-100">
              {#each filteredStudents as student}
                {@const isBooked = isStudentBooked(student.id)}
                {@const conflictInfo = getConflictInfo(student.id, 'student')}
                <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={selectedStudents.includes(student.id)}
                      disabled={isBooked ||
                        (maxStudentsAllowed > 0 &&
                          !selectedStudents.includes(student.id) &&
                          selectedStudents.length >= maxStudentsAllowed)}
                      onchange={() => toggleStudent(student.id)}
                    />
                    <span
                      class="label-text {isBooked ||
                      (maxStudentsAllowed > 0 &&
                        !selectedStudents.includes(student.id) &&
                        selectedStudents.length >= maxStudentsAllowed)
                        ? 'opacity-50'
                        : ''}"
                    >
                      {student.name}
                      {#if isBooked}
                        <span class="text-warning text-xs">(Booked with {conflictInfo})</span>
                      {/if}
                    </span>
                  </label>
                </div>
              {/each}
              {#if filteredStudents.length === 0}
                <p class="text-sm text-base-content/100 text-center py-4">No matching students</p>
              {/if}
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <!-- Teacher -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Teacher</span></label>
            <select bind:value={booking.data.teacher.id} class="select select-bordered w-full" required>
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
            {#if booking.data.teacher.id && isTeacherBooked(booking.data.teacher.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This teacher is already booked for this timeslot </span>
              </div>
            {/if}
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={booking.data.groupRoom.id}
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
            {#if booking.data.groupRoom.id && isGroupRoomBooked(booking.data.groupRoom.id)}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This room is already occupied for this timeslot </span>
              </div>
            {/if}
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select bind:value={booking.data.timeslot.id} class="select select-bordered w-full" required>
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Date -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Date</span></label>
            <input type="date" bind:value={booking.data.date} class="input input-bordered w-full" required />
          </div>

          <!-- Schedule Info Display -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Schedule Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Date:</span>
                {booking.data.date || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {booking.data.groupRoom.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {booking.data.timeslot.start && booking.data.timeslot.end
                  ? `${booking.data.timeslot.start} - ${booking.data.timeslot.end}`
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
        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving}>
          {saving ? 'Saving...' : booking.data.mode === 'edit' ? 'Update' : 'Save'}
        </button>
        {#if booking.data.mode === 'edit'}
          <button class="btn btn-error btn-outline" onclick={deleteSchedule} disabled={saving}>
            Delete Schedule
          </button>
        {/if}
        <button class="btn" onclick={closeModal}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
