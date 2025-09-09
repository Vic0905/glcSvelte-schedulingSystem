<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import AdvanceBookingModal from './AdvanceBookingModal.svelte'
  import GoLiveModal from './GoLiveModal.svelte'

  // --- State ---
  let currentWeekStart = $state('')
  let timeslots = []
  let allRooms = []
  let advanceGrid = null
  let columns = null

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

  // --- Helpers ---
  const initializeWeek = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  const getWeekDates = (startDate) => {
    const monday = new Date(startDate)
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d.toISOString().split('T')[0]
    })
  }

  const getWeekRange = (startDate) => {
    const monday = new Date(startDate)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)
    if (monday.getMonth() === friday.getMonth()) {
      return `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${friday.getDate()}, ${friday.getFullYear()}`
    }
    return `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - ${friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeWeek = (weeks) => {
    const monday = new Date(currentWeekStart)
    monday.setDate(monday.getDate() + weeks * 7)
    currentWeekStart = monday.toISOString().split('T')[0]
    loadAdvanceBookings()
  }

  // --- Cell Helpers ---
  const createBadge = (text, color) => h('div', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'w-full p-2 flex flex-col gap-1 text-xs whitespace-nowrap' }, [
      createBadge(cell.subject.name, 'badge-primary'),
      createBadge(cell.teacher.name, 'badge-success'),
      createBadge(cell.student.name, 'badge-accent'),
      createBadge(cell.room.name, 'badge-error'),
    ])
  }

  const createSlotData = (item, room, roomId, t, assignedTeacher) => ({
    label: item ? 'Schedule' : 'Empty',
    id: item?.id || '',
    subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
    teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
    student: { name: item?.expand?.student?.name || '', id: item?.expand?.student?.id || '' },
    room: { name: room, id: roomId },
    timeslot: { id: t.id, start: t.start, end: t.end },
    assignedTeacher,
  })

  // --- Load Data ---
  async function loadAdvanceBookings() {
    // cache timeslots + rooms
    if (!timeslots.length) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }
    if (!allRooms.length) {
      allRooms = await pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' })
    }

    // use getList (paginated)
    const { items: records } = await pb.collection('advanceBooking').getList(1, 500, {
      expand: 'teacher,student,subject,room,timeslot',
    })

    const scheduledRooms = {}
    for (const r of records) {
      const roomId = r.expand?.room?.id || r.room
      const slotId = r.expand?.timeslot?.id || r.timeslot
      if (!scheduledRooms[roomId]) scheduledRooms[roomId] = {}
      scheduledRooms[roomId][slotId] = r
    }

    // transform into grid rows
    const data = allRooms.map((room) => {
      const slotMap = scheduledRooms[room.id] || {}
      const assignedTeacher = room.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'
      const row = [
        { value: teacherName, disabled: true },
        { value: room.name, disabled: true },
      ]
      timeslots.forEach((t) => {
        const item = slotMap[t.id]
        row.push(createSlotData(item, room.name, room.id, t, assignedTeacher))
      })
      return row
    })

    // build columns only once
    if (!columns) {
      columns = [
        {
          name: 'Teacher',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        {
          name: 'Room',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          formatter: formatCell,
        })),
      ]
    }

    // update or create grid
    if (advanceGrid) {
      requestAnimationFrame(() => {
        advanceGrid.updateConfig({ data }).forceRender()
      })
    } else {
      advanceGrid = new Grid({
        columns,
        data,
        search: { enabled: true },
        sort: false,
        pagination: false,
        autoWidth: true,
        className: {
          table: 'w-full border text-sm',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 whitespace-pre-line align-middle text-left font-semibold',
        },
      }).render(document.getElementById('advance-grid'))

      // click handler (set once)
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
  }

  onMount(() => {
    // if (advanceGrid) advanceGrid.destroy()
    initializeWeek()
    loadAdvanceBookings()
  })

  onDestroy(() => {
    if (advanceGrid) {
      advanceGrid.destroy()
      advanceGrid = null
    }
  })
</script>

<div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Room</h2>
    <h2 class="text-center flex-1">Advance Schedule Table (Weekly Template)</h2>
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getWeekRange(currentWeekStart)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
      <button class="btn btn-primary btn-sm" onclick={() => (showGoLiveModal = true)}>🚀 Go Live</button>
    </div>
  </div>

  <!-- Legend -->
  <div class="p-3 bg-base-200 rounded-lg">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-accent badge-xs"></div>
        <span>Student </span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="advance-grid" class="overflow-auto max-h-[650px]"></div>
</div>

<AdvanceBookingModal bind:show={showAdvanceModal} bind:advanceBooking onSave={loadAdvanceBookings} />
<GoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />

<style>
  .gridjs-td {
    min-height: 120px;
  }
</style>
