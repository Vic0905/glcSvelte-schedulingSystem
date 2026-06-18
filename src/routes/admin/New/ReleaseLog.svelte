<script>
  import { onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // ─────────────────────────────────────────────
  // SECTION 1: Non-reactive module-level state
  // ─────────────────────────────────────────────
  let refreshTimer = null

  // ─────────────────────────────────────────────
  // SECTION 2: Reactive state
  // ─────────────────────────────────────────────
  let logs = $state([])
  let isLoading = $state(false)
  let filterRoomType = $state('') // '' | 'mtm' | 'grp'

  // ─────────────────────────────────────────────
  // SECTION 3: Pure helper functions
  // ─────────────────────────────────────────────
  function formatDateTime(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function formatRoomType(rt) {
    if (!rt) return '—'
    return rt.toUpperCase()
  }

  // ─────────────────────────────────────────────
  // SECTION 4: Data fetching
  // ─────────────────────────────────────────────
  async function fetchLogs() {
    isLoading = true
    try {
      const filter = filterRoomType ? `roomType = "${filterRoomType}"` : ''

      logs = await pb.collection('releaseLog').getFullList({
        ...(filter ? { filter } : {}),
        sort: '-releasedAt',
        expand: 'releasedBy',
      })
    } catch (err) {
      console.error('Failed to fetch release logs:', err)
      logs = []
    } finally {
      isLoading = false
    }
  }

  // ─────────────────────────────────────────────
  // SECTION 5: Reactivity — refetch on filter change
  // ─────────────────────────────────────────────
  $effect(() => {
    filterRoomType
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => fetchLogs(), 150)
  })

  // ─────────────────────────────────────────────
  // SECTION 6: Lifecycle
  // ─────────────────────────────────────────────
  onMount(() => {
    return () => clearTimeout(refreshTimer)
  })
</script>

<!-- ─────────────────────────────────────────── -->
<!-- TEMPLATE                                    -->
<!-- ─────────────────────────────────────────── -->

<div class="p-2 sm:p-4 md:p-6 bg-base-100 min-h-screen">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-2xl font-bold">Release Log</h2>
    <div class="flex items-center gap-3">
      <!-- Room type filter -->
      <div role="tablist" class="tabs tabs-boxed tabs-sm">
        <button
          role="tab"
          class="tab {filterRoomType === '' ? 'tab-active' : ''}"
          onclick={() => (filterRoomType = '')}
        >
          All
        </button>
        <button
          role="tab"
          class="tab {filterRoomType === 'mtm' ? 'tab-active' : ''}"
          onclick={() => (filterRoomType = 'mtm')}
        >
          MTM
        </button>
        <button
          role="tab"
          class="tab {filterRoomType === 'grp' ? 'tab-active' : ''}"
          onclick={() => (filterRoomType = 'grp')}
        >
          GRP
        </button>
      </div>
      {#if isLoading}
        <div class="loading loading-spinner loading-sm"></div>
      {/if}
    </div>
  </div>

  <!-- Log entries -->
  {#if isLoading && logs.length === 0}
    <div class="flex justify-center py-16">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {:else if logs.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-base-content/30 gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <p class="text-sm">No release logs found.</p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-base-300">
      <table class="table table-zebra w-full text-sm">
        <thead>
          <tr class="bg-neutral text-neutral-content">
            <th class="text-center w-12">#</th>
            <th>Released By</th>
            <th>Release Date &amp; Time</th>
            <th class="text-center">Room Type</th>
            <th class="text-center">Schedules Shown</th>
            <th class="text-center">Date Range</th>
          </tr>
        </thead>
        <tbody>
          {#each logs as log, i (log.id)}
            <tr>
              <!-- Entry number -->
              <td class="text-center text-base-content/40 font-mono text-xs">{i + 1}</td>

              <!-- Released by -->
              <td>
                <div class="flex items-center gap-2">
                  <div class="avatar placeholder">
                    <div class="bg-neutral text-neutral-content rounded-full w-7">
                      <span class="text-xs">
                        {(log.expand?.releasedBy?.name || log.expand?.releasedBy?.username || '?')
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <span class="font-medium">
                    {log.expand?.releasedBy?.name || log.expand?.releasedBy?.username || '—'}
                  </span>
                </div>
              </td>

              <!-- Release date & time -->
              <td class="tabular-nums">
                {formatDateTime(log.releasedAt)}
              </td>

              <!-- Room type badge -->
              <td class="text-center">
                <span
                  class="badge badge-sm {log.roomType === 'mtm'
                    ? 'badge-primary'
                    : log.roomType === 'grp'
                      ? 'badge-secondary'
                      : 'badge-ghost'}"
                >
                  {formatRoomType(log.roomType)}
                </span>
              </td>

              <!-- Schedules shown count -->
              <td class="text-center">
                <span class="font-bold text-success">{log.count ?? 0}</span>
              </td>

              <!-- Date range -->
              <td class="text-center text-base-content/60">
                {#if log.rangeStart && log.rangeEnd}
                  {log.rangeStart === log.rangeEnd ? log.rangeStart : `${log.rangeStart} → ${log.rangeEnd}`}
                {:else}
                  —
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Summary footer -->
    <div class="mt-4 flex items-center justify-between text-sm text-base-content/50 px-1">
      <span>{logs.length} release{logs.length !== 1 ? 's' : ''} total</span>
      <span>
        Total shown:
        <span class="font-bold text-success">
          {logs.reduce((sum, l) => sum + (l.count ?? 0), 0)}
        </span>
        schedules
      </span>
    </div>
  {/if}
</div>
