<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'

  let date = $state(new Date().toISOString().split('T')[0])
  let timeslots = []

  const changeDate = (days) => {
    const currentDate = new Date(date)
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadSchedules()
  }

  const createBadge = (text, colorClass) => h('div', { class: `badge ${colorClass} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h(
      'div',
      {
        class: 'w-full max-w-full rounded p-2 flex flex-col gap-1 text-xs justify-center items-left whitespace-nowrap',
      },
      [
        createBadge(cell.subject.name, 'badge-primary'),
        createBadge(cell.teacher.name, 'badge-success'),
        createBadge(cell.student.name, 'badge-accent'),
        createBadge(cell.room.name, 'badge-error'),
      ]
    )
  }

  const createSlotData = (item, room, roomId, t, assignedTeacher) => ({
    label: item ? 'Schedule' : 'Empty',
    id: item?.id || '',
    date,
    subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
    teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
    student: { name: item?.expand?.student?.name || '', id: item?.expand?.student?.id || '' },
    room: { name: room, id: roomId },
    timeslot: { id: t.id, start: t.start, end: t.end },
    assignedTeacher: assignedTeacher, // Pass the room's assigned teacher
  })

  async function loadSchedules() {
    if (!timeslots.length) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }

    // Get all rooms with their assigned teachers
    const allRooms = await pb.collection('room').getFullList({
      sort: 'name',
      expand: 'teacher', // Expand to get assigned teacher information
    })

    const records = await pb.collection('lessonSchedule').getFullList({
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,room,timeslot',
    })

    // Group schedules by room
    const scheduledRooms = {}
    records.forEach((r) => {
      const roomId = r.expand.room.id
      if (!scheduledRooms[roomId]) {
        scheduledRooms[roomId] = {}
      }
      scheduledRooms[roomId][r.expand.timeslot.id] = r
    })

    // Create data for all rooms (including empty ones)
    const data = allRooms.map((room) => {
      const slotMap = scheduledRooms[room.id] || {}

      // Get the assigned teacher from the room data
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

    // Build columns once
    if (!grid.columns) {
      grid.columns = [
        {
          name: 'Teacher',
          formatter: (cell) => {
            if (cell.disabled) {
              return h(
                'span',
                {
                  class: 'cursor-not-allowed',
                  style: 'pointer-events: none;',
                },
                cell.value
              )
            }
            return cell.value
          },
          hidden: false,
        },
        {
          name: 'Room',
          formatter: (cell) => {
            if (cell.disabled) {
              return h(
                'span',
                {
                  class: 'cursor-not-allowed',
                  style: 'pointer-events: none;',
                },
                cell.value
              )
            }
            return cell.value
          },
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: 'auto',
          formatter: formatCell,
        })),
      ]
    }

    // Grid reuse or create
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
          selector: (cell) => {
            if (typeof cell === 'string') return cell
            return cell?.value || ''
          },
        },
        sort: false,
        pagination: false,
        autoWidth: true,
        className: {
          table: 'w-full border text-sm relative',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 whitespace-pre-line align-middle text-left font-semibold',
        },
      }).render(document.getElementById('grid'))

      grid.schedule.on('cellClick', (...args) => {
        const cellData = args[1].data

        // Check if the cell is disabled and return early if it is
        if (cellData.disabled === true) {
          return // Don't do anything for disabled cells
        }

        console.log(args)

        Object.assign(booking.data, cellData)
        booking.data.startDate = cellData.date
        booking.data.endDate = cellData.date
        booking.data.timeslot.id = cellData.timeslot?.id || ''
        booking.data.room.id = cellData.room?.id || ''
        booking.data.mode = cellData.label === 'Empty' ? 'create' : 'edit'

        // Set the assigned teacher as default when creating new schedule
        if (cellData.label === 'Empty' && cellData.assignedTeacher) {
          booking.data.teacher.id = cellData.assignedTeacher.id
          booking.data.teacher.name = cellData.assignedTeacher.name
        }

        console.log(args)
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
</script>

<div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="">Room</h2>
    <h2 class="text-center flex-1">Schedule Table (Daily records)</h2>
  </div>

  <!-- Filter row -->
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
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

    <h3 class="text-xl font-semibold text-primary text-center">
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

  <div id="grid" class="overflow-auto max-h-[700px]"></div>
</div>

<ScheduleModal on:refresh={loadSchedules} />

<style>
  /* Add minimum height to prevent shaking when data changes */
  .gridjs-td {
    min-height: 120px;
  }
</style>
