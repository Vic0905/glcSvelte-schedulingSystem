<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import AdvanceBookingModal from './AdvanceBookingModal.svelte'
  import GoLiveModal from './GoLiveModal.svelte'

  const stickyStyles = `
    #advance-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #advance-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #advance-grid th:nth-child(1), #advance-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #advance-grid th:nth-child(1) { z-index: 25; }
    #advance-grid th:nth-child(2), #advance-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #advance-grid th:nth-child(2) { z-index: 25; }
  `

  let currentWeekStart = $state('')
  let timeslots = []
  let rooms = []
  let advanceGrid = null
  let showAdvanceModal = $state(false)
  let showGoLiveModal = $state(false)

  let advanceBooking = $state({
    id: '',
    room: { id: '', name: '' },
    timeslot: { id: '', start: '', end: '' },
    teacher: { id: '', name: '' },
    student: { id: '', name: '' },
    subject: { id: '', name: '' },
    mode: 'create',
  })

  const initializeWeek = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  const getWeekDates = (startDate) => {
    const monday = new Date(startDate)
    return Array.from({ length: 4 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i + 1)
      return d.toISOString().split('T')[0]
    })
  }

  const getWeekRange = (startDate) => {
    const monday = new Date(startDate)
    const tuesday = new Date(monday)
    tuesday.setDate(monday.getDate() + 1)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)

    if (tuesday.getMonth() === friday.getMonth()) {
      return `${tuesday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${friday.getDate()}, ${friday.getFullYear()}`
    }
    return `${tuesday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} & ${friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeWeek = (weeks) => {
    const monday = new Date(currentWeekStart)
    monday.setDate(monday.getDate() + weeks * 7)
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'flex flex-col gap-1 text-xs items-center' }, [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name),
      h('div', { class: 'badge badge-neutral badge-xs' }, cell.student.englishName),
      h('div', { class: 'badge badge-error badge-xs' }, cell.teacher.name),
      // h('div', { class: 'badge badge-error badge-xs' }, cell.room.name),
    ])
  }

  async function loadAdvanceBookings() {
    try {
      const [timeslotsData, roomsData, bookings] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        rooms.length ? rooms : pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('advanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
      ])

      timeslots = timeslotsData
      rooms = roomsData

      // Build schedule map
      const scheduledRooms = {}
      for (const booking of bookings.items) {
        const roomId = booking.expand?.room?.id || booking.room
        const slotId = booking.expand?.timeslot?.id || booking.timeslot
        scheduledRooms[roomId] ??= {}
        scheduledRooms[roomId][slotId] = booking
      }

      // Build table data
      const data = rooms.map((room) => {
        const slotMap = scheduledRooms[room.id] || {}
        const assignedTeacher = room.expand?.teacher
        const row = [
          { value: assignedTeacher?.name || '-', disabled: true },
          { value: room.name, disabled: true },
        ]

        timeslots.forEach((timeslot) => {
          const item = slotMap[timeslot.id]
          row.push({
            label: item ? 'Schedule' : 'Empty',
            id: item?.id || '',
            subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
            teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
            student: { englishName: item?.expand?.student?.englishName || '', id: item?.expand?.student?.id || '' },
            room: { name: room.name, id: room.id },
            timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
            assignedTeacher,
          })
        })

        return row
      })

      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        { name: 'Room', width: '120px', formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value) },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, id: t.id, width: '160px', formatter: formatCell })),
      ]

      if (advanceGrid) {
        const wrapper = document.querySelector('#advance-grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        advanceGrid.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#advance-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        advanceGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-1 border text-center',
            td: 'border p-2 align-middle text-center',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('advance-grid'))

        advanceGrid.on('cellClick', (_, cell) => {
          const cellData = cell.data
          if (cellData.disabled) return

          Object.assign(advanceBooking, cellData)
          advanceBooking.mode = cellData.label === 'Empty' ? 'create' : 'edit'

          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            advanceBooking.teacher = { ...cellData.assignedTeacher }
          }

          showAdvanceModal = true
        })
      }
    } catch (error) {
      console.error('Error loading advance bookings:', error)
    }
  }

  const deleteAllAdvanceBookings = async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL advance bookings? This action cannot be undone.')) return

    try {
      const allBookings = await pb.collection('advanceBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No advance bookings found to delete.')
        return
      }

      await Promise.all(allBookings.map((b) => pb.collection('advanceBooking').delete(b.id)))
      alert(`✅ Successfully deleted ${allBookings.length} advance bookings.`)
      loadAdvanceBookings()
    } catch (error) {
      console.error('Error deleting advance bookings:', error)
      alert('❌ Failed to delete advance bookings. Check console for details.')
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadAdvanceBookings, 150)
  }

  onMount(() => {
    initializeWeek()
    loadAdvanceBookings()
    pb.collection('advanceBooking').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    advanceGrid?.destroy()
    advanceGrid = null
    pb.collection('advanceBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="mb-4 text-2xl font-bold text-primary text-center">
    <h2>MTM Schedule Table (Advance Template)</h2>
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-error btn-sm" onclick={deleteAllAdvanceBookings}>Delete All</button>
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getWeekRange(currentWeekStart)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
      <button class="btn btn-primary btn-sm" onclick={() => (showGoLiveModal = true)}>🚀 Go Live</button>
    </div>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Teacher</span>
      </div>
      <!-- <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div> -->
    </div>
  </div>

  <div id="advance-grid" class="border rounded-lg"></div>
</div>

<AdvanceBookingModal bind:show={showAdvanceModal} bind:advanceBooking onSave={loadAdvanceBookings} />
<GoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />
