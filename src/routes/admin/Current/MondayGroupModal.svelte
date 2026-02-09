<script>
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const dispatch = createEventDispatcher()

  let { show = $bindable(false), groupBooking = $bindable() } = $props()

  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let groupRooms = $state([])
  let timeslots = $state([])

  let selectedStudents = $state([])
  let maxStudentsAllowed = $state(0)
  let searchTerm = $state('')

  let saving = $state(false)
  let deleting = $state(false)
  let dataLoaded = $state(false)

  /* Load dropdown data ONCE when modal opens */
  $effect(() => {
    if (show && !dataLoaded) {
      loadAllData()
      dataLoaded = true

      if (groupBooking?.mode === 'edit' && Array.isArray(groupBooking.students)) {
        selectedStudents = groupBooking.students.map((s) => s.id ?? s)
      } else {
        selectedStudents = []
      }

      setMaxStudentsAllowed()
    }
  })

  function closeModal() {
    show = false
    selectedStudents = []
    searchTerm = ''
    maxStudentsAllowed = 0
  }

  async function loadAllData() {
    try {
      const [subjectsData, studentsData, teachersData, groupRoomsData, timeslotsData] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }),
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('groupRoom').getFullList({ sort: 'name', fields: 'id,name,maxstudents' }),
        pb.collection('timeslot').getFullList({ sort: 'start', fields: 'id,start,end' }),
      ])

      subjects = subjectsData
      students = studentsData
      teachers = teachersData
      groupRooms = groupRoomsData
      timeslots = timeslotsData
    } catch (err) {
      console.error(err)
      toast.error('Failed to load dropdown data')
    }
  }

  function setMaxStudentsAllowed() {
    const room = groupRooms.find((r) => r.id === groupBooking?.groupRoom?.id)
    maxStudentsAllowed = room?.maxstudents || 0
  }

  function onGroupRoomChange() {
    setMaxStudentsAllowed()

    if (maxStudentsAllowed > 0 && selectedStudents.length > maxStudentsAllowed) {
      selectedStudents = selectedStudents.slice(0, maxStudentsAllowed)
      toast.warning(`Maximum ${maxStudentsAllowed} students allowed for this room`)
    }
  }

  function toggleStudent(studentId) {
    if (selectedStudents.includes(studentId)) {
      selectedStudents = selectedStudents.filter((id) => id !== studentId)
    } else {
      if (maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed) {
        toast.warning(`Maximum ${maxStudentsAllowed} students allowed`)
        return
      }
      selectedStudents = [...selectedStudents, studentId]
    }
  }

  function selectAllStudents() {
    const available = students.filter((s) => s.status !== 'graduated')

    if (maxStudentsAllowed > 0) {
      selectedStudents = available.slice(0, maxStudentsAllowed).map((s) => s.id)
    } else {
      selectedStudents = available.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  function validateSchedule() {
    if (!groupBooking?.subject?.id) return (toast.error('Select a subject'), false)
    if (!groupBooking?.teacher?.id) return (toast.error('Select a teacher'), false)
    if (!groupBooking?.groupRoom?.id) return (toast.error('Select a group room'), false)
    if (!groupBooking?.timeslot?.id) return (toast.error('Select a timeslot'), false)
    if (selectedStudents.length === 0) return (toast.error('Select at least one student'), false)
    return true
  }

  async function checkForConflicts() {
    const { date, timeslot, teacher, groupRoom } = groupBooking

    try {
      // 1. Check if teacher has another group lesson at same time
      const teacherGroupConflict = await pb
        .collection('mondayGroupLessonSchedule')
        .getList(1, 1, {
          filter: `date = "${date}" && timeslot = "${timeslot.id}" && teacher = "${teacher.id}" && id != "${groupBooking.id || ''}"`,
        })
        .catch(() => ({ items: [] }))

      if (teacherGroupConflict.items.length > 0) {
        toast.error(`${teacher.name} is already teaching another group lesson at this time`)
        return false
      }

      // 2. Check if room is already booked
      const roomConflict = await pb
        .collection('mondayGroupLessonSchedule')
        .getList(1, 1, {
          filter: `date = "${date}" && timeslot = "${timeslot.id}" && grouproom = "${groupRoom.id}" && id != "${groupBooking.id || ''}"`,
        })
        .catch(() => ({ items: [] }))

      if (roomConflict.items.length > 0) {
        toast.error(`${groupRoom.name} is already booked for another group at this time`)
        return false
      }

      // 3. Check if any student is already in another group lesson
      if (selectedStudents.length > 0) {
        // Get all group lessons at this time
        const allGroupLessons = await pb
          .collection('mondayGroupLessonSchedule')
          .getFullList({
            filter: `date = "${date}" && timeslot = "${timeslot.id}" && id != "${groupBooking.id || ''}"`,
          })
          .catch(() => [])

        // Check each selected student
        for (const studentId of selectedStudents) {
          const student = students.find((s) => s.id === studentId)
          const studentName = student?.englishName || 'Student'

          // Look for conflicts
          const hasConflict = allGroupLessons.some(
            (lesson) => Array.isArray(lesson.student) && lesson.student.includes(studentId)
          )

          if (hasConflict) {
            toast.error(`${studentName} is already in another group lesson at this time`)
            return false
          }
        }
      }

      return true // No conflicts
    } catch (error) {
      console.error('Conflict check error:', error)
      toast.error('Error checking for conflicts')
      return false
    }
  }

  async function saveSchedule() {
    if (!validateSchedule()) return

    // Check for conflicts
    const hasNoConflicts = await checkForConflicts()
    if (!hasNoConflicts) return

    const payload = {
      date: groupBooking.date,
      timeslot: groupBooking.timeslot.id,
      teacher: groupBooking.teacher.id,
      subject: groupBooking.subject.id,
      grouproom: groupBooking.groupRoom.id,
      student: selectedStudents,
    }

    saving = true
    try {
      if (groupBooking.mode === 'edit' && groupBooking.id) {
        await pb.collection('mondayGroupLessonSchedule').update(groupBooking.id, payload)
        toast.success('Schedule updated')
      } else {
        await pb.collection('mondayGroupLessonSchedule').create(payload)
        toast.success('Schedule created')
      }

      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      console.error(err)
      toast.error('Failed to save schedule')
    } finally {
      saving = false
    }
  }

  async function deleteSchedule() {
    if (!groupBooking?.id) return

    if (!confirm('Delete this schedule? This cannot be undone.')) return

    deleting = true
    try {
      await pb.collection('mondayGroupLessonSchedule').delete(groupBooking.id)
      toast.success('Schedule deleted')
      closeModal()
      setTimeout(() => dispatch('refresh'), 200)
    } catch (err) {
      console.error(err)
      toast.error(err.message)
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
        {groupBooking?.mode === 'edit' ? 'Edit' : 'Create'} Monday Group Schedule
      </h3>

      <div class="alert alert-info text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>
          This will {groupBooking?.mode === 'edit' ? 'update' : 'create'} a group schedule for Monday only
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- LEFT COLUMN -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text">Subject</span>
            </label>
            <select bind:value={groupBooking.subject.id} class="select select-bordered w-full" required>
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
                  {@const isGraduated = student.status === 'graduated'}

                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={isGraduated ||
                          (maxStudentsAllowed > 0 &&
                            !selectedStudents.includes(student.id) &&
                            selectedStudents.length >= maxStudentsAllowed)}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text" class:italic={isGraduated}>
                        {student.englishName}
                        {#if isGraduated}
                          <span class="text-xs text-gray-400">(Graduated)</span>
                        {/if}
                      </span>
                    </label>
                  </div>
                {/if}
              {/each}

              {#if filteredStudents.filter((s) => s.status !== 'graduated' || selectedStudents.includes(s.id)).length === 0}
                <p class="text-sm text-center py-4">No matching students</p>
              {/if}
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN -->
        <div class="space-y-4">
          <!-- Teacher -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text">Teacher</span>
            </label>
            <select bind:value={groupBooking.teacher.id} class="select select-bordered w-full" required>
              <option value="">-- Select Teacher --</option>
              {#each teachers as teacher}
                <option value={teacher.id}>{teacher.name}</option>
              {/each}
            </select>
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text">Group Room</span>
            </label>
            <select
              bind:value={groupBooking.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as room}
                <option value={room.id}>
                  {room.name} (Max: {room.maxstudents} students)
                </option>
              {/each}
            </select>
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text">Timeslot</span>
            </label>
            <select bind:value={groupBooking.timeslot.id} class="select select-bordered w-full" required>
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Schedule Info -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text">Schedule Info</span>
            </label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Date:</span>
                {groupBooking?.date
                  ? new Date(groupBooking.date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {groupBooking?.groupRoom?.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {groupBooking?.timeslot?.start && groupBooking?.timeslot?.end
                  ? `${groupBooking.timeslot.start} - ${groupBooking.timeslot.end}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Students:</span>
                {selectedStudents.length}
                {#if maxStudentsAllowed > 0}
                  (Max: {maxStudentsAllowed})
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ACTION BUTTONS -->
      <div class="modal-action">
        {#if groupBooking?.mode === 'edit'}
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
            {groupBooking?.mode === 'edit' ? 'Update' : 'Save'} Schedule
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving || deleting}> Cancel </button>
      </div>
    </div>
  </div>
{/if}
