<script>
  import { onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────
  let logs = $state([])
  let isLoading = $state(false)
  let filterAction = $state('') // '' | 'add' | 'update' | 'delete'
  let searchQuery = $state('')

  // ─────────────────────────────────────────────
  // DERIVED: filtered logs for display
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
  // HELPERS
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

    if (log.action === 'show') {
      return `Date: ${range} | Room type: ${roomType || 'all'} | Count: ${count}`
    }

    if (log.action === 'delete') {
      return `Date: ${range} | Timeslot: ${timeslot || '?'} | Room: ${roomName || '?'} | Teacher: ${teacherName || '?'} | Students: ${studentList}`
    }

    if (log.details.type === 'skip_day') {
      return `Skipped student: ${log.details.studentId} on ${log.details.skippedDate}`
    }

    // add / update
    return `Date: ${range} | Timeslot: ${timeslot || '?'} | Room: ${roomName || '?'} | Teacher: ${teacherName || '?'} | Students: ${studentList}`
  }

  // ─────────────────────────────────────────────
  // DATA FETCHING
  // ─────────────────────────────────────────────
  async function fetchLogs() {
    isLoading = true
    try {
      const filter = filterAction ? `action = "${filterAction}"` : ''

      logs = await pb.collection('activityLog').getFullList({
        ...(filter ? { filter } : {}),
        sort: '-created',
        expand: 'performedBy',
      })
    } catch (err) {
      console.error('Failed to fetch activity logs:', err)
      logs = []
    } finally {
      isLoading = false
    }
  }

  // Refetch when the filter changes
  $effect(() => {
    filterAction
    fetchLogs()
  })

  onMount(() => {
    fetchLogs()
  })
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
              <td class="text-center text-base-content/40 font-mono text-xs">{filteredLogs.length - i}</td>
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
    </div>
  {/if}
</div>
