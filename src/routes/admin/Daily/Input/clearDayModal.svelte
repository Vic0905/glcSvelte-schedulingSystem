<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  // ─────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────
  let { selectedDate, onrefresh, roomType = null } = $props()

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  let dialogEl
  let isDeleting = $state(false)
  let progress = $state(0)
  let preview = $state(null) // { records, count }
  let summary = $state(null) // { deleted, failed }

  const CHUNK_SIZE = 50
  const roomTypeLabel = roomType ? roomType.toUpperCase() : 'ALL'

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────
  export function open() {
    preview = null
    summary = null
    progress = 0
    isDeleting = false
    dialogEl?.showModal()
  }

  function close() {
    if (isDeleting) return
    dialogEl?.close()
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────
  function buildFilter() {
    const parts = [`date >= "${selectedDate} 00:00:00"`, `date <= "${selectedDate} 23:59:59"`]
    if (roomType) parts.push(`room.roomType = "${roomType}"`)
    return parts.join(' && ')
  }

  // ─────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────
  async function handlePreview() {
    isDeleting = true
    preview = null
    summary = null

    try {
      const records = await pb.collection('dailySchedule').getFullList({
        filter: buildFilter(),
        fields: 'id,date,room,timeslot',
      })

      if (!records.length) {
        toast.warning(`No ${roomTypeLabel} schedules found on ${selectedDate}`)
        isDeleting = false
        return
      }

      preview = { records, count: records.length }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedules — ' + (err.message || String(err)))
    } finally {
      isDeleting = false
    }
  }

  async function handleDelete() {
    if (!preview?.records?.length) return

    isDeleting = true
    progress = 0
    summary = null

    const records = preview.records
    let deleted = 0
    let failed = 0

    try {
      for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE)

        const b = pb.createBatch()
        for (const rec of chunk) {
          b.collection('dailySchedule').delete(rec.id)
        }

        try {
          await b.send()
          deleted += chunk.length
        } catch (batchErr) {
          // Batch failed — fall back to individual deletes for this chunk
          console.warn('Batch delete failed, falling back to individual:', batchErr)
          const settled = await Promise.allSettled(chunk.map((rec) => pb.collection('dailySchedule').delete(rec.id)))
          settled.forEach((res) => {
            if (res.status === 'fulfilled') deleted++
            else failed++
          })
        }

        progress = Math.round(((i + chunk.length) / records.length) * 100)
      }

      summary = { deleted, failed }
      preview = null

      if (deleted) {
        toast.success(`Cleared ${deleted} schedule${deleted === 1 ? '' : 's'} from ${selectedDate}`)
        onrefresh?.()
      }
      if (failed) {
        toast.error(`${failed} record${failed === 1 ? '' : 's'} could not be deleted`)
      }
    } catch (err) {
      console.error(err)
      toast.error('Delete failed — ' + (err.message || String(err)))
    } finally {
      isDeleting = false
    }
  }
</script>

<dialog bind:this={dialogEl} class="modal">
  <div class="modal-box max-w-md">
    <!-- Header -->
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2">
      <span class="text-error">⚠</span>
      Clear Day Schedule
    </h3>
    <p class="text-xs text-neutral-500 mb-4">
      Permanently deletes all
      <span class="font-semibold text-neutral-700">{roomTypeLabel}</span>
      schedules on
      <span class="font-semibold text-neutral-700">{selectedDate}</span>. This cannot be undone.
    </p>

    <!-- ── Step 1: Initial confirm ── -->
    {#if !preview && !summary && !isDeleting}
      <div class="alert alert-warning text-sm py-3 mb-4">
        <span>
          You are about to delete <strong>all {roomTypeLabel} schedules</strong> for
          <strong>{selectedDate}</strong>. Click "Check" to see how many records will be removed.
        </span>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" onclick={close}>Cancel</button>
        <button class="btn btn-warning btn-sm" onclick={handlePreview}> Check </button>
      </div>
    {/if}

    <!-- ── Loading / Progress ── -->
    {#if isDeleting}
      <div class="my-4">
        <p class="text-sm mb-2">
          {progress > 0 ? `Deleting schedules… ${progress}%` : 'Loading schedules…'}
        </p>
        {#if progress > 0}
          <progress class="progress progress-error w-full" value={progress} max="100"></progress>
        {:else}
          <progress class="progress progress-warning w-full"></progress>
        {/if}
      </div>
    {/if}

    <!-- ── Step 2: Preview ── -->
    {#if preview && !isDeleting}
      <div class="my-4 space-y-3">
        <div class="stats shadow w-full">
          <div class="stat py-3">
            <div class="stat-title text-xs">Schedules to delete</div>
            <div class="stat-value text-error text-3xl">{preview.count}</div>
            <div class="stat-desc">{roomTypeLabel} · {selectedDate}</div>
          </div>
        </div>

        <div class="alert alert-error text-xs py-2">
          <span>
            This will permanently remove <strong>{preview.count}</strong>
            {roomTypeLabel} schedule{preview.count === 1 ? '' : 's'}. This action <strong>cannot be undone</strong>.
          </span>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" onclick={() => (preview = null)}>Back</button>
        <button class="btn btn-error btn-sm" onclick={handleDelete}>
          Delete {preview.count} schedule{preview.count === 1 ? '' : 's'}
        </button>
      </div>
    {/if}

    <!-- ── Step 3: Result ── -->
    {#if summary && !isDeleting}
      <div class="my-4 space-y-2">
        <div class="stats shadow w-full">
          <div class="stat py-3">
            <div class="stat-title text-xs">Deleted</div>
            <div class="stat-value text-success text-3xl">{summary.deleted}</div>
          </div>
          {#if summary.failed}
            <div class="stat py-3">
              <div class="stat-title text-xs">Failed</div>
              <div class="stat-value text-error text-3xl">{summary.failed}</div>
            </div>
          {/if}
        </div>

        {#if summary.failed}
          <div class="alert alert-error text-xs py-2">
            <span
              >{summary.failed} record{summary.failed === 1 ? '' : 's'} could not be deleted. Try again or check PocketBase
              logs.</span
            >
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" onclick={close}>Close</button>
      </div>
    {/if}
  </div>
  <form method="dialog" class="modal-backdrop"><button onclick={close}>close</button></form>
</dialog>
