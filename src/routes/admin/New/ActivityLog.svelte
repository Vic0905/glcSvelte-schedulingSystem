<script>
  import { onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────
  let logs = $state([])
  let isLoading = $state(false)
  let filterAction = $state('')
  let searchQuery = $state('')

  // Pagination
  let currentPage = $state(1)
  let totalPages = $state(1)
  let totalItems = $state(0)
  const PER_PAGE = 15

  // ─────────────────────────────────────────────
  // DERIVED
  // ─────────────────────────────────────────────
  let filteredLogs = $derived.by(() => {
    if (!searchQuery.trim()) return logs
    const q = searchQuery.toLowerCase()
    return logs.filter((log) => {
      const user = log.expand?.performedBy?.name || log.expand?.performedBy?.username || 'system'
      const details = formatDetails(log).toLowerCase()
      return user.toLowerCase().includes(q) || log.action.includes(q) || details.includes(q)
    })
  })

  // ─────────────────────────────────────────────
  // HELPERS (unchanged)
  // ─────────────────────────────────────────────
  function formatDateTime(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getActionColor(action) {
    const colors = {
      add: 'badge-success badge-soft',
      update: 'badge-info badge-soft',
      delete: 'badge-error badge-soft',
      show: 'badge-warning badge-soft',
    }
    return colors[action] || 'badge-ghost'
  }

  function formatDetails(log) {
    if (!log.details) return '—'
    const { teacherName, roomName, timeslot, students, rangeStart, rangeEnd, roomType, count } = log.details
    const studentList = Array.isArray(students) ? students.map((s) => s.name).join(', ') : 'No students'
    const range = rangeStart && rangeEnd ? (rangeStart === rangeEnd ? rangeStart : `${rangeStart} → ${rangeEnd}`) : '?'

    if (log.action === 'show') return `Date: ${range} | Room type: ${roomType || 'all'} | Count: ${count}`
    if (log.action === 'delete')
      return `Date: ${range} | Timeslot: ${timeslot || '?'} | Room: ${roomName || '?'} | Teacher: ${teacherName || '?'} | Students: ${studentList}`
    if (log.details.type === 'skip_day')
      return `Skipped student: ${log.details.studentId} on ${log.details.skippedDate}`
    return `Date: ${range} | Timeslot: ${timeslot || '?'} | Room: ${roomName || '?'} | Teacher: ${teacherName || '?'} | Students: ${studentList}`
  }

  // ─────────────────────────────────────────────
  // DATA FETCHING
  // ─────────────────────────────────────────────
  async function fetchLogs(page = 1) {
    isLoading = true
    try {
      const filter = filterAction ? `action = "${filterAction}"` : ''

      const result = await pb.collection('activityLog').getList(page, PER_PAGE, {
        ...(filter ? { filter } : {}),
        sort: '-created',
        expand: 'performedBy',
      })

      logs = result.items
      currentPage = result.page
      totalPages = result.totalPages
      totalItems = result.totalItems
    } catch (err) {
      console.error('Failed to fetch activity logs:', err)
      logs = []
    } finally {
      isLoading = false
    }
  }

  function goToPage(page) {
    if (page < 1 || page > totalPages) return
    fetchLogs(page)
  }

  // Reset to page 1 when filter changes
  $effect(() => {
    filterAction
    fetchLogs(1)
  })

  onMount(() => fetchLogs(1))
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100 min-h-screen">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-2xl font-bold">System Activity Log</h2>
    <div class="flex items-center gap-3">
      <input type="text" placeholder="Search..." bind:value={searchQuery} class="input input-bordered input-sm w-48" />
      <select class="select select-bordered select-sm w-full max-w-xs" bind:value={filterAction}>
        <option value="">All Actions</option>
        <option value="add">Added</option>
        <option value="update">Updated</option>
        <option value="delete">Deleted</option>
      </select>

      {#if isLoading}
        <div class="loading loading-spinner loading-sm"></div>
      {/if}
    </div>
  </div>

  {#if isLoading && logs.length === 0}
    <div class="flex justify-center py-16">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {:else if filteredLogs.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-base-content/30 gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <p class="text-sm">{searchQuery.trim() ? 'No results match your search.' : 'No activity logs found.'}</p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-base-300">
      <table class="table table-zebra w-full text-sm">
        <thead>
          <tr class="bg-neutral text-neutral-content">
            <th class="text-center w-12">#</th>
            <th>User</th>
            <th>Action</th>
            <th>Date & Time</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredLogs as log, i (log.id)}
            <tr>
              <td class="text-center text-base-content/40 font-mono text-xs">
                {totalItems - (currentPage - 1) * PER_PAGE - i}
              </td>
              <td>
                <span class="font-medium">
                  {log.expand?.performedBy?.name || log.expand?.performedBy?.username || 'System'}
                </span>
              </td>

              <td>
                <span class="badge badge-sm {getActionColor(log.action)} uppercase text-xs font-bold">
                  {log.action}
                </span>
              </td>

              <td class="tabular-nums text-base-content/80">
                {formatDateTime(log.created)}
              </td>

              <td class="text-base-content/70">
                {formatDetails(log)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- After </table>, inside the overflow-x-auto div or below it -->

      <!-- Pagination footer -->
      <div class="flex items-center justify-between px-4 py-3 border-t border-base-300 text-sm text-base-content/60">
        <span>
          {#if totalItems > 0}
            Showing {(currentPage - 1) * PER_PAGE + 1}–{Math.min(currentPage * PER_PAGE, totalItems)} of {totalItems}
          {:else}
            No results
          {/if}
        </span>

        <div class="join">
          <button class="join-item btn btn-sm" onclick={() => goToPage(1)} disabled={currentPage === 1}>«</button>
          <button class="join-item btn btn-sm" onclick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}
            >‹</button
          >

          {#each Array.from({ length: totalPages }, (_, i) => i + 1) as page}
            {#if totalPages <= 7 || page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1}
              <button
                class="join-item btn btn-sm {page === currentPage ? 'btn-neutral' : ''}"
                onclick={() => goToPage(page)}
              >
                {page}
              </button>
            {:else if Math.abs(page - currentPage) === 2}
              <button class="join-item btn btn-sm btn-disabled">…</button>
            {/if}
          {/each}

          <button
            class="join-item btn btn-sm"
            onclick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}>›</button
          >
          <button
            class="join-item btn btn-sm"
            onclick={() => goToPage(totalPages)}
            disabled={currentPage === totalPages}>»</button
          >
        </div>
      </div>
    </div>
  {/if}
</div>
