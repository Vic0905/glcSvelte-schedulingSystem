<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'

  // --- State ---
  let date = $state(new Date().toISOString().split('T')[0])
  let timeslots = []
  let cachedRooms = null
  let cachedTimeslots = null
  let loadTimeout = null

  // --- Utilities ---
  const changeDate = (days) => {
    const currentDate = new Date(date)
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]

    // Debounce fetches to avoid spamming PB when user clicks fast
    clearTimeout(loadTimeout)
    loadTimeout = setTimeout(loadSchedules, 100)
  }

  const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs mr-1` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h(
      'div',
      {
        class: 'w-full max-w-full rounded p-1 flex flex-col gap-1 text-xs items-center truncate',
      },
      [
        createBadge(cell.subject.name, 'badge-primary'),
        createBadge(cell.teacher.name, 'badge-success'),
        createBadge(cell.student.name, 'badge-neutral'),
        createBadge(cell.room.name, 'badge-error'),
      ]
    )
  }

  const createSlotData = (item, room, roomId, t, assignedTeacher) => ({
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
      name: item?.expand?.student?.name || '',
      id: item?.expand?.student?.id || '',
    },
    room: { name: room, id: roomId },
    timeslot: { id: t.id, start: t.start, end: t.end },
    assignedTeacher: assignedTeacher,
  })

  // --- Main Fetch ---
  async function loadSchedules() {
    // Cache static data
    if (!cachedTimeslots) {
      cachedTimeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }
    if (!cachedRooms) {
      cachedRooms = await pb.collection('room').getFullList({
        sort: 'name',
        expand: 'teacher',
      })
    }

    timeslots = cachedTimeslots

    // Only schedules for this date
    const records = await pb.collection('lessonSchedule').getList(1, 200, {
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,room,timeslot',
    })

    // Group schedules by room
    const scheduledRooms = {}
    records.items.forEach((r) => {
      const roomId = r.expand.room.id
      if (!scheduledRooms[roomId]) {
        scheduledRooms[roomId] = {}
      }
      scheduledRooms[roomId][r.expand.timeslot.id] = r
    })

    // Create grid rows
    const data = cachedRooms.map((room) => {
      const slotMap = scheduledRooms[room.id] || {}
      const assignedTeacher = room.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'

      const row = [
        { label: 'Teacher', value: teacherName, disabled: true },
        { label: 'Room', value: room.name, disabled: true },
      ]

      timeslots.forEach((t) => {
        const item = slotMap[t.id]
        row.push(createSlotData(item, room.name, room.id, t, assignedTeacher))
      })

      return row
    })

    // Build columns once (reuse)
    if (!grid.columns) {
      grid.columns = [
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
    }

    // Update or create grid
    if (grid.schedule) {
      requestAnimationFrame(() => {
        grid.schedule.updateConfig({ data }).forceRender()
      })
    } else {
      grid.schedule = new Grid({
        columns: grid.columns,
        data,
        search: {
          enabled: true,
          selector: (cell) => (typeof cell === 'string' ? cell : cell?.value || ''),
        },
        sort: false,
        pagination: { enabled: true, limit: 50 },
        autoWidth: true,
        className: {
          table: 'w-full border text-sm relative',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 whitespace-pre-line align-middle text-center font-semibold',
        },
      }).render(document.getElementById('grid'))

      grid.schedule.on('cellClick', (...args) => {
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
      })
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

<div class="p-6 max-w-auto mx-auto bg-base-100">
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
        <div class="badge badge-success badge-xs"></div>
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

  <div id="grid"></div>
</div>

<ScheduleModal on:refresh={loadSchedules} />

<style>
  .gridjs-td {
    min-height: 120px;
  }
  :global(.gridjs-wrapper) {
    max-height: 580px;
  }
  :global(.gridjs-table-container) {
    overflow: auto;
  }
</style>
