<script>
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  export let show = false
  export let advanceGroupBooking
  export let onSave

  let subjects = []
  let students = []
  let teachers = []
  let groupRooms = []
  let timeslots = []
  let saving = false
  let selectedStudents = []
  let maxStudentsAllowed = 0
  let searchTerm = ''

  // Reactive statement to load data when modal opens
  $: if (show) {
    loadDropdowns()
    // Initialize selected students from booking data
    if (advanceGroupBooking.mode === 'edit' && advanceGroupBooking.students) {
      selectedStudents = advanceGroupBooking.students.map((student) => student.id)
    } else {
      selectedStudents = []
    }
    setMaxStudentsAllowed()
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
  }

  async function loadDropdowns() {
    try {
      subjects = await pb.collection('subject').getFullList({ sort: 'name' })
      students = await pb.collection('student').getFullList({ sort: 'name' })
      teachers = await pb.collection('teacher').getFullList({ sort: 'name' })
      groupRooms = await pb.collection('groupRoom').getFullList({ sort: 'name' })
      timeslots = await pb.collection('timeslot').getFullList({ sort: 'start' })
    } catch (err) {
      toast.error('Failed to load dropdown data')
    }
  }

  function setMaxStudentsAllowed() {
    if (advanceGroupBooking.groupRoom.id && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === advanceGroupBooking.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = advanceGroupBooking.groupRoom.maxstudents || 0
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
    if (!advanceGroupBooking.subject.id) {
      toast.error('Please select a subject')
      return
    }
    if (selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return
    }
    if (!advanceGroupBooking.groupRoom.id) {
      toast.error('Please select a group room')
      return
    }
    if (!advanceGroupBooking.teacher.id) {
      toast.error('Please select a teacher')
      return
    }
    if (!advanceGroupBooking.timeslot.id) {
      toast.error('Please select a timeslot')
      return
    }

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
        {advanceGroupBooking.mode === 'edit'
          ? 'Edit Advance Group Schedule Template'
          : 'Create Advance Group Schedule Template'}
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
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
                <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={selectedStudents.includes(student.id)}
                      disabled={maxStudentsAllowed > 0 &&
                        !selectedStudents.includes(student.id) &&
                        selectedStudents.length >= maxStudentsAllowed}
                      onchange={() => toggleStudent(student.id)}
                    />
                    <span
                      class="label-text {maxStudentsAllowed > 0 &&
                      !selectedStudents.includes(student.id) &&
                      selectedStudents.length >= maxStudentsAllowed
                        ? 'opacity-50'
                        : ''}">{student.name}</span
                    >
                  </label>
                </div>
              {/each}
              {#if filteredStudents.length === 0}
                <p class="text-sm text-base-content/60 text-center py-4">No matching students</p>
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
            <select bind:value={advanceGroupBooking.teacher.id} class="select select-bordered w-full" required>
              <option value="">-- Select Teacher --</option>
              {#each teachers as t}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
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
            <!-- svelte-ignore a11y_label_has_associated_control -->
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
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text">Template Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {advanceGroupBooking.groupRoom.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {advanceGroupBooking.timeslot.start && advanceGroupBooking.timeslot.end
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
        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving}>
          {saving ? 'Saving...' : advanceGroupBooking.mode === 'edit' ? 'Update Template' : 'Save Template'}
        </button>
        {#if advanceGroupBooking.mode === 'edit'}
          <button class="btn btn-error btn-outline" onclick={deleteSchedule} disabled={saving}>
            Delete Template
          </button>
        {/if}
        <button class="btn" onclick={closeModal}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
