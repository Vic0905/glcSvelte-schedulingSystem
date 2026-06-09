<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { sourceDate, onrefresh } = $props()

  let isOpen = $state(false)
  let isSaving = $state(false)
  let targetStart = $state('')
  let targetEnd = $state('')
  let summary = $state(null) // { extended, created, skipped }

  export function open() {
    targetStart = ''
    targetEnd = ''
    summary = null
    isOpen = true
  }

  export function close() {
    isOpen = false
  }

  function dayBefore(dateStr) {
    const d = new Date(dateStr)
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  }

  function toDbDate(dateStr) {
    return `${dateStr} 00:00:00.000Z`
  }

  /** Stable key for matching records across queries */
  function makeKey(teacherId, subjectId, roomId, timeslotId, studentId) {
    return `${teacherId}|${subjectId}|${roomId}|${timeslotId}|${studentId ?? ''}`
  }

  async function save() {
    if (!targetStart || !targetEnd) return toast.error('Please select a target date range')
    if (targetEnd < targetStart) return toast.error('End date must be on or after start date')
    if (targetStart <= sourceDate && sourceDate <= targetEnd)
      return toast.error('Target range cannot overlap the source date')

    isSaving = true
    summary = null

    try {
      const sourceDateStr = toDbDate(sourceDate)
      const adjacentEndStr = toDbDate(dayBefore(targetStart))

      // ── 3 bulk fetches, no per-record queries ──────────────────────────────

      // 1. All schedules on the source date
      const sourceSchedules = await pb.collection('schedule').getFullList({
        filter: `start <= "${sourceDateStr}" && end >= "${sourceDateStr}"`,
        expand: 'teacher,subject,room,timeslot,student',
      })

      if (!sourceSchedules.length) {
        toast.warning('No schedules found on the source date')
        isSaving = false
        return
      }

      // Collect unique teacher/timeslot IDs from source records
      const teacherIds = [...new Set(sourceSchedules.map((s) => s.expand?.teacher?.id || s.teacher).filter(Boolean))]
      const timeslotIds = [...new Set(sourceSchedules.map((s) => s.expand?.timeslot?.id || s.timeslot).filter(Boolean))]

      // PocketBase does not support `field in (...)` — build OR chains instead
      const teacherFilter = teacherIds.map((id) => `teacher = "${id}"`).join(' || ')
      const timeslotFilter = timeslotIds.map((id) => `timeslot = "${id}"`).join(' || ')

      // 2. Fetch all records with adjacent end (candidates for extend)
      const adjacentRecords = await pb.collection('schedule').getFullList({
        filter: `end = "${adjacentEndStr}" && (${teacherFilter}) && (${timeslotFilter})`,
      })

      // 3. Fetch all records sharing teacher+timeslot (for skip detection)
      const existingRecords = await pb.collection('schedule').getFullList({
        filter: `start <= "${toDbDate(targetEnd)}" && end >= "${toDbDate(targetStart)}" && (${teacherFilter}) && (${timeslotFilter})`,
      })

      // ── Build lookup maps ──────────────────────────────────────────────────

      // key → adjacent record (extendable)
      const adjacentMap = new Map()
      for (const r of adjacentRecords) {
        const key = makeKey(r.teacher, r.subject, r.room, r.timeslot, r.student || null)
        adjacentMap.set(key, r)
      }

      // key → any existing record (for skip detection)
      const existingMap = new Map()
      for (const r of existingRecords) {
        const key = makeKey(r.teacher, r.subject, r.room, r.timeslot, r.student || null)
        existingMap.set(key, r)
      }

      // ── Build batch from in-memory lookups ────────────────────────────────

      let extended = 0
      let created = 0
      let skipped = 0

      const batch = pb.createBatch()

      for (const src of sourceSchedules) {
        const teacherId = src.expand?.teacher?.id || src.teacher
        const subjectId = src.expand?.subject?.id || src.subject
        const roomId = src.expand?.room?.id || src.room
        const timeslotId = src.expand?.timeslot?.id || src.timeslot
        const studentId = src.expand?.student?.id || src.student || null

        if (!teacherId || !subjectId || !roomId || !timeslotId) {
          skipped++
          continue
        }

        const key = makeKey(teacherId, subjectId, roomId, timeslotId, studentId)

        const adjacent = adjacentMap.get(key)
        if (adjacent) {
          batch.collection('schedule').update(adjacent.id, {
            end: toDbDate(targetEnd),
          })
          extended++
        } else if (existingMap.has(key)) {
          // Exists but not adjacent — skip
          skipped++
        } else {
          batch.collection('schedule').create({
            teacher: teacherId,
            subject: subjectId,
            room: roomId,
            timeslot: timeslotId,
            student: studentId,
            start: toDbDate(targetStart),
            end: toDbDate(targetEnd),
          })
          created++
        }
      }

      await batch.send()

      summary = { extended, created, skipped }
      toast.success(`Done — ${extended} extended, ${created} created, ${skipped} skipped`)
      onrefresh?.()
    } catch (err) {
      console.error(err)
      toast.error('Failed to copy schedules')
    } finally {
      isSaving = false
    }
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 z-40 bg-black/40"
    role="button"
    tabindex="-1"
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
  ></div>

  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="bg-base-100 rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Copy Schedule</h3>
        <button class="btn btn-ghost btn-sm btn-circle" onclick={close}>✕</button>
      </div>

      <div class="text-sm text-base-content/60">
        Copying all schedules from
        <span class="font-semibold text-base-content">{sourceDate}</span>
        to the selected range.
      </div>

      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Target Start</span>
          <input
            type="date"
            class="input input-bordered input-sm"
            bind:value={targetStart}
            min={sourceDate}
            disabled={isSaving}
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Target End</span>
          <input
            type="date"
            class="input input-bordered input-sm"
            bind:value={targetEnd}
            min={targetStart || sourceDate}
            disabled={isSaving}
          />
        </label>
      </div>

      {#if summary}
        <div class="rounded-lg bg-base-200 p-3 text-sm flex flex-col gap-1">
          <div class="flex justify-between">
            <span class="text-success font-medium">Extended</span>
            <span class="font-bold">{summary.extended}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-info font-medium">Created</span>
            <span class="font-bold">{summary.created}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-warning font-medium">Skipped</span>
            <span class="font-bold">{summary.skipped}</span>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 justify-end">
        <button class="btn btn-ghost btn-sm" onclick={close} disabled={isSaving}>Cancel</button>
        <button class="btn btn-primary btn-sm" onclick={save} disabled={isSaving || !targetStart || !targetEnd}>
          {#if isSaving}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Copy
        </button>
      </div>
    </div>
  </div>
{/if}
