<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'

  let date = $state(new Date().toISOString().split('T')[0])
  let timeslots = []
  let rooms = []

  const changeDate = (days) => {
    const currentDate = new Date(date)
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadSchedules()
  }

  const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs ` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    return h(
      'div',
      {
        class: 'flex flex-col gap-1 text-xs items-center',
      },
      [
        createBadge(cell.subject.name, 'badge-primary'),
        createBadge(cell.teacher.name, 'badge-info'),
        createBadge(cell.student.englishName, 'badge-neutral'),
        createBadge(cell.room.name, 'badge-error'),
      ]
    )
  }

  const buildColumns = () => [
    {
      name: 'Teacher',
      formatter: (cell) =>
        cell.disabled
          ? h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value)
          : cell.value,
    },
    {
      name: 'Room',
      formatter: (cell) =>
        cell.disabled
          ? h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value)
          : cell.value,
    },
    ...timeslots.map((t) => ({
      name: `${t.start} - ${t.end}`,
      id: t.id,
      width: 'auto',
      formatter: formatCell,
    })),
  ]

  const fetchScheduleData = async () => {
    const [timeslotsData, roomsData, schedules] = await Promise.all([
      pb.collection('timeSlot').getFullList({ sort: 'start' }),
      pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }),
      pb.collection('lessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,room,timeslot',
      }),
    ])

    return {
      timeslotsData,
      roomsData,
      schedules: schedules.items,
    }
  }

  const processScheduleData = (schedules) => {
    const scheduledRooms = {}

    schedules.forEach((schedule) => {
      const roomId = schedule.expand.room.id
      if (!scheduledRooms[roomId]) {
        scheduledRooms[roomId] = {}
      }
      scheduledRooms[roomId][schedule.expand.timeslot.id] = schedule
    })

    return scheduledRooms
  }

  const createSlotData = (item, room, timeslot, assignedTeacher) => ({
    label: item ? 'Schedule' : 'Empty',
    id: item?.id || '',
    date,
    subject: {
      name: item?.expand?.subject?.name || '',
      id: item?.expand?.subject?.id || '',
    },
    teacher: {
      name: item?.expand?.teacher?.name || '',
      id: item?.expand?.teacher?.id || '',
    },
    student: {
      englishName: item?.expand?.student?.englishName || '',
      id: item?.expand?.student?.id || '',
    },
    room: { name: room.name, id: room.id },
    timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
    assignedTeacher: assignedTeacher,
  })

  const buildTableData = (scheduledRooms) => {
    return rooms.map((room) => {
      const slotMap = scheduledRooms[room.id] || {}
      const assignedTeacher = room.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'

      const row = [
        { label: 'Teacher', value: teacherName, disabled: true },
        { label: 'Room', value: room.name, disabled: true },
      ]

      timeslots.forEach((timeslot) => {
        const item = slotMap[timeslot.id]
        row.push(createSlotData(item, room, timeslot, assignedTeacher))
      })

      return row
    })
  }

  const handleCellClick = (...args) => {
    const cellData = args[1].data
    if (cellData.disabled) return

    Object.assign(booking.data, cellData)
    booking.data.startDate = cellData.date
    booking.data.endDate = cellData.date
    booking.data.timeslot.id = cellData.timeslot?.id || ''
    booking.data.room.id = cellData.room?.id || ''
    booking.data.mode = cellData.label === 'Empty' ? 'create' : 'edit'

    if (cellData.label === 'Empty' && cellData.assignedTeacher) {
      booking.data.teacher.id = cellData.assignedTeacher.id
      booking.data.teacher.name = cellData.assignedTeacher.name
    }

    editModal.showModal()
  }

  const initializeGrid = (data) => {
    const config = {
      columns: buildColumns(),
      data,
      search: false,
      sort: false,
      pagination: { enabled: true, limit: 50 },
      autoWidth: true,
      className: {
        table: 'w-full border text-sm',
        th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
        td: 'border p-2 whitespace-nowrap align-middle text-center',
      },
    }

    if (grid.schedule) {
      grid.schedule.updateConfig({ data }).forceRender()
    } else {
      grid.schedule = new Grid(config).render(document.getElementById('grid'))

      // //detach pagination after render
      // grid.schedule.on('ready', () => {
      //   const paginationEl = document.querySelector('.gridjs-pagination')
      //   const target = document.getElementById('grid-pagination')
      //   if (paginationEl && target) {
      //     target.appendChild(paginationEl) //move pagination outside
      //   }
      // })

      grid.schedule.on('cellClick', handleCellClick)
    }
  }

  async function loadSchedules() {
    try {
      const { timeslotsData, roomsData, schedules } = await fetchScheduleData()

      // Update cached data
      timeslots = timeslotsData
      rooms = roomsData

      const scheduledRooms = processScheduleData(schedules)
      const data = buildTableData(scheduledRooms)

      initializeGrid(data)
    } catch (error) {
      console.error('Error loading schedules:', error)
      toast.error('Failed to load schedules')
    }
  }

  onMount(() => {
    if (grid.schedule) {
      grid.schedule.destroy()
      grid.schedule = null
    }
    loadSchedules()
  })

  onDestroy(() => {
    console.log('InputTable component Destroyed')
    if (grid.schedule) {
      grid.schedule.destroy()
      grid.schedule = null
      console.log('Grid exists after destroy: ', !!grid.schedule)
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Room</h2>
    <h2 class="text-center flex-1">Schedule Table (Daily)</h2>
  </div>

  <!-- Filter row -->
  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Filter Date:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={date}
        class="input input-bordered input-sm w-40"
        onchange={loadSchedules}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
      {new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })} - {new Date(date).toLocaleDateString('en-US', { weekday: 'long' })}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(1)}>&rarr;</button>
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
        <span>Student </span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="grid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>

<ScheduleModal on:refresh={loadSchedules} />
