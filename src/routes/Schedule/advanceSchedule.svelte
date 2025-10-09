<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import AdvanceBookingModal from './AdvanceBookingModal.svelte'
  import GoLiveModal from './GoLiveModal.svelte'

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

  // 🗓️ Initialize week to current Monday
  const initializeWeek = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  // 📅 Generate Tuesday to Friday dates
  const getWeekDates = (startDate) => {
    const monday = new Date(startDate)
    const weekDates = []
    for (let i = 2; i <= 5; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + (i - 1))
      weekDates.push(d.toISOString().split('T')[0])
    }
    return weekDates
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
    loadAdvanceBookings()
  }

  const createBadge = (text, color) => h('div', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    return h('div', { class: 'flex flex-col gap-1 text-xs items-center' }, [
      createBadge(cell.subject.name, 'badge-primary p-3'),
      createBadge(cell.teacher.name, 'badge-info'),
      createBadge(cell.student.englishName, 'badge-neutral'),
      createBadge(cell.room.name, 'badge-error'),
    ])
  }

  const buildColumns = () => [
    {
      name: 'Teacher',
      width: '120px',
      formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
    },
    {
      name: 'Room',
      width: '100px',
      formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
    },
    ...timeslots.map((t) => ({
      name: `${t.start} - ${t.end}`,
      id: t.id,
      width: '160px',
      formatter: formatCell,
    })),
  ]

  const fetchBookingData = async () => {
    const [timeslotsData, roomsData, bookings] = await Promise.all([
      pb.collection('timeSlot').getFullList({ sort: 'start' }),
      pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }),
      pb.collection('advanceBooking').getList(1, 500, {
        expand: 'teacher,student,subject,room,timeslot',
      }),
    ])

    return { timeslotsData, roomsData, bookings: bookings.items }
  }

  const processBookingData = (bookings) => {
    const scheduledRooms = {}
    bookings.forEach((booking) => {
      const roomId = booking.expand?.room?.id || booking.room
      const slotId = booking.expand?.timeslot?.id || booking.timeslot
      if (!scheduledRooms[roomId]) {
        scheduledRooms[roomId] = {}
      }
      scheduledRooms[roomId][slotId] = booking
    })
    return scheduledRooms
  }

  const createSlotData = (item, room, timeslot, assignedTeacher) => ({
    label: item ? 'Schedule' : 'Empty',
    id: item?.id || '',
    subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
    teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
    student: { englishName: item?.expand?.student?.englishName || '', id: item?.expand?.student?.id || '' },
    room: { name: room.name, id: room.id },
    timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
    assignedTeacher,
  })

  const buildTableData = (scheduledRooms) => {
    return rooms.map((room) => {
      const slotMap = scheduledRooms[room.id] || {}
      const assignedTeacher = room.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'

      const row = [
        { value: teacherName, disabled: true },
        { value: room.name, disabled: true },
      ]

      timeslots.forEach((timeslot) => {
        const item = slotMap[timeslot.id]
        row.push(createSlotData(item, room, timeslot, assignedTeacher))
      })

      return row
    })
  }

  const handleCellClick = (_, cell) => {
    const cellData = cell.data
    if (cellData.disabled) return
    Object.assign(advanceBooking, cellData)
    advanceBooking.mode = cellData.label === 'Empty' ? 'create' : 'edit'
    if (cellData.label === 'Empty' && cellData.assignedTeacher) {
      advanceBooking.teacher = { ...cellData.assignedTeacher }
    }
    showAdvanceModal = true
  }

  const initializeGrid = (data) => {
    const config = {
      columns: buildColumns(),
      data,
      search: false,
      sort: false,
      pagination: false,
      autoWidth: true,
      fixedHeader: true,
      className: {
        table: 'w-full border text-sm',
        th: 'bg-base-200 p-1 border text-center sticky top-0 z-10',
        td: 'border p-2 align-middle text-center',
      },
    }

    if (advanceGrid) {
      requestAnimationFrame(() => {
        advanceGrid.updateConfig({ data }).forceRender()
      })
    } else {
      advanceGrid = new Grid(config).render(document.getElementById('advance-grid'))
      advanceGrid.on('cellClick', handleCellClick)
    }
  }

  async function loadAdvanceBookings() {
    try {
      const { timeslotsData, roomsData, bookings } = await fetchBookingData()
      timeslots = timeslotsData
      rooms = roomsData
      const scheduledRooms = processBookingData(bookings)
      const data = buildTableData(scheduledRooms)
      initializeGrid(data)
    } catch (error) {
      console.error('Error loading advance bookings:', error)
    }
  }

  // 🗑️ Delete all advance bookings
  const deleteAllAdvanceBookings = async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL advance bookings? This action cannot be undone.')) return

    try {
      const allBookings = await pb.collection('advanceBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No advance bookings found to delete.')
        return
      }

      // Use Promise.all for faster bulk deletion
      await Promise.all(allBookings.map((b) => pb.collection('advanceBooking').delete(b.id)))

      alert(`✅ Successfully deleted ${allBookings.length} advance bookings.`)
      loadAdvanceBookings()
    } catch (error) {
      console.error('Error deleting advance bookings:', error)
      alert('❌ Failed to delete advance bookings. Check console for details.')
    }
  }

  onMount(() => {
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

<!-- 🧾 UI Layout -->
<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Room</h2>
    <h2 class="text-center flex-1">Advance Schedule Table (WEEKLY TEMPLATE)</h2>
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

  <!-- Legend -->
  <div class="p-3 bg-base-200 rounded-lg">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-info badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="advance-grid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>

<AdvanceBookingModal bind:show={showAdvanceModal} bind:advanceBooking onSave={loadAdvanceBookings} />
<GoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />
