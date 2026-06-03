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
    id: null,
    subject: null,
    teacher: null,
    room: null,
    timeslot: null,
    startDate: null,
    endDate: null,
  })

  // The original timeslot/room/date so we can find & replace records in edit mode
  let originalState = $state({ timeslotId: null, roomId: null, startDate: null })

  // ─── Students ──────────
  // Each entry: { id, startDate, endDate }
  let selectedStudents = $state([])
  let searchQuery = $state('')
  let filteredStudents = $derived(
    students
      .filter((s) => s.englishName?.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        const aSelected = selectedStudents.some((x) => x.id === a.id)
        const bSelected = selectedStudents.some((x) => x.id === b.id)
        return bSelected - aSelected
      })
  )

  // ─── Derived ──────────
  let maxCapacity = $derived(form.room?.maxStudents || 0)
  let currentCount = $derived(selectedStudents.length)
  let isOverCapacity = $derived(maxCapacity > 0 && currentCount > maxCapacity)

  // ─── Data Loading ──────────

  async function loadDropdowns() {
    try {
      const [subj, stu, teach, room, ts] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name' }),
        pb.collection('student').getFullList({ sort: 'englishName', filter: 'status != "graduated"' }),
        pb.collection('teacher').getFullList({ sort: 'name', filter: 'status != "disabled"' }),
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
      id: existing?.id || null,
      subject: subjects.find((s) => s.id === (existing?.subject?.id || data.room?.expand?.subject?.id)) || null,
      teacher: teachers.find((t) => t.id === (existing?.teacher?.id || data.teacher?.id)) || null,
      room: rooms.find((r) => r.id === (existing?.roomId || data.room?.id)),
      timeslot: timeslots.find((t) => t.id === (existing?.timeslotId || data.timeslot?.id)),
      startDate: data.startDate,
      endDate: data.endDate,
    }

    originalState = {
      timeslotId: form.timeslot?.id,
      roomId: form.room?.id,
      startDate: data.startDate,
    }

    selectedStudents = data.mode === 'edit' && data.schedules ? extractStudentsFromSchedules(data.schedules, data) : []

    showDeleteConfirm = false
    show = true
  }

  function extractStudentsFromSchedules(schedules, data) {
    return schedules.flatMap((s) => {
      const startDate = s.start?.split(' ')[0] || data.startDate
      const endDate = s.end?.split(' ')[0] || data.endDate
      const getId = (stu) => (typeof stu === 'object' ? stu.id : stu)

      if (Array.isArray(s.students)) {
        return s.students.map((stu) => ({ id: getId(stu), startDate, endDate }))
      }

      const id = s.student?.id ?? s.student ?? s.studentId
      return id ? [{ id, startDate, endDate }] : []
    })
  }

  function close() {
    show = false
    loading = false
    showDeleteConfirm = false
    selectedStudents = []
    searchQuery = ''
  }

  // ─── Student Selection ──────────

  function toggleStudent(id) {
    const alreadySelected = selectedStudents.find((s) => s.id === id)

    if (alreadySelected) {
      selectedStudents = selectedStudents.filter((s) => s.id !== id)
      return
    }

    if (maxCapacity > 0 && currentCount >= maxCapacity) {
      toast.error(`Room capacity reached (${maxCapacity})`)
      return
    }

    selectedStudents = [...selectedStudents, { id, startDate: form.startDate, endDate: form.endDate }]
  }

  function updateStudentDate(id, field, value) {
    selectedStudents = selectedStudents.map((s) => (s.id === id ? { ...s, [field]: value } : s))
  }

  // ─── Validation ──────────

  function validateForm() {
    if (!form.subject || !form.teacher || !form.room || !form.timeslot) return 'Please fill all required fields'
    if (selectedStudents.length === 0) return 'Select at least one student'

    for (const stu of selectedStudents) {
      const name = students.find((s) => s.id === stu.id)?.englishName || 'A student'
      if (!stu.startDate || !stu.endDate) return `${name} is missing a start or end date`
      if (stu.endDate < stu.startDate) return `${name}'s end date is before their start date`
    }

    return null
  }

  // ─── Conflict Check ──────────

  async function checkConflicts() {
    for (const stu of selectedStudents) {
      const startStr = `${stu.startDate} 00:00:00.000Z`
      const endStr = `${stu.endDate} 00:00:00.000Z`

      const records = await pb.collection('schedule').getFullList({
        filter: `timeslot = "${form.timeslot.id}" && start <= "${endStr}" && end >= "${startStr}"`,
        expand: 'room,teacher',
      })

      // Exclude the records we're currently editing
      const others =
        form.mode === 'edit'
          ? records.filter(
              (s) =>
                s.room !== originalState.roomId ||
                s.timeslot !== originalState.timeslotId ||
                s.start.split(' ')[0] !== originalState.startDate
            )
          : records

      // Teacher already booked elsewhere
      const teacherBusy = others.find((s) => s.teacher === form.teacher.id)
      if (teacherBusy)
        throw new Error(`${form.teacher.name} is busy in ${teacherBusy.expand?.room?.name || 'another room'}.`)

      // Room taken by a different teacher
      const roomTaken = others.find((s) => s.room === form.room.id && s.teacher !== form.teacher.id)
      if (roomTaken)
        throw new Error(`${form.room.name} is occupied by ${roomTaken.expand?.teacher?.name || 'another teacher'}.`)

      // Student already has a class at this time
      const studentBusy = others.find((s) => {
        const sid = typeof s.student === 'object' ? s.student.id : s.student
        return sid === stu.id
      })
      if (studentBusy) {
        const name = students.find((s) => s.id === stu.id)?.englishName || 'Student'
        throw new Error(`${name} already has a class in ${studentBusy.expand?.room?.name}.`)
      }
    }
  }

  // ─── Save ──────────

  async function save() {
    const error = validateForm()
    if (error) return toast.error(error)

    loading = true
    try {
      await checkConflicts()

      const batch = pb.createBatch()

      // In edit mode, delete existing records first
      if (form.mode === 'edit') {
        const toDelete = await pb.collection('schedule').getFullList({
          filter: `timeslot = "${originalState.timeslotId}" && room = "${originalState.roomId}" && start = "${originalState.startDate} 00:00:00.000Z"`,
          fields: 'id',
        })
        toDelete.forEach((rec) => batch.collection('schedule').delete(rec.id))
      }

      // Create one record per student
      selectedStudents.forEach(({ id: studentId, startDate, endDate }) => {
        batch.collection('schedule').create({
          timeslot: form.timeslot.id,
          teacher: form.teacher.id,
          subject: form.subject.id,
          room: form.room.id,
          student: studentId,
          start: `${startDate} 00:00:00.000Z`,
          end: `${endDate} 00:00:00.000Z`,
        })
      })

      await batch.send()
      toast.success(form.mode === 'edit' ? 'Schedule updated' : 'Schedule created')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'An error occurred')
    } finally {
      loading = false
    }
  }

  // ─── Delete ────────

  async function deleteSchedule() {
    loading = true
    try {
      const toDelete = await pb.collection('schedule').getFullList({
        filter: `timeslot = "${originalState.timeslotId}" && room = "${originalState.roomId}" && start = "${originalState.startDate} 00:00:00.000Z"`,
        fields: 'id',
      })

      if (toDelete.length === 0) return toast.error('No matching schedule records found')

      const batch = pb.createBatch()
      toDelete.forEach((rec) => batch.collection('schedule').delete(rec.id))
      await batch.send()

      toast.success('Schedule deleted')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'Failed to delete schedule')
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
          {maxCapacity > 1 ? 'Group' : 'MTM'} Schedule
        </h3>
        <p class="text-xs opacity-60 uppercase tracking-widest">{form.startDate} — {form.endDate}</p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Left: Schedule Fields -->
        <div class="space-y-4">
          <!-- <div class="grid grid-cols-2 gap-2">
            <div class="form-control">
              <label class="label text-xs font-bold" for="start">Default Start</label>
              <input
                id="start"
                type="date"
                bind:value={form.startDate}
                class="input input-bordered input-sm w-full"
                disabled={form.mode === 'edit'}
              />
            </div>
            <div class="form-control">
              <label class="label text-xs font-bold" for="end">Default End</label>
              <input
                id="end"
                type="date"
                bind:value={form.endDate}
                class="input input-bordered input-sm w-full"
                disabled={form.mode === 'edit'}
              />
            </div>
          </div> -->

          <div class="form-control">
            <label class="label text-xs font-bold" for="subject">Subject</label>
            <select id="subject" bind:value={form.subject} class="select select-bordered select-sm w-full">
              <option value={null}>Select Subject</option>
              {#each subjects as s (s.id)}
                <option value={s}>{s.name}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label text-xs font-bold" for="teacher">Teacher</label>
            <select id="teacher" bind:value={form.teacher} class="select select-bordered select-sm w-full">
              <option value={null}>Select Teacher</option>
              {#each teachers as t (t.id)}
                <option value={t}>{t.name}</option>
              {/each}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="form-control">
              <label class="label text-xs font-bold" for="room">Room</label>
              <select id="room" bind:value={form.room} class="select select-bordered select-sm w-full">
                {#each rooms as r (r.id)}
                  <option value={r}>{r.name}</option>
                {/each}
              </select>
            </div>
            <div class="form-control">
              <label class="label text-xs font-bold" for="timeslot">Timeslot</label>
              <select id="timeslot" bind:value={form.timeslot} class="select select-bordered select-sm w-full">
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
              {@const entry = selectedStudents.find((x) => x.id === s.id)}
              {@const isSelected = !!entry}

              <div class="mb-1 rounded-md {isSelected ? 'bg-base-300/60' : ''}">
                <label class="flex items-center gap-3 p-2 hover:bg-base-300 rounded-md cursor-pointer transition-all">
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

                {#if isSelected}
                  <div class="grid grid-cols-2 gap-1 px-2 pb-2">
                    <div class="form-control">
                      <label class="label py-0 text-[10px] opacity-60" for="stu-start-{s.id}">Start</label>
                      <input
                        id="stu-start-{s.id}"
                        type="date"
                        class="input input-bordered input-xs w-full"
                        value={entry.startDate}
                        onchange={(e) => updateStudentDate(s.id, 'startDate', e.target.value)}
                      />
                    </div>
                    <div class="form-control">
                      <label class="label py-0 text-[10px] opacity-60" for="stu-end-{s.id}">End</label>
                      <input
                        id="stu-end-{s.id}"
                        type="date"
                        class="input input-bordered input-xs w-full"
                        value={entry.endDate}
                        onchange={(e) => updateStudentDate(s.id, 'endDate', e.target.value)}
                      />
                    </div>
                  </div>
                {/if}
              </div>
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
          <span class="text-sm font-medium">Delete all records for this schedule? This cannot be undone.</span>
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
