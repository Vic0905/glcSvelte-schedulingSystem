<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { onrefresh } = $props()

  // Modal State
  let show = $state(false)
  let loading = $state(false)
  let showDeleteConfirm = $state(false)

  // Dropdown Data
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  let searchQuery = $state('')
  let filteredStudents = $derived(
    students.filter((s) => s.englishName?.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // Form State
  // selectedStudents is now: { id, startDate, endDate }[]
  let selectedStudents = $state([])
  let originalState = $state({ timeslotId: null, roomId: null, startDate: null })

  let form = $state({
    id: null,
    mode: 'create',
    room: null,
    timeslot: null,
    subject: null,
    teacher: null,
    startDate: null,
    endDate: null,
  })

  // Derived Values
  let maxCapacity = $derived(form.room?.maxStudents || 0)
  let currentCount = $derived(selectedStudents.length)
  let isOverCapacity = $derived(maxCapacity > 0 && currentCount > maxCapacity)

  /**
   * Loads all necessary dropdown data once
   */
  async function loadData() {
    try {
      const [subj, stu, teach, room, ts] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name' }),
        pb.collection('student').getFullList({ sort: 'englishName' }),
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
      console.error(e)
      toast.error('Failed to load dropdown options')
    }
  }

  export async function open(data) {
    if (subjects.length === 0) await loadData()

    const existing = data.schedule || data.schedules?.[0]

    form = {
      mode: data.mode,
      id: existing?.id || null,
      room: rooms.find((r) => r.id === (existing?.roomId || data.room?.id)),
      timeslot: timeslots.find((t) => t.id === (existing?.timeslotId || data.timeslot?.id)),
      subject: subjects.find((s) => s.id === (existing?.subject?.id || data.room?.expand?.subject?.id)) || null,
      teacher: teachers.find((t) => t.id === (existing?.teacher?.id || data.teacher?.id)) || null,
      startDate: data.startDate,
      endDate: data.endDate,
    }

    // Store original state to find records to replace during Edit
    originalState = {
      timeslotId: form.timeslot?.id,
      roomId: form.room?.id,
      startDate: data.startDate,
    }

    if (data.mode === 'edit' && data.schedules) {
      // Preserve each student's own start/end dates from existing records
      selectedStudents = data.schedules.flatMap((s) => {
        const getId = (stu) => (typeof stu === 'object' ? stu.id : stu)
        const startDate = s.start?.split(' ')[0] || data.startDate
        const endDate = s.end?.split(' ')[0] || data.endDate

        if (Array.isArray(s.students)) {
          return s.students.map((stu) => ({ id: getId(stu), startDate, endDate }))
        }
        const id = s.student?.id ?? s.student ?? s.studentId
        return id ? [{ id, startDate, endDate }] : []
      })
    } else {
      selectedStudents = []
    }

    showDeleteConfirm = false
    show = true
  }

  function close() {
    show = false
    selectedStudents = []
    searchQuery = ''
    loading = false
    showDeleteConfirm = false
  }

  function toggleStudent(id) {
    if (selectedStudents.find((s) => s.id === id)) {
      selectedStudents = selectedStudents.filter((s) => s.id !== id)
    } else {
      if (maxCapacity > 0 && currentCount >= maxCapacity) {
        return toast.error(`Room capacity reached (${maxCapacity})`)
      }
      // Default to the group's global dates when first checked
      selectedStudents = [...selectedStudents, { id, startDate: form.startDate, endDate: form.endDate }]
    }
  }

  function updateStudentDate(id, field, value) {
    selectedStudents = selectedStudents.map((s) => (s.id === id ? { ...s, [field]: value } : s))
  }

  async function checkConflicts() {
    // Check conflicts per-student using their individual date ranges
    for (const stu of selectedStudents) {
      const startStr = `${stu.startDate} 00:00:00.000Z`
      const endStr = `${stu.endDate} 00:00:00.000Z`

      const filter = `timeslot = "${form.timeslot.id}" && start <= "${endStr}" && end >= "${startStr}"`

      const existingSchedules = await pb.collection('schedule').getFullList({
        filter,
        expand: 'room,teacher',
      })

      // Filter out the records we are currently editing
      const others =
        form.mode === 'edit'
          ? existingSchedules.filter(
              (s) =>
                s.room !== originalState.roomId ||
                s.timeslot !== originalState.timeslotId ||
                s.start.split(' ')[0] !== originalState.startDate
            )
          : existingSchedules

      // 1. Teacher Conflict
      const tConflict = others.find((s) => s.teacher === form.teacher.id)
      if (tConflict)
        throw new Error(`Teacher ${form.teacher.name} is busy in ${tConflict.expand?.room?.name || 'another room'}.`)

      // 2. Room Conflict (different teacher in same room/time)
      const rConflict = others.find((s) => s.room === form.room.id && s.teacher !== form.teacher.id)
      if (rConflict)
        throw new Error(
          `Room ${form.room.name} is occupied by ${rConflict.expand?.teacher?.name || 'another teacher'}.`
        )

      // 3. Student Conflict (only check this specific student)
      const sConflict = others.find((s) => {
        const studentId = typeof s.student === 'object' ? s.student.id : s.student
        return studentId === stu.id
      })
      if (sConflict) {
        const name = students.find((std) => std.id === stu.id)?.englishName || 'Student'
        throw new Error(`${name} already has a class in ${sConflict.expand?.room?.name}.`)
      }
    }
  }

  async function deleteSchedule() {
    loading = true
    try {
      const existing = await pb.collection('schedule').getFullList({
        filter: `timeslot = "${originalState.timeslotId}" && room = "${originalState.roomId}" && start = "${originalState.startDate} 00:00:00.000Z"`,
        fields: 'id',
      })

      if (existing.length === 0) {
        toast.error('No matching schedule records found')
        return
      }

      const batch = pb.createBatch()
      existing.forEach((rec) => batch.collection('schedule').delete(rec.id))
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

  async function save() {
    if (!form.subject || !form.teacher || !form.room || !form.timeslot) {
      return toast.error('Please fill all required fields')
    }
    if (selectedStudents.length === 0) return toast.error('Select at least one student')

    // Validate each student has their own dates filled
    const missingDates = selectedStudents.find((s) => !s.startDate || !s.endDate)
    if (missingDates) {
      const name = students.find((std) => std.id === missingDates.id)?.englishName || 'A student'
      return toast.error(`${name} is missing a start or end date`)
    }

    // Validate each student's end date is not before start date
    const invalidRange = selectedStudents.find((s) => s.endDate < s.startDate)
    if (invalidRange) {
      const name = students.find((std) => std.id === invalidRange.id)?.englishName || 'A student'
      return toast.error(`${name}'s end date is before their start date`)
    }

    loading = true
    try {
      await checkConflicts()

      // Use a Batch to group all deletes and creates into ONE network request
      const batch = pb.createBatch()

      if (form.mode === 'edit') {
        const existing = await pb.collection('schedule').getFullList({
          filter: `timeslot = "${originalState.timeslotId}" && room = "${originalState.roomId}" && start = "${originalState.startDate} 00:00:00.000Z"`,
          fields: 'id',
        })
        existing.forEach((rec) => batch.collection('schedule').delete(rec.id))
      }

      // Each student uses their own startDate/endDate
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
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-3xl border border-base-300 shadow-2xl">
      <header class="mb-6 text-center">
        <h3 class="text-xl font-bold">
          {form.mode === 'edit' ? 'Edit' : 'Create'}
          {maxCapacity > 1 ? 'Group' : 'MTM'} Schedule
        </h3>
        <p class="text-xs opacity-60 uppercase tracking-widest">{form.startDate} — {form.endDate}</p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Left Column: Schedule Fields -->
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-2">
            <div class="form-control">
              <label class="label text-xs font-bold" for="start">Default Start</label>
              <input id="start" type="date" bind:value={form.startDate} class="input input-bordered input-sm w-full" />
            </div>
            <div class="form-control">
              <label class="label text-xs font-bold" for="end">Default End</label>
              <input id="end" type="date" bind:value={form.endDate} class="input input-bordered input-sm w-full" />
            </div>
          </div>

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

        <!-- Right Column: Students with per-student dates -->
        <div class="flex flex-col">
          <div class="flex justify-between items-center mb-2">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-xs font-bold uppercase">Students</label>
            <span class="badge {isOverCapacity ? 'badge-error' : 'badge-ghost'} badge-sm transition-colors">
              {currentCount} / {maxCapacity || '∞'}
            </span>
          </div>

          <div class="mb-3">
            <input
              type="text"
              placeholder="Search students..."
              bind:value={searchQuery}
              class="input input-bordered input-sm w-full"
            />
          </div>

          <div class="border rounded-lg overflow-y-auto bg-base-200/50 p-2 h-72">
            {#each filteredStudents as s (s.id)}
              {@const entry = selectedStudents.find((x) => x.id === s.id)}
              {@const isSelected = !!entry}
              <div class="mb-1 rounded-md {isSelected ? 'bg-base-300/60' : ''}">
                <!-- Student row -->
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

                <!-- Per-student date pickers, only visible when checked -->
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

      <!-- Delete confirmation inline prompt -->
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

      <div class="modal-action mt-8">
        <!-- Delete button only visible in edit mode -->
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
