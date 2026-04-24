<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { onrefresh } = $props()

  // Modal State
  let show = $state(false)
  let loading = $state(false)

  // Dropdown Data
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // Form State
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
      selectedStudents = data.schedules.map((s) => s.student || s.studentId)
    } else {
      selectedStudents = []
    }

    show = true
  }

  function close() {
    show = false
    selectedStudents = []
    loading = false
  }

  function toggleStudent(id) {
    if (selectedStudents.includes(id)) {
      selectedStudents = selectedStudents.filter((s) => s !== id)
    } else {
      if (maxCapacity > 0 && currentCount >= maxCapacity) {
        return toast.error(`Room capacity reached (${maxCapacity})`)
      }
      selectedStudents = [...selectedStudents, id]
    }
  }

  async function checkConflicts() {
    const startStr = `${form.startDate} 00:00:00.000Z`
    const endStr = `${form.endDate} 00:00:00.000Z`

    // Efficient filter: find overlaps within the same timeslot
    const filter = `timeslot = "${form.timeslot.id}" && start <= "${endStr}" && end >= "${startStr}"`

    const existingSchedules = await pb.collection('schedule').getFullList({
      filter: filter,
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
      throw new Error(`Room ${form.room.name} is occupied by ${rConflict.expand?.teacher?.name || 'another teacher'}.`)

    // 3. Student Conflict
    for (const id of selectedStudents) {
      const sConflict = others.find((s) => s.student === id)
      if (sConflict) {
        const name = students.find((std) => std.id === id)?.englishName || 'Student'
        throw new Error(`${name} already has a class in ${sConflict.expand?.room?.name}.`)
      }
    }
  }

  async function save() {
    if (!form.subject || !form.teacher || !form.room || !form.timeslot || !form.startDate || !form.endDate) {
      return toast.error('Please fill all required fields')
    }
    if (selectedStudents.length === 0) return toast.error('Select at least one student')

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

      selectedStudents.forEach((studentId) => {
        batch.collection('schedule').create({
          timeslot: form.timeslot.id,
          teacher: form.teacher.id,
          subject: form.subject.id,
          room: form.room.id,
          student: studentId,
          start: `${form.startDate} 00:00:00.000Z`,
          end: `${form.endDate} 00:00:00.000Z`,
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
          {selectedStudents.length > 1 ? 'Group' : 'MTM'} Schedule
        </h3>
        <p class="text-xs opacity-60 uppercase tracking-widest">{form.startDate} — {form.endDate}</p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-2">
            <div class="form-control">
              <label class="label text-xs font-bold" for="start">Start Date</label>
              <input id="start" type="date" bind:value={form.startDate} class="input input-bordered input-sm w-full" />
            </div>
            <div class="form-control">
              <label class="label text-xs font-bold" for="end">End Date</label>
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

        <div class="flex flex-col">
          <div class="flex justify-between items-center mb-2">
            <label class="text-xs font-bold uppercase">Students</label>
            <span class="badge {isOverCapacity ? 'badge-error' : 'badge-ghost'} badge-sm transition-colors">
              {currentCount} / {maxCapacity || '∞'}
            </span>
          </div>

          <div class="border rounded-lg h-64 overflow-y-auto bg-base-200/50 p-2">
            {#each students as s (s.id)}
              {@const isSelected = selectedStudents.includes(s.id)}
              <label
                class="flex items-center gap-3 p-2 hover:bg-base-300 rounded-md cursor-pointer transition-all mb-1"
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
            {/each}
          </div>
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" onclick={close} disabled={loading}>Cancel</button>
        <button class="btn btn-primary min-w-[140px]" onclick={save} disabled={loading || isOverCapacity}>
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
