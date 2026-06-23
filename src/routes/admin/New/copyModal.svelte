<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { sourceDate, onrefresh } = $props()

  let isOpen = $state(false)
  let isSaving = $state(false)
  let targetStart = $state('')
  let targetEnd = $state('')
  let summary = $state(null) // { created, skipped, graduated }
  let preview = $state(null) // { graduatedStudents: [...] } — shown before confirm

  export function open() {
    targetStart = ''
    targetEnd = ''
    summary = null
    preview = null
    isOpen = true
  }

  export function close() {
    isOpen = false
    preview = null
  }

  function toDbDate(dateStr) {
    return `${dateStr} 00:00:00.000Z`
  }

  function makeKey(teacherId, subjectId, roomId, timeslotId, studentId) {
    return `${teacherId}|${subjectId}|${roomId}|${timeslotId}|${studentId ?? ''}`
  }

  async function previewCopy() {
    if (!targetStart || !targetEnd) return toast.error('Please select a target date range')
    if (targetEnd < targetStart) return toast.error('End date must be on or after start date')
    if (targetStart <= sourceDate && sourceDate <= targetEnd)
      return toast.error('Target range cannot overlap the source date')

    isSaving = true
    preview = null

    try {
      const sourceDateStr = toDbDate(sourceDate)

      const sourceSchedules = await pb.collection('schedule').getFullList({
        filter: `start <= "${sourceDateStr}" && end >= "${sourceDateStr}"`,
        expand: 'teacher,subject,room,timeslot,student',
      })

      if (!sourceSchedules.length) {
        toast.warning('No schedules found on the source date')
        isSaving = false
        return
      }

      // Collect unique student IDs that have a student relation
      const studentIds = [...new Set(sourceSchedules.map((s) => s.expand?.student?.id || s.student).filter(Boolean))]

      // Fetch student records to check end dates
      let studentMap = new Map()
      if (studentIds.length) {
        const studentRecords = await pb.collection('student').getFullList({
          fields: 'id,englishName,end',
        })
        for (const s of studentRecords) studentMap.set(s.id, s)
      }

      // Identify graduated students (end < targetStart)
      const graduatedStudents = []
      for (const id of studentIds) {
        const student = studentMap.get(id)
        if (!student) continue
        const studentEnd = student.end?.split(' ')[0]
        if (studentEnd && studentEnd < targetStart) {
          graduatedStudents.push({ id, name: student.englishName, end: studentEnd })
        }
      }

      preview = { graduatedStudents, sourceSchedules, studentMap }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load preview')
    } finally {
      isSaving = false
    }
  }

  async function save() {
    if (!preview) return

    isSaving = true
    summary = null

    const { sourceSchedules } = preview
    const graduatedIds = new Set(preview.graduatedStudents.map((s) => s.id))

    try {
      // ── Fetch existing records in the target range WITHOUT teacher/timeslot filters ──
      const existingRecords = await pb.collection('schedule').getFullList({
        filter: `start <= "${toDbDate(targetEnd)}" && end >= "${toDbDate(targetStart)}"`,
      })

      // Build sets of teacher/timeslot IDs from source to narrow in-memory
      const teacherIds = new Set(sourceSchedules.map((s) => s.expand?.teacher?.id || s.teacher).filter(Boolean))
      const timeslotIds = new Set(sourceSchedules.map((s) => s.expand?.timeslot?.id || s.timeslot).filter(Boolean))

      const existingMap = new Map()
      for (const r of existingRecords) {
        if (!teacherIds.has(r.teacher) || !timeslotIds.has(r.timeslot)) continue
        const key = makeKey(r.teacher, r.subject, r.room, r.timeslot, r.student || null)
        existingMap.set(key, r)
      }

      let created = 0
      let skipped = 0
      let graduated = 0

      const batchOps = []

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

        // Skip graduated students
        if (studentId && graduatedIds.has(studentId)) {
          graduated++
          continue
        }

        const key = makeKey(teacherId, subjectId, roomId, timeslotId, studentId)

        if (existingMap.has(key)) {
          // A schedule already covers this teacher/subject/room/timeslot/student combo
          // in the target range — never mutate an existing record's status/date span.
          skipped++
        } else {
          batchOps.push({
            type: 'create',
            data: {
              teacher: teacherId,
              subject: subjectId,
              room: roomId,
              timeslot: timeslotId,
              student: studentId,
              start: toDbDate(targetStart),
              end: toDbDate(targetEnd),
              status: 'draft',
            },
          })
          created++
        }
      }

      // Send in chunks of 50
      for (let i = 0; i < batchOps.length; i += 50) {
        const chunk = batchOps.slice(i, i + 50)
        const b = pb.createBatch()
        for (const op of chunk) {
          b.collection('schedule').create(op.data)
        }
        await b.send()
      }

      summary = { created, skipped, graduated }
      preview = null
      toast.success(`Done — ${created} created, ${skipped} skipped, ${graduated} graduated skipped`)
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

      {#if !preview}
        <!-- ── Step 1: date inputs ── -->
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

        <div class="flex gap-2 justify-end">
          <button class="btn btn-ghost btn-sm" onclick={close} disabled={isSaving}>Cancel</button>
          <button
            class="btn btn-primary btn-sm"
            onclick={previewCopy}
            disabled={isSaving || !targetStart || !targetEnd}
          >
            {#if isSaving}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
            Preview
          </button>
        </div>
      {:else}
        <!-- ── Step 2: preview ── -->
        <div class="text-sm text-base-content/60">
          Copying schedules from
          <span class="font-semibold text-base-content">{sourceDate}</span>
          → <span class="font-semibold text-base-content">{targetStart}</span>
          to <span class="font-semibold text-base-content">{targetEnd}</span>
        </div>

        {#if preview.graduatedStudents.length}
          <div class="flex flex-col gap-2">
            <div class="text-sm font-medium text-warning">
              {preview.graduatedStudents.length} graduated student{preview.graduatedStudents.length > 1 ? 's' : ''} will
              be skipped
            </div>
            <div class="rounded-lg bg-base-200 p-3 flex flex-col gap-1 max-h-48 overflow-y-auto">
              {#each preview.graduatedStudents as s}
                <div class="flex justify-between text-xs">
                  <span class="font-medium">{s.name}</span>
                  <span class="text-base-content/50">ended {s.end}</span>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="text-sm text-success">No graduated students detected — all schedules will be copied.</div>
        {/if}

        <div class="flex gap-2 justify-end">
          <button class="btn btn-ghost btn-sm" onclick={() => (preview = null)} disabled={isSaving}>Back</button>
          <button class="btn btn-primary btn-sm" onclick={save} disabled={isSaving}>
            {#if isSaving}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
            Confirm Copy
          </button>
        </div>
      {/if}

      {#if summary}
        <div class="rounded-lg bg-base-200 p-3 text-sm flex flex-col gap-1">
          <div class="flex justify-between">
            <span class="text-info font-medium">Created</span>
            <span class="font-bold">{summary.created}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-warning font-medium">Skipped</span>
            <span class="font-bold">{summary.skipped}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-error font-medium">Graduated (skipped)</span>
            <span class="font-bold">{summary.graduated}</span>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
