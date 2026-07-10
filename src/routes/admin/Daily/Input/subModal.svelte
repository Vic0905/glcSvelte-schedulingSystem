<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  let { onrefresh } = $props()

  // ═══════════════════════════════════
  // STATE
  // ═══════════════════════════════════

  let show = $state(false)
  let loading = $state(false)

  // Pre-filled display (read-only)
  let displayTeacher = $state(null)
  let displaySubject = $state(null)
  let displayRoom = $state(null)
  let displayTimeslot = $state(null)
  let displayDate = $state(null)
  let displayStudents = $state([])
  let recordIds = $state([])

  // Sub-specific state
  let subEnabled = $state(false)
  let selectedSub = $state(null)
  let existingSub = $state(null) // populated when the cell already has a sub

  // Availability: teacher IDs already teaching (as teacher OR sub)
  // during this exact date + timeslot, excluding the record(s) being edited.
  let busyTeacherIds = $state(new Set())

  // Read-only context: which sub(s) covered this same timeslot yesterday
  let yesterdaySubs = $state([]) // string[] of sub teacher names
  let yesterdayLoading = $state(false)

  // Dropdown data
  let teachers = $state([])
  let subClassSchedule = $state(null) // the "Sub Class" customSchedule record

  const BREAK_SCHEDULES = ['lunch break', 'break time', 'other task']

  let hasBreakConflict = $state(false)

  function offsetDate(dateStr, days) {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  // ═══════════════════════════════════
  // DERIVED
  // ═══════════════════════════════════

  // Exclude the current teacher and anyone already booked this timeslot
  let availableTeachers = $derived(teachers.filter((t) => t.id !== displayTeacher?.id && !busyTeacherIds.has(t.id)))
  let unavailableCount = $derived(
    teachers.filter((t) => t.id !== displayTeacher?.id && busyTeacherIds.has(t.id)).length
  )

  // ═══════════════════════════════════
  // DATA LOADING
  // ═══════════════════════════════════

  async function loadData() {
    try {
      const [teacherList, customSchedules] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name', filter: 'status != "disabled"' }),
        pb.collection('customSchedule').getFullList({ sort: 'name' }),
      ])
      teachers = teacherList
      subClassSchedule = customSchedules.find((cs) => cs.name.toLowerCase().trim() === 'sub class') || null
    } catch {
      toast.error('Failed to load teacher data')
    }
  }

  async function checkBreakConflict() {
    hasBreakConflict = false
    if (!recordIds.length) return

    try {
      const records = await pb.collection('dailySchedule').getFullList({
        filter: recordIds.map((id) => `id = "${id}"`).join(' || '),
        expand: 'customSchedule',
      })

      hasBreakConflict = records.some((r) =>
        (r.expand?.customSchedule || []).some((cs) => BREAK_SCHEDULES.includes(cs.name?.toLowerCase().trim()))
      )
    } catch {
      toast.error('Failed to verify existing schedule tags')
    }
  }

  // Fetch everyone already teaching (as teacher or sub) at this exact
  // date + timeslot, so they can't be double-booked as a substitute.
  async function loadBusyTeachers() {
    busyTeacherIds = new Set()
    if (!displayTimeslot?.id || !displayDate) return

    try {
      const records = await pb.collection('dailySchedule').getFullList({
        filter: `date >= "${displayDate} 00:00:00" && date <= "${displayDate} 23:59:59" && timeslot = "${displayTimeslot.id}"`,
        fields: 'id,teacher,sub',
      })

      const busy = new Set()
      for (const r of records) {
        if (recordIds.includes(r.id)) continue // skip the record(s) currently being edited
        if (r.teacher) busy.add(r.teacher)
        if (r.sub) busy.add(r.sub)
      }
      busyTeacherIds = busy
    } catch {
      toast.error('Failed to check teacher availability')
    }
  }

  // Read-only lookup: which substitute(s), if any, covered these same
  // students' timeslot the day before — quick "was there a sub yesterday"
  // check with no other detail.
  async function loadYesterdayContext() {
    yesterdaySubs = []
    if (!displayTimeslot?.id || !displayDate || !displayStudents.length) return

    yesterdayLoading = true
    try {
      const yesterday = offsetDate(displayDate, -1)
      const studentIds = displayStudents.map((s) => s.id).filter(Boolean)
      const studentFilter = studentIds.map((id) => `student = "${id}"`).join(' || ')

      const records = await pb.collection('dailySchedule').getFullList({
        filter: `date >= "${yesterday} 00:00:00" && date <= "${yesterday} 23:59:59" && timeslot = "${displayTimeslot.id}" && (${studentFilter})`,
        expand: 'sub',
      })

      yesterdaySubs = [...new Set(records.map((r) => r.expand?.sub?.name).filter(Boolean))]
    } catch {
      toast.error("Failed to load yesterday's class info")
    } finally {
      yesterdayLoading = false
    }
  }

  // ═══════════════════════════════════
  // MODAL LIFECYCLE
  // ═══════════════════════════════════

  export async function open(data) {
    show = true
    loading = true

    if (!teachers.length) await loadData()

    const first = data.schedules?.[0]

    displayTeacher = first?.teacher || null
    displaySubject = first?.subject || null
    displayRoom = data.room || null
    displayTimeslot = data.timeslot || null
    displayDate = data.date || null
    displayStudents = data.schedules?.flatMap((s) => s.students) || []
    recordIds = data.schedules?.map((s) => s.id).filter(Boolean) || []

    // Seed sub state from existing data
    existingSub = first?.sub || null
    subEnabled = !!existingSub
    selectedSub = existingSub ? teachers.find((t) => t.id === existingSub.id) || null : null

    await Promise.all([loadBusyTeachers(), loadYesterdayContext(), checkBreakConflict()])
    loading = false
  }

  function close() {
    show = false
    loading = false
    subEnabled = false
    selectedSub = null
    existingSub = null
    recordIds = []
    displayStudents = []
    busyTeacherIds = new Set()
    yesterdaySubs = []
    hasBreakConflict = false
  }

  // ═══════════════════════════════════
  // SAVE
  // ═══════════════════════════════════

  async function save() {
    if (subEnabled && !selectedSub) return toast.error('Please select a substitute teacher')
    if (subEnabled && hasBreakConflict) return toast.error('Cannot assign a sub to a break/lunch schedule')
    if (!recordIds.length) return toast.error('No schedule records found to update')

    loading = true
    try {
      // Get the current customSchedule arrays fresh, so we don't clobber
      // tags that were set outside this modal's knowledge.
      const freshRecords = await pb.collection('dailySchedule').getFullList({
        filter: recordIds.map((id) => `id = "${id}"`).join(' || '),
        fields: 'id,customSchedule',
      })
      const currentMap = new Map(freshRecords.map((r) => [r.id, r.customSchedule || []]))

      const batch = pb.createBatch()

      for (const id of recordIds) {
        const current = currentMap.get(id) || []
        let updatedCustomSchedule

        if (subEnabled && subClassSchedule) {
          // add Sub Class tag, keep existing tags, avoid duplicates
          updatedCustomSchedule = current.includes(subClassSchedule.id) ? current : [...current, subClassSchedule.id]
        } else {
          // remove only the Sub Class tag, keep everything else
          updatedCustomSchedule = current.filter((csId) => csId !== subClassSchedule?.id)
        }

        batch.collection('dailySchedule').update(id, {
          sub: subEnabled ? selectedSub.id : null,
          customSchedule: updatedCustomSchedule,
        })
      }

      await batch.send()

      // ─── ACTIVITY LOG ───
      // 'sub' = brand-new assignment, 'sub_edit' = changing/reassigning an
      // existing sub, 'sub_remove' = clearing one off the schedule.
      const logAction = existingSub && !subEnabled ? 'sub_remove' : existingSub && subEnabled ? 'sub_edit' : 'sub'

      try {
        await pb.collection('activityLog').create({
          action: logAction,
          performedBy: pb.authStore.record?.id,
          details: {
            date: displayDate,
            timeslot: displayTimeslot ? `${displayTimeslot.start} - ${displayTimeslot.end}` : null,
            roomName: displayRoom?.name,
            teacherName: displayTeacher?.name,
            subName: subEnabled ? selectedSub?.name : null,
          },
        })
      } catch (logErr) {
        console.error('Activity log failed:', logErr)
      }
      // ─── END ACTIVITY LOG ───

      toast.success(subEnabled ? `Sub assigned: ${selectedSub.name}` : 'Sub teacher removed')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'Failed to save')
    } finally {
      loading = false
    }
  }
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-lg border border-base-300 shadow-2xl">
      <!-- Header -->
      <header class="mb-6 text-center">
        <h3 class="text-xl font-bold">Sub Class Assignment</h3>
        <p class="text-xs uppercase tracking-widest">{displayDate}</p>
      </header>

      <!-- Read-only schedule info card -->
      <div class="bg-base-200 rounded-xl p-4 mb-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-3">Existing Schedule</p>

        <div class="grid grid-cols-2 gap-3 text-sm mb-3">
          <div>
            <p class="text-[10px] opacity-80 uppercase mb-0.5">Teacher</p>
            <p class="font-bold">{displayTeacher?.name || '—'}</p>
          </div>
          <div>
            <p class="text-[10px] opacity-80 uppercase mb-0.5">Subject</p>
            <p class="font-bold">{displaySubject?.name || '—'}</p>
          </div>
          <div>
            <p class="text-[10px] opacity-80 uppercase mb-0.5">Room</p>
            <p class="font-bold">{displayRoom?.name || '—'}</p>
          </div>
          <div>
            <p class="text-[10px] opacity-80 uppercase mb-0.5">Timeslot</p>
            <p class="font-bold text-sm">
              {displayTimeslot ? `${displayTimeslot.start} – ${displayTimeslot.end}` : '—'}
            </p>
          </div>
        </div>

        <div>
          <p class="text-[10px] opacity-80 uppercase mb-1">Students ({displayStudents.length})</p>
          <div class="flex flex-wrap gap-1">
            {#each displayStudents as s}
              <span class="font-bold text-sm">{s.name}</span>
            {:else}
              <span class="text-xs opacity-40">No students</span>
            {/each}
          </div>
        </div>
      </div>

      <!-- Read-only: sub teacher(s) who covered this same timeslot yesterday -->
      {#if yesterdayLoading}
        <div class="flex items-center gap-2 text-xs opacity-50 mb-4">
          <span class="loading loading-spinner loading-xs"></span>
          Checking yesterday's sub…
        </div>
      {:else if yesterdaySubs.length > 0}
        <div class="bg-base-200 rounded-xl p-4 mb-5">
          <p class="text-[10px] font-bold uppercase opacity-40 tracking-widest mb-2">Yesterday's Sub</p>
          <div class="flex flex-wrap gap-1">
            {#each yesterdaySubs as name}
              <span class="text text-sm font-bold">{name}</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Sub Toggle -->
      <div class="flex items-center justify-between p-4 bg-base-200 rounded-xl mb-4">
        <div>
          <p class="font-bold text-sm">Enable Sub Teacher</p>
          <p class="text-xs opacity-80">
            Auto-tags schedule as <strong>Sub Class</strong>
          </p>
        </div>
        <input
          type="checkbox"
          class="toggle toggle-lg"
          bind:checked={subEnabled}
          onchange={() => {
            if (!subEnabled) selectedSub = null
          }}
          disabled={loading || hasBreakConflict}
        />
      </div>
      {#if hasBreakConflict}
        <div class="alert alert-error alert-soft text-xs py-2 mb-2">
          <span>⚠️ This schedule is a break/lunch/other slot and can't have a sub assigned.</span>
        </div>
      {/if}

      <!-- Sub Teacher Select (visible when toggle is ON) -->
      {#if subEnabled}
        <div class="form-control mb-4">
          <label class="label text-xs font-bold" for="sub-select">Substitute Teacher</label>
          <select
            id="sub-select"
            bind:value={selectedSub}
            class="select select-bordered select-sm w-full"
            disabled={loading}
          >
            <option value={null}>— Select Substitute —</option>
            {#each availableTeachers as t (t.id)}
              <option value={t}>{t.name}</option>
            {/each}
          </select>
          {#if !loading}
            <p class="text-xs opacity-80 mt-1">
              Showing teachers free during {displayTimeslot
                ? `${displayTimeslot.start} – ${displayTimeslot.end}`
                : 'this timeslot'}{unavailableCount > 0 ? ` (${unavailableCount} already booked, hidden)` : ''}.
            </p>
          {/if}
        </div>

        {#if subClassSchedule}
          <div class="alert alert-soft text-xs py-2 mb-2">
            <span>
              ✓ Will auto-tag as <strong>{subClassSchedule.name}</strong> custom schedule.
            </span>
          </div>
        {:else}
          <div class="alert alert-error alert-soft text-xs py-2 mb-2">
            <span>
              ⚠️ No <strong>"Sub Class"</strong> custom schedule found. Please create one in Custom Schedules first.
            </span>
          </div>
        {/if}
      {:else if existingSub}
        <!-- Warning when toggling OFF an existing sub -->
        <div class="alert alert-info alert-soft text-xs py-2 mb-2">
          <span>
            Saving will remove <strong>{existingSub.name}</strong> as substitute and clear the Sub Class tag.
          </span>
        </div>
      {/if}

      <!-- Actions -->
      <div class="modal-action mt-4">
        <button class="btn btn-ghost btn-soft" onclick={close} disabled={loading}>Cancel</button>
        <button
          class="btn btn-info btn-soft min-w-[130px]"
          onclick={save}
          disabled={loading || (subEnabled && (!selectedSub || !subClassSchedule))}
        >
          {#if loading}
            <span class="loading loading-spinner"></span>
          {:else if !subEnabled && existingSub}
            Remove Sub
          {:else}
            Save Sub
          {/if}
        </button>
      </div>
    </div>

    <div class="modal-backdrop bg-black/40" role="presentation" onclick={close}></div>
  </dialog>
{/if}
