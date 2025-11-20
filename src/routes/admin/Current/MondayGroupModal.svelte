<script>
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking } from './schedule.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const dispatch = createEventDispatcher()

  let show = $state(false)
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let groupRooms = $state([])
  let timeslots = $state([])
  let saving = $state(false)
  let deleting = $state(false)
  let selectedStudents = $state([])
  let maxStudentsAllowed = $state(0)
  let searchTerm = $state('')
  let existingSchedules = $state([])

  // Consolidated conflict detection using $derived
  const conflicts = $derived({
    teacher: existingSchedules.find((s) => s.teacher === booking.mondayData?.teacher?.id),
    grouproom: existingSchedules.find(
      (s) => s.room === booking.mondayData?.groupRoom?.id || s.grouproom === booking.mondayData?.groupRoom?.id
    ),
    students: selectedStudents.filter((studentId) =>
      existingSchedules.some(
        (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
      )
    ),
  })

  // Show modal method (called from parent)
  export function showModal() {
    show = true
    loadAllData()

    // Initialize selected students from booking data
    if (booking?.mondayData?.mode === 'edit' && Array.isArray(booking.mondayData.students)) {
      selectedStudents = booking.mondayData.students.map((student) => student.id || student)
    } else {
      selectedStudents = []
    }

    setMaxStudentsAllowed()

    // Reload existing schedules when modal opens
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

  const loadAllData = async () => {
    try {
      const [subjectsData, studentsData, teachersData, groupRoomsData, timeslotsData] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name' }),
        pb.collection('student').getFullList({ sort: 'englishName' }),
        pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('groupRoom').getFullList({ sort: 'name' }),
        pb.collection('timeslot').getFullList({ sort: 'start' }),
      ])

      subjects = subjectsData
      students = studentsData
      teachers = teachersData
      groupRooms = groupRoomsData
      timeslots = timeslotsData

      setMaxStudentsAllowed()
    } catch (err) {
      console.error('Error loading dropdowns:', err)
      toast.error('Failed to load dropdown data')
    }
  }

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

  const getConflictLabel = (schedule, type) => {
    if (!schedule?.expand) return 'Unknown'

    const isGroupLesson = Array.isArray(schedule.student)

    switch (type) {
      case 'teacher':
        if (isGroupLesson) return 'Group Class'
        return schedule.expand.student?.englishName || 'Unknown Student'

      case 'student':
        return schedule.expand.teacher?.name || 'Unknown Teacher'

      case 'grouproom':
        const teacherName = schedule.expand.teacher?.name || 'Unknown Teacher'
        if (isGroupLesson) {
          const studentNames = schedule.expand.student?.map((st) => st.englishName).join(', ') || 'Group Students'
          return `${teacherName} & ${studentNames}`
        }
        const studentName = schedule.expand.student?.englishName || 'Unknown Student'
        return `${teacherName} & ${studentName}`

      default:
        return 'Unknown'
    }
  }

  const getStudentConflict = (studentId) => {
    return existingSchedules.find(
      (s) => s.student === studentId || (Array.isArray(s.student) && s.student.includes(studentId))
    )
  }

  // Reload schedules when date/timeslot changes
  $effect(() => {
    if (booking?.mondayData?.selectedDate && booking?.mondayData?.timeslot?.id) {
      loadExistingSchedules()
    }
  })

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
    const availableStudents = students.filter((s) => s.status !== 'graduated' && !getStudentConflict(s.id))

    if (maxStudentsAllowed > 0) {
      selectedStudents = availableStudents.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (availableStudents.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} students due to room limit`)
      }
    } else {
      selectedStudents = availableStudents.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

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

    // In-memory conflict checks
    if (conflicts.teacher) {
      const conflictInfo = getConflictLabel(conflicts.teacher, 'teacher')
      toast.error('Teacher conflict', {
        description: `${booking.mondayData.teacher.name || 'Teacher'} is already booked with ${conflictInfo}`,
      })
      return false
    }

    if (conflicts.students.length > 0) {
      const student = students.find((s) => s.id === conflicts.students[0])
      const conflictSchedule = getStudentConflict(conflicts.students[0])
      const conflictInfo = getConflictLabel(conflictSchedule, 'student')
      toast.error('Student conflict', {
        description: `${student?.englishName || 'Student'} is already booked with ${conflictInfo}`,
      })
      return false
    }

    if (conflicts.grouproom) {
      const conflictInfo = getConflictLabel(conflicts.grouproom, 'grouproom')
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

  const filteredStudents = $derived(
    students.filter((s) => s.englishName.toLowerCase().includes(searchTerm.toLowerCase()))
  )
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.mondayData?.mode === 'edit' ? 'Edit' : 'Create'} Monday Group Schedule
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
          This will {booking.mondayData?.mode === 'edit' ? 'update' : 'create'} a group schedule for Monday only
        </span>
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
                <button type="button" class="btn btn-xs btn-outline" onclick={selectAllStudents}> Select All </button>
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
                  {@const conflictSchedule = getStudentConflict(student.id)}
                  {@const isGraduated = student.status === 'graduated'}
                  {@const isBooked = !!conflictSchedule}

                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={isGraduated ||
                          isBooked ||
                          (maxStudentsAllowed > 0 &&
                            !selectedStudents.includes(student.id) &&
                            selectedStudents.length >= maxStudentsAllowed)}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text" class:italic={isGraduated || isBooked}>
                        {student.englishName}
                        {#if isGraduated}
                          <span class="text-xs text-gray-400">(Graduated)</span>
                        {:else if isBooked}
                          <span class="text-warning text-xs">
                            (Booked with {getConflictLabel(conflictSchedule, 'student')})
                          </span>
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
                {@const conflictSchedule = existingSchedules.find((s) => s.teacher === teacher.id)}
                <option value={teacher.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                  {teacher.name}
                  {#if conflictSchedule}
                    (Booked with {getConflictLabel(conflictSchedule, 'teacher')})
                  {/if}
                </option>
              {/each}
            </select>
            {#if conflicts.teacher}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This teacher is already booked</span>
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
                {@const conflictSchedule = existingSchedules.find((s) => s.room === room.id || s.grouproom === room.id)}
                <option value={room.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                  {room.name} (Max: {room.maxstudents} students)
                  {#if conflictSchedule}
                    - (Occupied by {getConflictLabel(conflictSchedule, 'grouproom')})
                  {/if}
                </option>
              {/each}
            </select>
            {#if conflicts.grouproom}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This room is already occupied</span>
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
                {booking.mondayData?.selectedDate
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
                {booking.mondayData?.groupRoom?.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {booking.mondayData?.timeslot?.start && booking.mondayData?.timeslot?.end
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
        {#if booking.mondayData?.mode === 'edit'}
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
            {booking.mondayData?.mode === 'edit' ? 'Update' : 'Save'} Schedule
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving || deleting}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
