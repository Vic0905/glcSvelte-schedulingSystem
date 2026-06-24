<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  let { sourceDate, onrefresh, roomType = null } = $props()

  let isOpen = $state(false)
  let isSaving = $state(false)
  let targetStart = $state('')
  let targetEnd = $state('')
  let summary = $state(null) // { created, skipped, graduated }
  let preview = $state(null) // { graduatedStudents, sourceSchedules }

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

  /** All dates (YYYY-MM-DD) in [start, end], inclusive. */
  function dateRange(start, end) {
    const dates = []
    const cur = new Date(start)
    const last = new Date(end)
    while (cur <= last) {
      dates.push(cur.toISOString().split('T')[0])
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }

  async function previewCopy() {
    if (!targetStart || !targetEnd) return toast.error('Please select a target date range')
    if (targetEnd < targetStart) return toast.error('End date must be on or after start date')
    if (targetStart <= sourceDate && sourceDate <= targetEnd)
      return toast.error('Target range cannot overlap the source date')

    isSaving = true
    preview = null

    try {
      // Fetch all dailySchedule records on the source date
      const sourceSchedules = await pb.collection('dailySchedule').getFullList({
        filter: [
          `date >= "${sourceDate} 00:00:00" && date <= "${sourceDate} 23:59:59"`,
          roomType ? `room.roomType = "${roomType}"` : null,
        ]
          .filter(Boolean)
          .join(' && '),
        expand: 'teacher,subject,room,timeslot,student',
      })

      if (!sourceSchedules.length) {
        toast.warning('No schedules found on the source date')
        isSaving = false
        return
      }

      // Collect unique student IDs and check for graduates
      const studentIds = [...new Set(sourceSchedules.map((s) => s.expand?.student?.id || s.student).filter(Boolean))]

      const graduatedStudents = []
      if (studentIds.length) {
        const studentRecords = await pb.collection('student').getFullList({
          fields: 'id,englishName,end',
        })
        const studentMap = new Map(studentRecords.map((s) => [s.id, s]))
        for (const id of studentIds) {
          const student = studentMap.get(id)
          if (!student) continue
          const studentEnd = student.end?.split(' ')[0]
          if (studentEnd && studentEnd < targetStart) {
            graduatedStudents.push({ id, name: student.englishName, end: studentEnd })
          }
        }
      }

      preview = { graduatedStudents, sourceSchedules }
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
    const dates = dateRange(targetStart, targetEnd)

    try {
      // Fetch all existing dailySchedule records in the target range in one go
      const existingRecords = await pb.collection('dailySchedule').getFullList({
        filter: `date >= "${targetStart} 00:00:00" && date <= "${targetEnd} 23:59:59"`,
        fields: 'date,room,timeslot',
      })

      // Conflict key: date + room + timeslot (one record per slot per day)
      const existingSet = new Set(existingRecords.map((r) => `${r.date?.split(' ')[0]}|${r.room}|${r.timeslot}`))

      let created = 0
      let skipped = 0
      let graduated = 0

      // Collect all records to create first, then send in chunks
      const toCreate = []

      for (const date of dates) {
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

          if (studentId && graduatedIds.has(studentId)) {
            graduated++
            continue
          }

          const key = `${date}|${roomId}|${timeslotId}`
          if (existingSet.has(key)) {
            skipped++
            continue
          }

          existingSet.add(key) // prevent duplicates within this batch
          toCreate.push({
            date: `${date} 00:00:00`,
            teacher: teacherId,
            subject: subjectId,
            room: roomId,
            timeslot: timeslotId,
            student: studentId,
            status: 'draft',
          })
          created++
        }
      }

      // Send in chunks of 50 to stay within PocketBase batch limits
      const CHUNK_SIZE = 50
      for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
        const chunk = toCreate.slice(i, i + CHUNK_SIZE)
        const b = pb.createBatch()
        for (const data of chunk) {
          b.collection('dailySchedule').create(data)
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
          to every day in the selected range.
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
          Copying <span class="font-semibold text-base-content">{preview.sourceSchedules.length}</span> schedule{preview
            .sourceSchedules.length === 1
            ? ''
            : 's'}
          from <span class="font-semibold text-base-content">{sourceDate}</span>
          into every day from <span class="font-semibold text-base-content">{targetStart}</span>
          to <span class="font-semibold text-base-content">{targetEnd}</span>.
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
