<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), advanceGroupBooking = $bindable(), onSave } = $props()

  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let groupRooms = $state([])
  let timeslots = $state([])
  let saving = $state(false)
  let selectedStudents = $state([])
  let maxStudentsAllowed = $state(0)
  let searchTerm = $state('')
  let advanceBookings = $state([])
  let otherGroupBookings = $state([])

  // Consolidated conflict detection using $derived
  const conflicts = $derived({
    teacher:
      advanceBookings.find((b) => b.teacher === advanceGroupBooking.teacher?.id) ||
      otherGroupBookings.find((b) => b.teacher === advanceGroupBooking.teacher?.id),
    students: selectedStudents.filter(
      (studentId) =>
        advanceBookings.some((b) => b.student === studentId) ||
        otherGroupBookings.some((b) => Array.isArray(b.student) && b.student.includes(studentId))
    ),
  })

  // Load data when modal opens
  $effect(() => {
    if (show) {
      loadAllData()
      // Initialize selected students from booking data
      if (advanceGroupBooking.mode === 'edit' && advanceGroupBooking.students) {
        selectedStudents = advanceGroupBooking.students.map((student) => student.id)
      } else {
        selectedStudents = []
      }
      setMaxStudentsAllowed()
    }
  })

  // Load conflict data when timeslot changes
  $effect(() => {
    if (advanceGroupBooking.timeslot?.id) {
      loadConflictData()
    }
  })

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
    advanceBookings = []
    otherGroupBookings = []
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
    } catch (err) {
      console.error('Error loading data:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  const loadConflictData = async () => {
    try {
      const timeslotId = advanceGroupBooking.timeslot.id
      if (!timeslotId) {
        advanceBookings = []
        otherGroupBookings = []
        return
      }

      const excludeFilter =
        advanceGroupBooking.mode === 'edit' && advanceGroupBooking.id ? ` && id != "${advanceGroupBooking.id}"` : ''

      const [individualBookings, groupBookings] = await Promise.all([
        pb.collection('advanceBooking').getFullList({
          filter: `timeslot = "${timeslotId}"`,
          expand: 'teacher,student',
        }),
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `timeslot = "${timeslotId}"${excludeFilter}`,
            expand: 'teacher,student',
          })
          .catch(() => []),
      ])

      advanceBookings = individualBookings
      otherGroupBookings = groupBookings
    } catch (error) {
      console.error('Error loading conflict data:', error)
      advanceBookings = []
      otherGroupBookings = []
    }
  }

  const getStudentConflict = (studentId) => {
    return (
      advanceBookings.find((b) => b.student === studentId) ||
      otherGroupBookings.find((b) => Array.isArray(b.student) && b.student.includes(studentId))
    )
  }

  const getConflictLabel = (booking, type) => {
    if (!booking?.expand) return 'Already booked'

    const isGroupLesson = Array.isArray(booking.student)

    switch (type) {
      case 'teacher':
        if (isGroupLesson) {
          const count = booking.student?.length || 0
          return `Group lesson (${count} students)`
        }
        return `Individual lesson with ${booking.expand.student?.englishName || 'Unknown Student'}`

      case 'student':
        if (isGroupLesson) {
          return `Group lesson with ${booking.expand.teacher?.name || 'Unknown Teacher'}`
        }
        return `Individual lesson with ${booking.expand.teacher?.name || 'Unknown Teacher'}`

      default:
        return 'Already booked'
    }
  }

  function setMaxStudentsAllowed() {
    if (advanceGroupBooking.groupRoom?.id && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === advanceGroupBooking.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = advanceGroupBooking.groupRoom?.maxstudents || 0
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
    const conflictBooking = getStudentConflict(studentId)

    // Don't allow toggling conflicted students
    if (conflictBooking && !selectedStudents.includes(studentId)) {
      toast.error('This student is already booked at this timeslot')
      return
    }

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
    // Filter out conflicted and graduated students
    const availableStudents = students.filter((s) => s.status !== 'graduated' && !getStudentConflict(s.id))

    if (maxStudentsAllowed > 0) {
      selectedStudents = availableStudents.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (availableStudents.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} available students due to room limit`)
      }
    } else {
      selectedStudents = availableStudents.map((s) => s.id)
    }

    const conflictedCount = students.filter((s) => s.status !== 'graduated' && getStudentConflict(s.id)).length

    if (conflictedCount > 0) {
      toast.info(`${conflictedCount} student(s) skipped due to conflicts`)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  const validateSchedule = () => {
    if (!advanceGroupBooking.subject?.id) {
      toast.error('Please select a subject')
      return false
    }
    if (selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return false
    }
    if (!advanceGroupBooking.groupRoom?.id) {
      toast.error('Please select a group room')
      return false
    }
    if (!advanceGroupBooking.teacher?.id) {
      toast.error('Please select a teacher')
      return false
    }
    if (!advanceGroupBooking.timeslot?.id) {
      toast.error('Please select a timeslot')
      return false
    }

    // In-memory conflict checks
    if (conflicts.teacher) {
      const conflictInfo = getConflictLabel(conflicts.teacher, 'teacher')
      toast.error('Selected teacher is already booked at this timeslot', {
        description: conflictInfo,
      })
      return false
    }

    if (conflicts.students.length > 0) {
      const student = students.find((s) => s.id === conflicts.students[0])
      const conflictBooking = getStudentConflict(conflicts.students[0])
      const conflictInfo = getConflictLabel(conflictBooking, 'student')
      toast.error('Some selected students are already booked', {
        description: `${student?.englishName || 'Student'} - ${conflictInfo}`,
      })
      return false
    }

    return true
  }

  async function saveSchedule() {
    if (!validateSchedule()) return

    saving = true
    try {
      const payload = {
        grouproom: advanceGroupBooking.groupRoom.id,
        timeslot: advanceGroupBooking.timeslot.id,
        subject: advanceGroupBooking.subject.id,
        teacher: advanceGroupBooking.teacher.id,
        student: selectedStudents,
      }

      if (advanceGroupBooking.mode === 'edit') {
        await pb.collection('groupAdvanceBooking').update(advanceGroupBooking.id, payload)
        toast.success('Advance group schedule template updated!')
      } else {
        await pb.collection('groupAdvanceBooking').create(payload)
        toast.success('Advance group schedule template created!')
      }

      closeModal()
      setTimeout(() => onSave?.(), 200)
    } catch (err) {
      console.error('Error saving schedule:', err)
      toast.error(`Error saving schedule: ${err.message}`)
    } finally {
      saving = false
    }
  }

  async function deleteSchedule() {
    if (!advanceGroupBooking.id) return

    if (!confirm('Are you sure you want to delete this advance schedule template?')) return

    saving = true
    try {
      await pb.collection('groupAdvanceBooking').delete(advanceGroupBooking.id)
      toast.success('Advance group schedule template deleted!')
      closeModal()
      setTimeout(() => onSave?.(), 200)
    } catch (err) {
      console.error('Error deleting schedule:', err)
      toast.error(`Error deleting schedule: ${err.message}`)
    } finally {
      saving = false
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
        {advanceGroupBooking.mode === 'edit' ? 'Edit' : 'Create'} Advance Group Schedule Template
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <label class="label"><span class="label-text">Subject</span></label>
            <select bind:value={advanceGroupBooking.subject.id} class="select select-bordered w-full" required>
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

            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto">
              {#each filteredStudents as student (student.id)}
                {#if student.status !== 'graduated' || selectedStudents.includes(student.id)}
                  {@const conflictBooking = getStudentConflict(student.id)}
                  {@const isGraduated = student.status === 'graduated'}
                  {@const isConflicted = !!conflictBooking}
                  {@const isDisabled =
                    isConflicted ||
                    isGraduated ||
                    (maxStudentsAllowed > 0 &&
                      !selectedStudents.includes(student.id) &&
                      selectedStudents.length >= maxStudentsAllowed)}

                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={isDisabled}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text" class:italic={isDisabled}>
                        {student.englishName}
                        {#if isGraduated}
                          <span class="text-xs text-gray-400 ml-2">(Graduated)</span>
                        {:else if isConflicted}
                          <span class="text-xs text-warning ml-2">
                            ({getConflictLabel(conflictBooking, 'student')})
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
            <select bind:value={advanceGroupBooking.teacher.id} class="select select-bordered w-full" required>
              <option value="">-- Select Teacher --</option>
              {#each teachers as t}
                {@const conflictBooking =
                  advanceBookings.find((b) => b.teacher === t.id) || otherGroupBookings.find((b) => b.teacher === t.id)}
                <option value={t.id} disabled={!!conflictBooking} class:text-gray-400={conflictBooking}>
                  {t.name}
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
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={advanceGroupBooking.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as gr}
                <option value={gr.id}>{gr.name} (Max: {gr.maxstudents} students)</option>
              {/each}
            </select>
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select bind:value={advanceGroupBooking.timeslot.id} class="select select-bordered w-full" required>
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Info Display -->
          <div class="form-control">
            <label class="label"><span class="label-text">Template Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {advanceGroupBooking.groupRoom?.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {advanceGroupBooking.timeslot?.start && advanceGroupBooking.timeslot?.end
                  ? `${advanceGroupBooking.timeslot.start} - ${advanceGroupBooking.timeslot.end}`
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
        {#if advanceGroupBooking.mode === 'edit'}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={saving}>
            {#if saving}
              <span class="loading loading-spinner loading-sm"></span>
              Deleting...
            {:else}
              Delete Template
            {/if}
          </button>
        {/if}

        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving}>
          {#if saving}
            <span class="loading loading-spinner loading-sm"></span>
            Saving...
          {:else}
            {advanceGroupBooking.mode === 'edit' ? 'Update' : 'Save'} Template
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
