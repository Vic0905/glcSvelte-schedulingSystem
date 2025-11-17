<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #grid th:nth-child(1), #grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #grid th:nth-child(1) { z-index: 25; }
    #grid th:nth-child(2), #grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #grid th:nth-child(2) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let rooms = []
  let isCopying = $state(false)
  let isLoading = $state(false)
  let abortController = null

  function getWeekStart(date) {
    const d = new Date(date)
    const diff = d.getDay() === 0 ? -5 : d.getDay() === 1 ? 1 : 2 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekDays(startDate) {
    const start = new Date(startDate)
    return Array.from({ length: 4 }, (_, i) => {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      return day.toISOString().split('T')[0]
    })
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    return `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeWeek = async (weeks) => {
    if (isLoading) return

    // Cancel any pending requests
    if (abortController) {
      abortController.abort()
    }

    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    await loadSchedules()
  }

  const copyToAdvanceBooking = async () => {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = `(${weekDays.map((d) => `date = "${d}"`).join(' || ')})`

      const schedules = await pb.collection('lessonSchedule').getFullList({
        filter: dateFilter,
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
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
        .collection('advanceBooking')
        .getFullList({ filter: dateFilter })
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

      await Promise.all(
        schedulesToCopy.map((schedule) =>
          pb.collection('advanceBooking').create({
            date: schedule.date,
            timeslot: schedule.timeslot,
            teacher: schedule.teacher,
            student: schedule.student,
            subject: schedule.subject,
            room: schedule.room,
            status: 'pending',
          })
        )
      )

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

  //
  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name),
      h('span', { class: 'badge badge-info badge-xs' }, cell.teacher.name),
      h('span', { class: 'badge badge-neutral badge-xs' }, cell.student.englishName),
      h('span', { class: 'badge badge-error badge-xs' }, cell.room.name),
    ])
  }

  async function loadSchedules() {
    if (isLoading) return

    // Cancel previous request if still pending
    if (abortController) {
      abortController.abort()
    }

    // Create new abort controller
    abortController = new AbortController()
    const signal = abortController.signal

    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Build promises array conditionally for better performance
      const promises = []

      // Only fetch timeslots if not cached
      if (!timeslots.length) {
        promises.push(pb.collection('timeSlot').getFullList({ sort: 'start' }))
      }

      // Only fetch rooms if not cached
      if (!rooms.length) {
        promises.push(pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }))
      }

      // Always fetch schedules (use getFullList for all records)
      promises.push(
        pb.collection('lessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
        })
      )

      const results = await Promise.all(promises)

      // Check if request was cancelled
      if (signal.aborted) {
        return
      }

      // Parse results based on what was fetched
      let schedules
      if (!timeslots.length && !rooms.length) {
        timeslots = results[0]
        rooms = results[1]
        schedules = results[2]
      } else if (!timeslots.length) {
        timeslots = results[0]
        schedules = results[1]
      } else if (!rooms.length) {
        rooms = results[0]
        schedules = results[1]
      } else {
        schedules = results[0]
      }

      // Build schedule map
      const scheduleMap = {}
      for (const s of schedules) {
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
              date: weekStart,
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

      // Check again if cancelled before updating UI
      if (signal.aborted) {
        return
      }

      if (grid.schedule) {
        // OPTIMIZATION: Only update data, not columns (columns never change)
        const wrapper = document.querySelector('#grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        grid.schedule.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        // Initial grid creation - only happens once
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
          ...timeslots.map((t) => ({
            name: `${t.start} - ${t.end}`,
            id: t.id,
            width: '160px',
            formatter: formatCell,
          })),
        ]

        grid.schedule = new Grid({
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
        }).render(document.getElementById('grid'))

        grid.schedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          booking.data = {
            ...booking.data,
            ...cellData,
            subject: cellData.subject ?? { name: '', id: '' },
            teacher: cellData.teacher ?? { name: '', id: '' },
            student: cellData.student ?? { englishName: '', id: '' },
            room: cellData.room ?? { name: '', id: '' },
            timeslot: cellData.timeslot ?? { id: '', start: '', end: '' },
            startDate: weekStart,
            endDate: endDate.toISOString().split('T')[0],
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          }

          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            booking.data.teacher = {
              id: cellData.assignedTeacher.id,
              name: cellData.assignedTeacher.name,
            }
          }

          if (booking.data.mode === 'edit') {
            booking.data.originalStudentId = cellData.student?.id || ''
            booking.data.originalTimeslotId = cellData.timeslot?.id || ''
            booking.data.originalRoomId = cellData.room?.id || ''
          }

          const modal = document.getElementById('editModal')
          if (modal) {
            modal.showModal()
          }
        })
      }
    } catch (error) {
      // Don't show error if request was cancelled
      if (error.name === 'AbortError' || signal.aborted) {
        console.log('Request cancelled')
        return
      }

      console.error('Error loading schedules:', error)
      toast.error('Failed to load schedules')
    } finally {
      isLoading = false
      abortController = null
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    if (isLoading) return
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadSchedules, 50)
  }

  onMount(() => {
    // Don't destroy grid on mount - let it persist
    if (!grid.schedule) {
      loadSchedules()
    }
    pb.collection('lessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    if (abortController) {
      abortController.abort()
    }
    grid.schedule?.destroy()
    grid.schedule = null
    pb.collection('lessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">MTM Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button
        class="btn btn-success btn-sm flex items-center gap-2"
        onclick={copyToAdvanceBooking}
        disabled={isCopying}
      >
        {#if isCopying}
          <span class="loading loading-spinner loading-sm"></span>
          Copying...
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

    <h3 class="text-xl font-semibold text-primary text-center mr-20">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span>Subject</div>
      <div class="flex gap-1"><span class="badge badge-info badge-xs"></span>Teacher</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span>Student</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span>Room</div>
    </div>
  </div>

  <div id="grid" class="border rounded-lg"></div>
</div>

<ScheduleModal on:refresh={loadSchedules} />
