<script>
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  // ─────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────
  let { sourceDate = '', onrefresh } = $props()

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  let dialog = $state()
  let mode = $state('single') // 'single' | 'range'
  let targetDate = $state('')
  let rangeStart = $state('')
  let rangeEnd = $state('')
  let isLoading = $state(false)
  let preview = $state(null) // { draft: number, alreadyShow: number }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────
  export function open() {
    mode = 'single'
    targetDate = sourceDate
    rangeStart = sourceDate
    rangeEnd = sourceDate
    preview = null
    dialog?.showModal()
    fetchPreview()
  }

  function close() {
    dialog?.close()
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────
  function getDateRange() {
    if (mode === 'single') {
      return { start: targetDate, end: targetDate }
    }
    return { start: rangeStart, end: rangeEnd }
  }

  function isValidRange() {
    const { start, end } = getDateRange()
    if (!start || !end) return false
    return start <= end
  }

  async function fetchPreview() {
    if (!isValidRange()) {
      preview = null
      return
    }

    const { start, end } = getDateRange()
    const startStr = `${start} 00:00:00`
    const endStr = `${end} 23:59:59`

    try {
      const records = await pb.collection('schedule').getFullList({
        filter: `start <= "${endStr}" && end >= "${startStr}"`,
        fields: 'id,status,start,end',
      })

      // Only count records whose start date falls within our range
      // (records that belong to this date window)
      const inRange = records.filter((r) => {
        const recStart = r.start?.split(' ')[0]
        return recStart >= start && recStart <= end
      })

      preview = {
        draft: inRange.filter((r) => r.status === 'draft').length,
        alreadyShow: inRange.filter((r) => r.status === 'show').length,
      }
    } catch (err) {
      console.error(err)
      preview = null
    }
  }

  async function handleShow() {
    if (!isValidRange()) return

    const { start, end } = getDateRange()
    const startStr = `${start} 00:00:00`
    const endStr = `${end} 23:59:59`

    isLoading = true
    try {
      // Fetch all draft records in range
      const records = await pb.collection('schedule').getFullList({
        filter: `start <= "${endStr}" && end >= "${startStr}" && status = "draft"`,
        fields: 'id,start',
      })

      // Filter to records whose start falls within our range
      const toUpdate = records.filter((r) => {
        const recStart = r.start?.split(' ')[0]
        return recStart >= start && recStart <= end
      })

      if (!toUpdate.length) {
        toast.info('No draft schedules found in the selected range.')
        close()
        return
      }

      // Batch update via PocketBase batch API
      const batchBody = {
        requests: toUpdate.map((r) => ({
          method: 'PATCH',
          url: `/api/collections/schedule/records/${r.id}`,
          body: { status: 'show' },
        })),
      }

      const res = await fetch(`${pb.baseUrl}/api/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: pb.authStore.token,
        },
        body: JSON.stringify(batchBody),
      })

      if (!res.ok) throw new Error(`Batch failed: ${res.statusText}`)

      toast.success(`Shown ${toUpdate.length} schedule${toUpdate.length !== 1 ? 's' : ''}.`)
      close()
      onrefresh?.()
    } catch (err) {
      console.error(err)
      toast.error('Failed to show schedules.')
    } finally {
      isLoading = false
    }
  }

  // Re-fetch preview when mode or dates change
  $effect(() => {
    // track all relevant state
    mode
    targetDate
    rangeStart
    rangeEnd
    fetchPreview()
  })
</script>

<dialog bind:this={dialog} class="modal">
  <div class="modal-box max-w-md">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-lg">Show Schedules</h3>
      <button class="btn btn-sm btn-circle btn-ghost" onclick={close} disabled={isLoading}>✕</button>
    </div>

    <!-- Mode tabs -->
    <div role="tablist" class="tabs tabs-boxed mb-4">
      <button
        role="tab"
        class="tab {mode === 'single' ? 'tab-active' : ''}"
        onclick={() => (mode = 'single')}
        disabled={isLoading}
      >
        Single Day
      </button>
      <button
        role="tab"
        class="tab {mode === 'range' ? 'tab-active' : ''}"
        onclick={() => (mode = 'range')}
        disabled={isLoading}
      >
        Date Range
      </button>
    </div>

    <!-- Date inputs -->
    {#if mode === 'single'}
      <label class="form-control mb-4">
        <div class="label"><span class="label-text">Date</span></div>
        <input type="date" class="input input-bordered" bind:value={targetDate} disabled={isLoading} />
      </label>
    {:else}
      <div class="grid grid-cols-2 gap-3 mb-4">
        <label class="form-control">
          <div class="label"><span class="label-text">From</span></div>
          <input type="date" class="input input-bordered" bind:value={rangeStart} disabled={isLoading} />
        </label>
        <label class="form-control">
          <div class="label"><span class="label-text">To</span></div>
          <input type="date" class="input input-bordered" bind:value={rangeEnd} min={rangeStart} disabled={isLoading} />
        </label>
      </div>

      {#if rangeStart && rangeEnd && rangeStart > rangeEnd}
        <p class="text-error text-sm mb-3">End date must be on or after start date.</p>
      {/if}
    {/if}

    <!-- Preview counts -->
    {#if preview !== null}
      <div class="bg-base-200 rounded-lg p-3 mb-4 text-sm space-y-1">
        <div class="flex justify-between">
          <span class="text-base-content/70">Draft (will be shown)</span>
          <span class="font-bold text-warning">{preview.draft}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-base-content/70">Already shown</span>
          <span class="font-bold text-success">{preview.alreadyShow}</span>
        </div>
      </div>
    {:else if isValidRange()}
      <div class="flex justify-center mb-4">
        <span class="loading loading-spinner loading-sm"></span>
      </div>
    {/if}

    <!-- Info note -->
    <p class="text-xs text-base-content/50 mb-4">
      Only schedules whose <strong>start date</strong> falls within the selected range will be shown. Records already
      set to <strong>show</strong> are not affected.
    </p>

    <!-- Actions -->
    <div class="modal-action mt-0">
      <button class="btn btn-ghost" onclick={close} disabled={isLoading}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleShow}
        disabled={isLoading || !isValidRange() || preview?.draft === 0}
      >
        {#if isLoading}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        Show {preview?.draft ? `(${preview.draft})` : ''}
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button disabled={isLoading}>close</button>
  </form>
</dialog>
