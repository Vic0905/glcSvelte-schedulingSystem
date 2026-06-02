<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { onrefresh } = $props()

  // ─── Modal State ──────────
  let show = $state(false)
  let loading = $state(false)
  let showDeleteConfirm = $state(false)

  // ─── Dropdown Data ──────────
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // ─── Form ──────────
  let form = $state({
    mode: 'create',
    subject: null,
    teacher: null,
    room: null,
    timeslot: null,
  })

  // Track the original room+timeslot so we can find records in edit mode
  let originalState = $state({ timeslotId: null, roomId: null })

  // ─── Students ──────────
  // Simple list of student IDs (no per-student dates needed)
  let selectedStudentIds = $state([])
  let searchQuery = $state('')

  let filteredStudents = $derived(
    students
      .filter((s) => s.englishName?.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        const aSelected = selectedStudentIds.includes(a.id)
        const bSelected = selectedStudentIds.includes(b.id)
        return bSelected - aSelected
      })
  )

  // ─── Derived ──────────
  let maxCapacity = $derived(form.room?.maxStudents || 0)
  let currentCount = $derived(selectedStudentIds.length)
  let isOverCapacity = $derived(maxCapacity > 0 && currentCount > maxCapacity)

  // ─── Data Loading ──────────
  async function loadDropdowns() {
    try {
      const [subj, stu, teach, room, ts] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name' }),
        pb.collection('student').getFullList({ sort: 'englishName', filter: 'status != "graduated"' }),
        pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('roomType').getFullList({ sort: 'name' }),
        pb.collection('timeslot').getFullList({ sort: 'start' }),
      ])
      subjects = subj
      students = stu
      teachers = teach
      rooms = room
      timeslots = ts
    } catch (e) {
      toast.error('Failed to load dropdown options')
    }
  }

  // ─── Open / Close ──────────
  export async function open(data) {
    if (subjects.length === 0) await loadDropdowns()

    const existing = data.schedule || data.schedules?.[0]

    form = {
      mode: data.mode,
      subject: subjects.find((s) => s.id === (existing?.subject?.id || data.room?.expand?.subject?.id)) || null,
      teacher: teachers.find((t) => t.id === (existing?.teacher?.id || data.teacher?.id)) || null,
      room: rooms.find((r) => r.id === (existing?.roomId || data.room?.id)),
      timeslot: timeslots.find((t) => t.id === (existing?.timeslotId || data.timeslot?.id)),
    }

    originalState = {
      timeslotId: form.timeslot?.id,
      roomId: form.room?.id,
    }

    // Collect student IDs from existing advance records
    if (data.mode === 'edit' && data.schedules) {
      selectedStudentIds = data.schedules.flatMap((s) => {
        if (Array.isArray(s.students)) return s.students.map((x) => (typeof x === 'object' ? x.id : x))
        const id = s.student?.id ?? s.student ?? s.studentId
        return id ? [id] : []
      })
    } else {
      selectedStudentIds = []
    }

    showDeleteConfirm = false
    show = true
  }

  function close() {
    show = false
    loading = false
    showDeleteConfirm = false
    selectedStudentIds = []
    searchQuery = ''
  }

  // ─── Student Selection ──────────
  function toggleStudent(id) {
    if (selectedStudentIds.includes(id)) {
      selectedStudentIds = selectedStudentIds.filter((x) => x !== id)
      return
    }
    if (maxCapacity > 0 && currentCount >= maxCapacity) {
      toast.error(`Room capacity reached (${maxCapacity})`)
      return
    }
    selectedStudentIds = [...selectedStudentIds, id]
  }

  // ─── Validation ──────────
  function validateForm() {
    if (!form.subject || !form.teacher || !form.room || !form.timeslot) return 'Please fill all required fields'
    if (selectedStudentIds.length === 0) return 'Select at least one student'
    return null
  }

  // ─── Save ──────────
  async function save() {
    const error = validateForm()
    if (error) return toast.error(error)

    loading = true
    try {
      await checkConflicts()
      const batch = pb.createBatch()

      // In edit mode, delete existing advance records for this slot first
      if (form.mode === 'edit') {
        const toDelete = await pb.collection('advanceSchedule').getFullList({
          filter: `timeslot = "${originalState.timeslotId}" && room = "${originalState.roomId}"`,
          fields: 'id',
        })
        toDelete.forEach((rec) => batch.collection('advanceSchedule').delete(rec.id))
      }

      // Create one record per student
      selectedStudentIds.forEach((studentId) => {
        batch.collection('advanceSchedule').create({
          timeslot: form.timeslot.id,
          teacher: form.teacher.id,
          subject: form.subject.id,
          room: form.room.id,
          student: studentId,
        })
      })

      await batch.send()
      toast.success(form.mode === 'edit' ? 'Advance schedule updated' : 'Advance schedule created')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'An error occurred')
    } finally {
      loading = false
    }
  }

  // ─── Conflict Check ──────────
  async function checkConflicts() {
    const existingRecords = await pb.collection('advanceSchedule').getFullList({
      filter: `timeslot = "${form.timeslot.id}"`,
      expand: 'room,teacher',
    })

    // Exclude the records we're currently editing
    const others =
      form.mode === 'edit'
        ? existingRecords.filter((s) => !(s.room === originalState.roomId && s.timeslot === originalState.timeslotId))
        : existingRecords

    // Teacher already booked in this timeslot (different room)
    const teacherBusy = others.find((s) => s.teacher === form.teacher.id)
    if (teacherBusy)
      throw new Error(
        `${form.teacher.name} is already booked in ${teacherBusy.expand?.room?.name || 'another room'} at this timeslot.`
      )

    // Room taken by a different teacher
    const roomTaken = others.find((s) => s.room === form.room.id && s.teacher !== form.teacher.id)
    if (roomTaken)
      throw new Error(
        `${form.room.name} is occupied by ${roomTaken.expand?.teacher?.name || 'another teacher'} at this timeslot.`
      )

    // Any selected student already booked at this timeslot
    for (const studentId of selectedStudentIds) {
      const studentBusy = others.find((s) => s.student === studentId)
      if (studentBusy) {
        const name = students.find((s) => s.id === studentId)?.englishName || 'A student'
        throw new Error(
          `${name} already has an advance booking in ${studentBusy.expand?.room?.name || 'another room'} at this timeslot.`
        )
      }
    }
  }
  // ─── Delete ──────────
  async function deleteSchedule() {
    loading = true
    try {
      const toDelete = await pb.collection('advanceSchedule').getFullList({
        filter: `timeslot = "${originalState.timeslotId}" && room = "${originalState.roomId}"`,
        fields: 'id',
      })

      if (toDelete.length === 0) return toast.error('No matching advance schedule records found')

      const batch = pb.createBatch()
      toDelete.forEach((rec) => batch.collection('advanceSchedule').delete(rec.id))
      await batch.send()

      toast.success('Advance schedule deleted')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'Failed to delete advance schedule')
    } finally {
      loading = false
      showDeleteConfirm = false
    }
  }
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-4xl border border-base-300 shadow-2xl">
      <header class="mb-6 text-center">
        <h3 class="text-xl font-bold">
          {form.mode === 'edit' ? 'Edit' : 'Create'}
          {maxCapacity > 1 ? 'Group' : 'MTM'} Advance Schedule
        </h3>
        <p class="text-xs opacity-60 uppercase tracking-widest">Advance Booking (no date range)</p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Left: Schedule Fields -->
        <div class="space-y-4">
          <div class="form-control">
            <label class="label text-xs font-bold" for="adv-subject">Subject</label>
            <select id="adv-subject" bind:value={form.subject} class="select select-bordered select-sm w-full">
              <option value={null}>Select Subject</option>
              {#each subjects as s (s.id)}
                <option value={s}>{s.name}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label text-xs font-bold" for="adv-teacher">Teacher</label>
            <select id="adv-teacher" bind:value={form.teacher} class="select select-bordered select-sm w-full">
              <option value={null}>Select Teacher</option>
              {#each teachers as t (t.id)}
                <option value={t}>{t.name}</option>
              {/each}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="form-control">
              <label class="label text-xs font-bold" for="adv-room">Room</label>
              <select id="adv-room" bind:value={form.room} class="select select-bordered select-sm w-full">
                {#each rooms as r (r.id)}
                  <option value={r}>{r.name}</option>
                {/each}
              </select>
            </div>
            <div class="form-control">
              <label class="label text-xs font-bold" for="adv-timeslot">Timeslot</label>
              <select id="adv-timeslot" bind:value={form.timeslot} class="select select-bordered select-sm w-full">
                {#each timeslots as ts (ts.id)}
                  <option value={ts}>{ts.start} - {ts.end}</option>
                {/each}
              </select>
            </div>
          </div>
        </div>

        <!-- Right: Student Selection -->
        <div class="flex flex-col">
          <div class="flex justify-between items-center mb-2">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-xs font-bold uppercase">Students</label>
            <span class="badge {isOverCapacity ? 'badge-error' : 'badge-ghost'} badge-sm transition-colors">
              {currentCount} / {maxCapacity || '∞'}
            </span>
          </div>

          <input
            type="text"
            placeholder="Search students..."
            bind:value={searchQuery}
            class="input input-bordered input-sm w-full mb-3"
          />

          <div class="border rounded-lg overflow-y-auto bg-base-200/50 p-2 h-72">
            {#each filteredStudents as s (s.id)}
              {@const isSelected = selectedStudentIds.includes(s.id)}

              <label
                class="flex items-center gap-3 p-2 hover:bg-base-300 rounded-md cursor-pointer transition-all {isSelected
                  ? 'bg-base-300/60'
                  : ''}"
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-primary checkbox-sm"
                  checked={isSelected}
                  onchange={() => toggleStudent(s.id)}
                  disabled={!isSelected && maxCapacity > 0 && currentCount >= maxCapacity}
                />
                <span class="text-sm {isSelected ? 'font-bold text-primary' : ''}">
                  {s.englishName}
                </span>
              </label>
            {:else}
              <p class="text-xs opacity-50 p-4 text-center">No students match your search.</p>
            {/each}
          </div>

          {#if isOverCapacity}
            <p class="text-xs text-error mt-1">Over room capacity ({maxCapacity} max)</p>
          {/if}
        </div>
      </div>

      <!-- Delete Confirmation -->
      {#if showDeleteConfirm}
        <div class="alert alert-soft alert-error mt-6 flex items-center justify-between gap-4">
          <span class="text-sm font-medium">Delete all records for this advance slot? This cannot be undone.</span>
          <div class="flex gap-2 shrink-0">
            <button class="btn btn-sm btn-ghost" onclick={() => (showDeleteConfirm = false)} disabled={loading}>
              Cancel
            </button>
            <button class="btn btn-sm btn-ghost" onclick={deleteSchedule} disabled={loading}>
              {#if loading}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                Confirm Delete
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Actions -->
      <div class="modal-action mt-8">
        {#if form.mode === 'edit'}
          <button
            class="btn btn-error btn-soft mr-auto"
            onclick={() => (showDeleteConfirm = true)}
            disabled={loading || showDeleteConfirm}
          >
            Delete Schedule
          </button>
        {/if}

        <button class="btn btn-soft btn-ghost" onclick={close} disabled={loading}>Cancel</button>
        <button class="btn btn-soft btn-info min-w-[140px]" onclick={save} disabled={loading || isOverCapacity}>
          {#if loading}
            <span class="loading loading-spinner"></span>
          {:else}
            Save Schedule
          {/if}
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-black/40" role="presentation" onclick={close}></div>
  </dialog>
{/if}
