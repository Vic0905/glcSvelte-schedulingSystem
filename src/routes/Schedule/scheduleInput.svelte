<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let rooms = []
  let isCopying = $state(false)

  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day === 0 ? -5 : day === 1 ? 1 : 2 - day
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekDays(startDate) {
    const days = []
    const start = new Date(startDate)
    for (let i = 0; i < 4; i++) {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      days.push(day.toISOString().split('T')[0])
    }
    return days
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    const opt = { month: 'long', day: 'numeric' }
    const opts = { month: 'long', day: 'numeric', year: 'numeric' }
    return `${start.toLocaleDateString('en-US', opt)} - ${end.toLocaleDateString('en-US', opts)}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadSchedules()
  }

  const copyToAdvanceBooking = async () => {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = `(${weekDays.map((d) => `date = "${d}"`).join(' || ')})`

      // Fetch all schedules for the current week
      const schedules = await pb.collection('lessonSchedule').getFullList({
        filter: dateFilter,
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules (one per student-timeslot-room combination)
      const uniqueSchedulesMap = {}
      schedules.forEach((schedule) => {
        const key = `${schedule.student}-${schedule.timeslot}-${schedule.room}`
        if (!uniqueSchedulesMap[key]) {
          uniqueSchedulesMap[key] = schedule
        }
      })
      const uniqueSchedules = Object.values(uniqueSchedulesMap)

      // Check if any records already exist in advanceBooking
      const existingBookings = await pb
        .collection('advanceBooking')
        .getFullList({
          filter: dateFilter,
        })
        .catch(() => [])

      // Filter out schedules that already exist in advanceBooking
      const schedulesToCopy = uniqueSchedules.filter((schedule) => {
        return !existingBookings.some(
          (booking) =>
            booking.timeslot === schedule.timeslot &&
            booking.teacher === schedule.teacher &&
            booking.student === schedule.student &&
            booking.room === schedule.room
        )
      })

      if (schedulesToCopy.length === 0) {
        toast.info('All schedules already copied!', {
          position: 'bottom-right',
          duration: 3000,
          description: 'No new records to copy for this week',
        })
        return
      }

      const confirmMessage =
        `Copy ${schedulesToCopy.length} unique schedule(s) to Advance Booking?\n\n` +
        `Week: ${getWeekRangeDisplay(weekStart)}\n` +
        (existingBookings.length > 0 ? `(${existingBookings.length} already exist, skipping duplicates)\n` : '') +
        `This will create ${schedulesToCopy.length} advance booking record(s).`

      if (!confirm(confirmMessage)) return

      isCopying = true

      // Copy each unique schedule to advanceBooking collection
      const copyPromises = schedulesToCopy.map((schedule) => {
        const bookingData = {
          date: schedule.date,
          timeslot: schedule.timeslot,
          teacher: schedule.teacher,
          student: schedule.student,
          subject: schedule.subject,
          room: schedule.room,
          status: 'pending',
        }
        return pb.collection('advanceBooking').create(bookingData)
      })

      await Promise.all(copyPromises)

      toast.success('Schedules copied successfully!', {
        position: 'bottom-right',
        duration: 3000,
        description: `${schedulesToCopy.length} unique record(s) copied to Advance Booking`,
      })
    } catch (error) {
      console.error('Error copying to advance booking:', error)
      toast.error('Failed to copy schedules', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isCopying = false
    }
  }

  const createBadge = (text, color) => h('span', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
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
      formatter: (cell) =>
        cell.disabled
          ? h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value)
          : cell.value,
    },
    {
      name: 'Room',
      width: '100px',
      formatter: (cell) =>
        cell.disabled
          ? h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value)
          : cell.value,
    },
    ...timeslots.map((t) => ({
      name: `${t.start} - ${t.end}`,
      id: t.id,
      width: '160px',
      formatter: formatCell,
    })),
  ]

  async function loadSchedules() {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Fetch all data in parallel
      const [timeslotsData, roomsData, schedules] = await Promise.all([
        pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('lessonSchedule').getList(1, 200, {
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
        }),
      ])

      timeslots = timeslotsData
      rooms = roomsData

      // Build schedule lookup: room -> timeslot -> student -> schedule
      const scheduleMap = {}
      schedules.items.forEach((s) => {
        const rId = s.expand.room.id
        const tId = s.expand.timeslot.id
        const sId = s.expand.student.id

        if (!scheduleMap[rId]) scheduleMap[rId] = {}
        if (!scheduleMap[rId][tId]) scheduleMap[rId][tId] = {}
        scheduleMap[rId][tId][sId] = s
      })

      // Build table data
      const data = rooms.map((room) => {
        const teacher = room.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Room', value: room.name, disabled: true },
        ]

        timeslots.forEach((ts) => {
          const students = scheduleMap[room.id]?.[ts.id]

          if (!students || Object.keys(students).length === 0) {
            // Empty slot
            row.push({
              label: 'Empty',
              date: weekStart,
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              student: { englishName: '', id: '' },
              room: { name: room.name, id: room.id },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          } else {
            // Use first schedule entry
            const s = Object.values(students)[0]
            row.push({
              label: 'Schedule',
              id: s.id,
              date: weekStart,
              subject: { name: s.expand?.subject?.name || '', id: s.expand?.subject?.id || '' },
              teacher: { name: s.expand?.teacher?.name || '', id: s.expand?.teacher?.id || '' },
              student: { englishName: s.expand?.student?.englishName || '', id: s.expand?.student?.id || '' },
              room: { name: room.name, id: room.id },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          }
        })

        return row
      })

      // Initialize or update grid
      if (grid.schedule) {
        grid.schedule.updateConfig({ data }).forceRender()
      } else {
        grid.schedule = new Grid({
          columns: buildColumns(),
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-sm',
            th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
            td: 'border p-2 align-middle text-center',
          },
        }).render(document.getElementById('grid'))

        grid.schedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          Object.assign(booking.data, cellData, {
            startDate: weekStart,
            endDate: endDate.toISOString().split('T')[0],
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          })

          // Auto-assign teacher for empty slots
          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            booking.data.teacher.id = cellData.assignedTeacher.id
            booking.data.teacher.name = cellData.assignedTeacher.name
          }

          // Store originals for edit mode
          if (booking.data.mode === 'edit') {
            booking.data.originalStudentId = cellData.student?.id || ''
            booking.data.originalTimeslotId = cellData.timeslot?.id || ''
            booking.data.originalRoomId = cellData.room?.id || ''
          }

          editModal.showModal()
        })
      }
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
    if (grid.schedule) {
      grid.schedule.destroy()
      grid.schedule = null
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Room</h2>
    <h2 class="text-center flex-1">Schedule Table (Weekly)</h2>
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button class="btn btn-success btn-sm" onclick={copyToAdvanceBooking} disabled={isCopying}>
        {#if isCopying}
          <span class="loading loading-spinner loading-sm"></span>
          Copying...
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          Copy to Advance Booking
        {/if}
      </button>
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
    </div>
  </div>

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

  <div id="grid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>

<ScheduleModal on:refresh={loadSchedules} />
