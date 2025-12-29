<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let currentDate = $state(new Date().toISOString().split('T')[0])
  let timeslots = []
  let bookingsGrid = null
  let totalBookingsToday = $state(0)

  const getDateDisplay = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const changeDate = (days) => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + days)
    currentDate = d.toISOString().split('T')[0]
    loadBookings()
  }

  const formatCell = (count) => {
    return h('div', { class: 'p-3' }, [
      h('div', { class: count > 0 ? 'text-2xl font-bold' : 'text-xl text-gray-400' }, count || '—'),
    ])
  }

  async function loadBookings() {
    try {
      const [slots, schedules] = await Promise.all([
        timeslots.length ? Promise.resolve(timeslots) : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('lessonSchedule').getFullList({ filter: `date = "${currentDate}"` }),
      ])

      if (!timeslots.length) timeslots = slots

      totalBookingsToday = schedules.length

      const counts = new Map(timeslots.map((t) => [t.id, 0]))
      schedules.forEach((s) => counts.has(s.timeslot) && counts.set(s.timeslot, counts.get(s.timeslot) + 1))

      const columns = timeslots.map((t) => ({
        name: `${t.start} - ${t.end}`,
        width: '150px',
        formatter: (cell) => formatCell(cell),
      }))

      const data = [timeslots.map((t) => counts.get(t.id))]

      if (bookingsGrid) {
        bookingsGrid.updateConfig({ columns, data }).forceRender()
      } else {
        bookingsGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full',
            th: 'bg-gray-100 p-2 text-sm font-medium',
            td: 'text-center',
          },
        }).render(document.getElementById('bookings-grid'))
      }
    } catch (error) {
      toast.error('Failed to load bookings')
    }
  }

  onMount(() => {
    loadBookings()
    pb.collection('lessonSchedule').subscribe('*', loadBookings)
  })

  onDestroy(() => {
    bookingsGrid?.destroy()
    pb.collection('lessonSchedule').unsubscribe()
  })
</script>

<div class="p-6 max-w-7xl mx-auto">
  <h1 class="text-2xl font-bold mb-6">Daily Bookings</h1>

  <div class="flex items-center justify-between mb-6 gap-4">
    <button class="btn btn-sm" onclick={() => changeDate(-1)}>←</button>
    <div class="text-lg font-medium">{getDateDisplay(currentDate)}</div>
    <button class="btn btn-sm" onclick={() => changeDate(1)}>→</button>
  </div>

  <div class="text-center mb-6">
    <span class="text-4xl font-bold">{totalBookingsToday}</span>
    <span class="text-sm text-gray-500 ml-2">total bookings</span>
  </div>

  <div id="bookings-grid" class="border rounded"></div>
</div>
