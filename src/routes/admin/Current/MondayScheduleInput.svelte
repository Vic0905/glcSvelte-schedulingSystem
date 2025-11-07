<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import MondayScheduleModal from './MondayScheduleModal.svelte'

  const stickyStyles = `
    #monday-current-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #monday-current-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #monday-current-grid th:nth-child(1), #monday-current-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #monday-current-grid th:nth-child(1) { z-index: 25; }
    #monday-current-grid th:nth-child(2), #monday-current-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #monday-current-grid th:nth-child(2) { z-index: 25; }
  `

  let currentMonday = $state('')
  let timeslots = []
  let rooms = []
  let mondayCurrentGrid = null
  let showModal = $state(false)
  let isCopying = $state(false)
  let isLoading = $state(false)

  let mondaySchedule = $state({
    id: '',
    date: '',
    room: { id: '', name: '' },
    timeslot: { id: '', start: '', end: '' },
    teacher: { id: '', name: '' },
    student: { id: '', englishName: '' },
    subject: { id: '', name: '' },
    mode: 'create',
    assignedTeacher: null,
    originalStudentId: '',
    originalTimeslotId: '',
    originalRoomId: '',
  })

  const initializeMonday = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentMonday = monday.toISOString().split('T')[0]
  }

  const getMondayDisplay = (mondayDate) => {
    const monday = new Date(mondayDate)
    return monday.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const changeWeek = async (weeks) => {
    if (isLoading) return
    const monday = new Date(currentMonday)
    monday.setDate(monday.getDate() + weeks * 7)
    currentMonday = monday.toISOString().split('T')[0]
    await loadMondaySchedules()
  }

  const copyToMondayAdvance = async () => {
    try {
      const schedules = await pb.collection('mondayLessonSchedule').getFullList({
        filter: `date = "${currentMonday}"`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No Monday schedules found', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules
      const uniqueSchedulesMap = {}
      schedules.forEach((schedule) => {
        const key = `${schedule.student}-${schedule.timeslot}-${schedule.room}`
        uniqueSchedulesMap[key] ??= schedule
      })
      const uniqueSchedules = Object.values(uniqueSchedulesMap)

      const existingBookings = await pb
        .collection('mondayAdvanceBooking')
        .getFullList()
        .catch(() => [])

      const schedulesToCopy = uniqueSchedules.filter(
        (schedule) =>
          !existingBookings.some(
            (booking) =>
              booking.timeslot === schedule.timeslot &&
              booking.teacher === schedule.teacher &&
              booking.student === schedule.student &&
              booking.room === schedule.room
          )
      )

      if (schedulesToCopy.length === 0) {
        toast.info('All schedules already copied!', {
          position: 'bottom-right',
          duration: 3000,
          description: 'No new records to copy',
        })
        return
      }

      const confirmMessage =
        `Copy ${schedulesToCopy.length} unique Monday schedule(s) to Monday Advance Booking?\n\n` +
        `Date: ${getMondayDisplay(currentMonday)}\n` +
        (existingBookings.length > 0 ? `(${existingBookings.length} already exist, skipping duplicates)\n` : '') +
        `This will create ${schedulesToCopy.length} Monday advance booking record(s).`

      if (!confirm(confirmMessage)) return

      isCopying = true

      await Promise.all(
        schedulesToCopy.map((schedule) =>
          pb.collection('mondayAdvanceBooking').create({
            timeslot: schedule.timeslot,
            teacher: schedule.teacher,
            student: schedule.student,
            subject: schedule.subject,
            room: schedule.room,
          })
        )
      )

      toast.success('Monday schedules copied successfully!', {
        position: 'bottom-right',
        duration: 3000,
        description: `${schedulesToCopy.length} unique record(s) copied to Monday Advance Booking`,
      })
    } catch (error) {
      console.error('Error copying to Monday advance booking:', error)
      toast.error('Failed to copy schedules', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isCopying = false
    }
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name),
      h('span', { class: 'badge badge-info badge-xs' }, cell.teacher.name),
      h('span', { class: 'badge badge-neutral badge-xs' }, cell.student.englishName),
      h('span', { class: 'badge badge-error badge-xs' }, cell.room.name),
    ])
  }

  async function loadMondaySchedules() {
    if (isLoading) return
    isLoading = true

    try {
      // Fetch only schedules, use cached timeslots/rooms after first load
      const schedulesPromise = pb.collection('mondayLessonSchedule').getList(1, 200, {
        filter: `date = "${currentMonday}"`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      const promises = [schedulesPromise]

      if (!timeslots.length) {
        promises.push(pb.collection('timeSlot').getFullList({ sort: 'start' }))
      }
      if (!rooms.length) {
        promises.push(pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }))
      }

      const results = await Promise.all(promises)
      const schedules = results[0]

      if (results.length > 1 && !timeslots.length) timeslots = results[1]
      if (results.length > 2 && !rooms.length) rooms = results[2]

      // Build schedule map
      const scheduleMap = {}
      for (const s of schedules.items) {
        const rId = s.expand?.room?.id
        const tId = s.expand?.timeslot?.id
        const sId = s.expand?.student?.id
        if (!rId || !tId || !sId) continue

        scheduleMap[rId] ??= {}
        scheduleMap[rId][tId] ??= {}
        scheduleMap[rId][tId][sId] = s
      }

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
            row.push({
              label: 'Empty',
              date: currentMonday,
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              student: { englishName: '', id: '' },
              room: { name: room.name, id: room.id },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          } else {
            const s = Object.values(students)[0]
            row.push({
              label: 'Schedule',
              id: s.id,
              date: currentMonday,
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

      if (mondayCurrentGrid) {
        // Only update data when grid exists, not columns
        const wrapper = document.querySelector('#monday-current-grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        mondayCurrentGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#monday-current-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        // Initial grid creation with columns
        const columns = [
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
            width: '120px',
            formatter: (cell) =>
              cell.disabled
                ? h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value)
                : cell.value,
          },
          ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, id: t.id, width: '160px', formatter: formatCell })),
        ]

        mondayCurrentGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 align-middle text-center',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('monday-current-grid'))

        mondayCurrentGrid.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          Object.assign(mondaySchedule, cellData, {
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          })

          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            mondaySchedule.teacher.id = cellData.assignedTeacher.id
            mondaySchedule.teacher.name = cellData.assignedTeacher.name
          }

          if (mondaySchedule.mode === 'edit') {
            mondaySchedule.originalStudentId = cellData.student?.id || ''
            mondaySchedule.originalTimeslotId = cellData.timeslot?.id || ''
            mondaySchedule.originalRoomId = cellData.room?.id || ''
          }

          showModal = true
        })
      }
    } catch (error) {
      console.error('Error loading Monday schedules:', error)
      toast.error('Failed to load Monday schedules')
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadMondaySchedules, 50)
  }

  onMount(() => {
    initializeMonday()
    loadMondaySchedules()
    pb.collection('mondayLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    mondayCurrentGrid?.destroy()
    mondayCurrentGrid = null
    pb.collection('mondayLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button class="btn btn-success btn-sm" onclick={copyToMondayAdvance} disabled={isCopying}>
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
          Copy to Monday Advance
        {/if}
      </button>
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">{getMondayDisplay(currentMonday)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
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

  <div id="monday-current-grid" class="border rounded-lg"></div>
</div>

<MondayScheduleModal bind:show={showModal} bind:mondaySchedule onSave={loadMondaySchedules} />
