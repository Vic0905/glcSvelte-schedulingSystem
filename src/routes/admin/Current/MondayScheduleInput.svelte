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
  let scrollPositions = $state({ top: 0, left: 0 })

  // Cache for better performance
  const cache = {
    schedules: null,
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
    isValid: () => cache.schedules && Date.now() - cache.lastFetch < cache.cacheDuration,
  }

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
    await loadMondaySchedules(true)
  }

  const copyToMondayAdvance = async () => {
    try {
      // Use cache if available
      let schedules
      if (cache.isValid() && cache.schedules) {
        schedules = cache.schedules
      } else {
        schedules = await pb.collection('mondayLessonSchedule').getFullList({
          filter: `date = "${currentMonday}"`,
          expand: 'teacher,student,subject,room,timeslot',
        })
      }

      if (schedules.length === 0) {
        toast.info('No Monday schedules found', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules using Map for better performance
      const uniqueSchedulesMap = new Map()
      schedules.forEach((schedule) => {
        const key = `${schedule.student}-${schedule.timeslot}-${schedule.room}`
        if (!uniqueSchedulesMap.has(key)) {
          uniqueSchedulesMap.set(key, schedule)
        }
      })
      const uniqueSchedules = Array.from(uniqueSchedulesMap.values())

      const existingBookings = await pb
        .collection('mondayAdvanceBooking')
        .getFullList()
        .catch(() => [])

      // Filter out existing bookings
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

      // Batch create for better performance
      const batchSize = 10
      for (let i = 0; i < schedulesToCopy.length; i += batchSize) {
        const batch = schedulesToCopy.slice(i, i + batchSize)
        await Promise.all(
          batch.map((schedule) =>
            pb.collection('mondayAdvanceBooking').create({
              timeslot: schedule.timeslot,
              teacher: schedule.teacher,
              student: schedule.student,
              subject: schedule.subject,
              room: schedule.room,
              hiddenDetails: true,
            })
          )
        )
      }

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

    if (Array.isArray(cell)) {
      // Multiple schedules in this cell
      return h(
        'div',
        { class: 'flex flex-col gap-1 text-xs items-center' },
        cell.map((schedule) => {
          if (schedule.hiddenDetails) {
            return h('div', { class: 'badge badge-success badge-sm mb-1' }, 'Scheduled')
          }
          return h('div', { class: 'border rounded p-1 mb-1 w-full' }, [
            h('div', { class: 'badge badge-primary badge-xs p-2 mb-1' }, schedule.subject.name),
            h('div', { class: 'badge badge-neutral badge-xs mb-1' }, schedule.student.englishName),
            h('div', { class: 'badge badge-error badge-xs mb-1' }, schedule.teacher.name),
            // h('div', { class: 'badge badge-error badge-xs' }, schedule.room.name),
          ])
        })
      )
    }

    if (cell.hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    // Single schedule
    return h('div', { class: 'flex flex-col gap-1 text-xs items-center' }, [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name),
      h('div', { class: 'badge badge-neutral badge-xs' }, cell.student.englishName),
      h('div', { class: 'badge badge-error badge-xs' }, cell.teacher.name),
      // h('div', { class: 'badge badge-error badge-xs' }, cell.room.name),
    ])
  }

  // Save scroll position before updates
  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#monday-current-grid .gridjs-wrapper')
    if (wrapper) {
      scrollPositions = {
        top: wrapper.scrollTop,
        left: wrapper.scrollLeft,
      }
    }
  }

  // Restore scroll position after updates
  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#monday-current-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  async function loadMondaySchedules(forceRefresh = false) {
    if (isLoading) return

    // Save scroll position before loading
    saveScrollPosition()

    isLoading = true

    try {
      // Use cache if available and not forcing refresh
      let schedules
      if (!forceRefresh && cache.isValid()) {
        schedules = cache.schedules
      } else {
        // Parallel fetching
        const [schedulesData, timeslotsData, roomsData] = await Promise.all([
          pb.collection('mondayLessonSchedule').getFullList({
            // Changed to getFullList to get ALL records
            filter: `date = "${currentMonday}"`,
            expand: 'teacher,student,subject,room,timeslot',
          }),
          timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
          rooms.length ? rooms : pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }),
        ])

        schedules = schedulesData
        if (!timeslots.length) timeslots = timeslotsData
        if (!rooms.length) rooms = roomsData

        console.log(`Loaded ${schedules.length} schedules for ${currentMonday}`)

        // Update cache
        cache.schedules = schedules
        cache.lastFetch = Date.now()
      }

      // Build schedule map using Map for better performance
      const scheduleMap = new Map()
      for (const s of schedules) {
        const rId = s.expand?.room?.id
        const tId = s.expand?.timeslot?.id
        const sId = s.expand?.student?.id
        if (!rId || !tId || !sId) continue

        if (!scheduleMap.has(rId)) {
          scheduleMap.set(rId, new Map())
        }
        const roomMap = scheduleMap.get(rId)
        if (!roomMap.has(tId)) {
          roomMap.set(tId, [])
        }
        roomMap.get(tId).push(s)
      }

      // Build table data efficiently - now each cell can contain multiple schedules
      const data = rooms.map((room) => {
        const roomMap = scheduleMap.get(room.id) || new Map()
        const teacher = room.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Room', value: room.name, disabled: true },
        ]

        // Use for loop for better performance
        for (let i = 0; i < timeslots.length; i++) {
          const ts = timeslots[i]
          const schedulesInSlot = roomMap.get(ts.id) || []

          if (schedulesInSlot.length === 0) {
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
          } else if (schedulesInSlot.length === 1) {
            // Single schedule
            const s = schedulesInSlot[0]
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
              hiddenDetails: s.hiddenDetails || false,
            })
          } else {
            // Multiple schedules - store as array
            const scheduleData = schedulesInSlot.map((s) => ({
              label: 'Schedule',
              id: s.id,
              date: currentMonday,
              subject: { name: s.expand?.subject?.name || '', id: s.expand?.subject?.id || '' },
              teacher: { name: s.expand?.teacher?.name || '', id: s.expand?.teacher?.id || '' },
              student: { englishName: s.expand?.student?.englishName || '', id: s.expand?.student?.id || '' },
              room: { name: room.name, id: room.id },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
              hiddenDetails: s.hiddenDetails || false,
            }))
            row.push(scheduleData)
          }
        }

        return row
      })

      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
        },
        {
          name: 'Room',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      if (mondayCurrentGrid) {
        // Update grid data without full re-render
        mondayCurrentGrid.updateConfig({ columns, data }).forceRender()

        // Restore scroll position
        restoreScrollPosition()
      } else {
        // Initial grid creation
        mondayCurrentGrid = new Grid({
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
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed', // Prevents layout shifts
            },
          },
        }).render(document.getElementById('monday-current-grid'))

        mondayCurrentGrid.on('cellClick', (_, cell) => {
          const cellData = cell.data
          if (cellData.disabled) return

          // Handle multiple schedules - for now, edit the first one
          let scheduleToEdit = cellData
          if (Array.isArray(cellData)) {
            scheduleToEdit = cellData[0]
          }

          Object.assign(mondaySchedule, scheduleToEdit, {
            mode: scheduleToEdit.label === 'Empty' ? 'create' : 'edit',
          })

          if (scheduleToEdit.label === 'Empty' && scheduleToEdit.assignedTeacher) {
            mondaySchedule.teacher.id = scheduleToEdit.assignedTeacher.id
            mondaySchedule.teacher.name = scheduleToEdit.assignedTeacher.name
          }

          if (mondaySchedule.mode === 'edit') {
            mondaySchedule.originalStudentId = scheduleToEdit.student?.id || ''
            mondaySchedule.originalTimeslotId = scheduleToEdit.timeslot?.id || ''
            mondaySchedule.originalRoomId = scheduleToEdit.room?.id || ''
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
    reloadTimeout = setTimeout(() => {
      cache.schedules = null // Invalidate cache on updates
      loadMondaySchedules(true)
    }, 150)
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

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button class="btn btn-success btn-sm" onclick={copyToMondayAdvance} disabled={isCopying || isLoading}>
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

    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getMondayDisplay(currentMonday)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
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
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
        <span>Scheduled</span>
      </div>
    </div>
  </div>

  <div id="monday-current-grid" class="border rounded-lg"></div>
</div>

<MondayScheduleModal
  bind:show={showModal}
  bind:mondaySchedule
  onSave={() => {
    saveScrollPosition()
    loadMondaySchedules(true)
  }}
/>
