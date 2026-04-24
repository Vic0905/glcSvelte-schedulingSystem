<script>
  import { onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let schedules = []
  let loading = false
  let selectedWeek = ''
  let selectedItems = new Set()

  // Fetch ACTIVE schedules (no soft delete system)
  async function fetchSchedules() {
    loading = true
    try {
      schedules = await pb.collection('lessonSchedule').getFullList({
        sort: '-created',
      })
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedules')
    } finally {
      loading = false
    }
  }

  onMount(() => {
    fetchSchedules()
  })

  function toggleSelect(id) {
    if (selectedItems.has(id)) {
      selectedItems.delete(id)
    } else {
      selectedItems.add(id)
    }
    selectedItems = new Set(selectedItems)
  }

  function selectAll() {
    if (selectedItems.size === schedules.length) {
      selectedItems = new Set()
    } else {
      selectedItems = new Set(schedules.map((s) => s.id))
    }
  }

  async function archiveSelected() {
    if (selectedItems.size === 0) {
      toast.error('No schedules selected')
      return
    }

    if (!selectedWeek) {
      toast.error('Please enter a Week ID')
      return
    }

    loading = true

    try {
      const itemsToArchive = schedules.filter((s) => selectedItems.has(s.id))

      for (const item of itemsToArchive) {
        await pb.collection('lessonScheduleHistory').create({
          week_id: selectedWeek,

          start_date: item.start_date,
          end_date: item.end_date,

          timeslot: item.timeslot,
          teacher: item.teacher,
          student: item.student,
          subject: item.subject,
          room: item.room,

          // Ensure days is valid JSON array/object
          days: item.days,

          archived_at: new Date().toISOString(),
        })
      }

      toast.success('Schedules archived successfully')

      selectedItems = new Set()
      await fetchSchedules()
    } catch (err) {
      console.error(err)
      toast.error('Failed to archive schedules')
    } finally {
      loading = false
    }
  }
</script>

<div class="p-4">
  <h1 class="text-xl font-bold mb-4">Lesson Schedule Archive</h1>

  <!-- Controls -->
  <div class="flex gap-3 mb-4 items-center">
    <input
      type="text"
      placeholder="Week ID (e.g. 2026-W16)"
      bind:value={selectedWeek}
      class="border p-2 rounded w-64"
    />

    <button class="btn btn-primary" on:click={selectAll}>
      {selectedItems.size === schedules.length ? 'Unselect All' : 'Select All'}
    </button>

    <button class="btn btn-success" on:click={archiveSelected} disabled={loading}> Archive Selected </button>
  </div>

  <!-- Table -->
  <div class="overflow-auto border rounded">
    <table class="w-full text-sm">
      <thead class="bg-gray-100">
        <tr>
          <th></th>
          <th>Timeslot</th>
          <th>Teacher</th>
          <th>Student</th>
          <th>Subject</th>
          <th>Room</th>
        </tr>
      </thead>

      <tbody>
        {#if loading}
          <tr>
            <td colspan="6" class="p-4 text-center">Loading...</td>
          </tr>
        {:else if schedules.length === 0}
          <tr>
            <td colspan="6" class="p-4 text-center">No schedules found</td>
          </tr>
        {:else}
          {#each schedules as s}
            <tr class="border-t hover:bg-gray-50">
              <td class="p-2">
                <input type="checkbox" checked={selectedItems.has(s.id)} on:change={() => toggleSelect(s.id)} />
              </td>

              <td>{s.timeslot}</td>
              <td>{s.teacher}</td>
              <td>{s.student}</td>
              <td>{s.subject}</td>
              <td>{s.room}</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
