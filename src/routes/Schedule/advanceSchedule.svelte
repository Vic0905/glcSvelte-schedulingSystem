<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import AdvanceBookingModal from './AdvanceBookingModal.svelte'
  import GoLiveModal from './GoLiveModal.svelte'

  let currentWeekStart = $state('')
  let timeslots = []
  let allRooms = []
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
    const dayOfWeek = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + 7)
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  const getWeekDates = (startDate) => {
    const dates = []
    const monday = new Date(startDate)
    for (let i = 0; i < 5; i++) {
      const day = new Date(monday)
      day.setDate(monday.getDate() + i)
      dates.push(day.toISOString().split('T')[0])
    }
    return dates
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
    subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
    teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
    student: { name: item?.expand?.student?.name || '', id: item?.expand?.student?.id || '' },
    room: { name: room, id: roomId },
    timeslot: { id: t.id, start: t.start, end: t.end },
    assignedTeacher: assignedTeacher,
  })

  async function loadAdvanceBookings() {
    if (!timeslots.length) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }
    if (!allRooms.length) {
      allRooms = await pb.collection('room').getFullList({
        sort: 'name',
        expand: 'teacher',
      })
    }
    const records = await pb.collection('advanceBooking').getFullList({
      expand: 'teacher,student,subject,room,timeslot',
    })
    const scheduledRooms = {}
    records.forEach((r) => {
      const roomId = r.expand?.room?.id || r.room
      if (!scheduledRooms[roomId]) {
        scheduledRooms[roomId] = {}
      }
      const key = r.expand?.timeslot?.id || r.timeslot
      scheduledRooms[roomId][key] = r
    })
    const data = allRooms.map((room) => {
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
    if (!advanceGrid || !advanceGrid.columns) {
      const columns = [
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
      if (advanceGrid) {
        requestAnimationFrame(() => {
          advanceGrid.updateConfig({ data }).forceRender()
        })
      } else {
        advanceGrid = new Grid({
          columns: columns,
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
        }).render(document.getElementById('advance-grid'))

        advanceGrid.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled === true) {
            return
          }
          Object.assign(advanceBooking, cellData)
          advanceBooking.timeslot.id = cellData.timeslot?.id || ''
          advanceBooking.room.id = cellData.room?.id || ''
          advanceBooking.mode = cellData.label === 'Empty' ? 'create' : 'edit'
          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            advanceBooking.teacher.id = cellData.assignedTeacher.id
            advanceBooking.teacher.name = cellData.assignedTeacher.name
          }
          showAdvanceModal = true
        })
      }
    } else {
      requestAnimationFrame(() => {
        advanceGrid.updateConfig({ data }).forceRender()
      })
    }
  }

  onMount(() => {
    if (advanceGrid) {
      advanceGrid.destroy()
      advanceGrid = null
    }
    initializeWeek()
    loadAdvanceBookings()
  })
</script>

<div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="">Room</h2>
    <h2 class="text-center flex-1">Advance Schedule Table (Weekly Template)</h2>
  </div>
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-sm font-semibold">Target Week:</label>
    </div>

    <h3 class="text-xl font-semibold text-primary text-center ml-15">
      {getWeekRange(currentWeekStart)}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
      <button class="btn btn-primary btn-sm" onclick={() => (showGoLiveModal = true)}> 🚀 Go Live </button>
    </div>
  </div>

  <div class="alert alert-info mb-4">
    <span
      >ℹ️ Create weekly templates here. When you "Go Live", schedules will be created for Monday-Friday of the selected
      week.</span
    >
  </div>
  <div id="advance-grid" class="overflow-auto max-h-[700px]"></div>
</div>

<AdvanceBookingModal bind:show={showAdvanceModal} bind:advanceBooking onSave={loadAdvanceBookings} />

<GoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />

<style>
  .gridjs-td {
    min-height: 120px;
  }
</style>
