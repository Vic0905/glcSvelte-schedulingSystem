<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  // ─────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────
  let { sourceDate = '', roomType = '', onrefresh } = $props()

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  let dialog = $state()
  let action = $state('show') // 'show' (draft → show) | 'draft' (show → draft)
  let mode = $state('single') // 'single' | 'range'
  let targetDate = $state('')
  let rangeStart = $state('')
  let rangeEnd = $state('')
  let isLoading = $state(false)
  let preview = $state(null) // { draft: number, show: number }

  // ─────────────────────────────────────────────
  // Derived: which status we're moving records from/to
  // ─────────────────────────────────────────────
  const fromStatus = $derived(action === 'show' ? 'draft' : 'show')
  const toStatus = $derived(action === 'show' ? 'show' : 'draft')

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────
  export function open(initialAction = 'show') {
    action = initialAction
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
      const records = await pb.collection('dailySchedule').getFullList({
        filter: `date >= "${startStr}" && date <= "${endStr}"${roomType ? ` && room.roomType = "${roomType}"` : ''}`,
        fields: 'id,status,date',
      })

      preview = {
        draft: records.filter((r) => r.status === 'draft').length,
        show: records.filter((r) => r.status === 'show').length,
      }
    } catch (err) {
      console.error(err)
      preview = null
    }
  }

  // ─────────────────────────────────────────────
  // Write release log entry — only for draft → show ("release") actions.
  // Reverting to draft is a correction, not a release, so it's not logged here.
  // ─────────────────────────────────────────────
  async function writeReleaseLog(start, end, count) {
    try {
      const userId = pb.authStore.record?.id
      if (!userId) {
        console.warn('writeReleaseLog: no authenticated user')
        return
      }

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + '.000Z'
      const dateField = `${start} 00:00:00.000Z`

      const payload = {
        date: dateField,
        releasedBy: userId,
        releasedAt: now,
        count,
        roomType: roomType || '',
        rangeStart: start,
        rangeEnd: end,
      }

      await pb.collection('releaseLog').create(payload)
    } catch (err) {
      console.warn('Failed to write release log:', err)
    }
  }

  // ─────────────────────────────────────────────
  // Main action — moves records from `fromStatus` to `toStatus`
  // ─────────────────────────────────────────────
  async function handleConfirm() {
    if (!isValidRange()) return

    const { start, end } = getDateRange()
    const startStr = `${start} 00:00:00`
    const endStr = `${end} 23:59:59`

    isLoading = true
    try {
      const toUpdate = await pb.collection('dailySchedule').getFullList({
        filter: `date >= "${startStr}" && date <= "${endStr}" && status = "${fromStatus}"${roomType ? ` && room.roomType = "${roomType}"` : ''}`,
        fields: 'id,date',
      })

      if (!toUpdate.length) {
        toast.info(`No ${fromStatus} schedules found in the selected range.`)
        close()
        return
      }
      const chunkSize = 5000
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize)
        const batch = pb.createBatch()
        for (const r of chunk) {
          batch.collection('dailySchedule').update(r.id, { status: toStatus })
        }
        await batch.send()
      }

      if (action === 'show') {
        await writeReleaseLog(start, end, toUpdate.length)
      }

      // ─── ACTIVITY LOG ───
      try {
        await pb.collection('activityLog').create({
          action: action === 'show' ? 'show' : 'draft',
          performedBy: pb.authStore.record?.id,
          targetId: `${start}_${end}`,
          details: {
            rangeStart: start,
            rangeEnd: end,
            roomType: roomType || 'all',
            count: toUpdate.length,
            fromStatus,
            toStatus,
          },
        })
      } catch (err) {
        console.error('Failed to write activity log:', err)
      }
      // ────────────────────

      toast.success(
        action === 'show'
          ? `Shown ${toUpdate.length} schedule${toUpdate.length !== 1 ? 's' : ''}.`
          : `Reverted ${toUpdate.length} schedule${toUpdate.length !== 1 ? 's' : ''} to draft.`
      )
      close()
      onrefresh?.()
    } catch (err) {
      console.error(err)
      toast.error(action === 'show' ? 'Failed to show schedules.' : 'Failed to revert schedules to draft.')
    } finally {
      isLoading = false
    }
  }

  // Re-fetch preview when action, mode or dates change
  $effect(() => {
    action
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
      <h3 class="font-bold text-lg">{action === 'show' ? 'Show Schedules' : 'Revert Schedules to Draft'}</h3>
      <button class="btn btn-sm btn-circle btn-ghost" onclick={close} disabled={isLoading}>✕</button>
    </div>

    <!-- Action tabs -->
    <div role="tablist" class="tabs tabs-boxed mb-3 font-semibold">
      <button
        role="tab"
        class="tab {action === 'show' ? 'tab-active !bg-success !text-success-content' : 'text-success/60'}"
        onclick={() => (action = 'show')}
        disabled={isLoading}
      >
        Draft → Show
      </button>
      <button
        role="tab"
        class="tab {action === 'draft' ? 'tab-active !bg-warning !text-warning-content' : 'text-warning/60'}"
        onclick={() => (action = 'draft')}
        disabled={isLoading}
      >
        Show → Draft
      </button>
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
          <span class="text-base-content/70">Draft</span>
          <span class="font-bold {action === 'show' ? 'text-warning' : ''}">{preview.draft}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-base-content/70">Show</span>
          <span class="font-bold {action === 'draft' ? 'text-warning' : ''}">{preview.show}</span>
        </div>
      </div>
    {:else if isValidRange()}
      <div class="flex justify-center mb-4">
        <span class="loading loading-spinner loading-sm"></span>
      </div>
    {/if}

    <!-- Info note -->
    <p class="text-xs text-base-content/50 mb-4">
      {#if action === 'show'}
        Only <strong>draft</strong> schedules whose date falls within the selected range will be moved to
        <strong>show</strong>.
      {:else}
        Only <strong>shown</strong> schedules whose date falls within the selected range will be reverted to
        <strong>draft</strong>. Use this to undo a mistaken release.
      {/if}
    </p>

    <!-- Actions -->
    <div class="modal-action mt-0">
      <button class="btn btn-ghost" onclick={close} disabled={isLoading}>Cancel</button>
      <button
        class="btn {action === 'show' ? 'btn-primary' : 'btn-warning'}"
        onclick={handleConfirm}
        disabled={isLoading || !isValidRange() || (action === 'show' ? preview?.draft === 0 : preview?.show === 0)}
      >
        {#if isLoading}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        {action === 'show' ? 'Show' : 'Revert to Draft'}
        {action === 'show' ? (preview?.draft ? `(${preview.draft})` : '') : preview?.show ? `(${preview.show})` : ''}
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button disabled={isLoading}>close</button>
  </form>
</dialog>
