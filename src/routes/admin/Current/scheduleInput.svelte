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
  let isDeleting = $state(false)
  let isLoading = $state(false)
  let abortController = null
  let scrollPositions = $state({ top: 0, left: 0 })

  // Cache for frequently accessed data
  const cache = {
    schedules: null,
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
    isValid: () => cache.schedules && Date.now() - cache.lastFetch < cache.cacheDuration,
  }

  // Utility functions
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
    const opts = { month: 'long', day: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }

  function getDateFilter(weekDays) {
    return weekDays.map((d) => `date = "${d}"`).join(' || ')
  }

  // Save scroll position before any updates
  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#grid .gridjs-wrapper')
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
      const wrapper = document.querySelector('#grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  // Week navigation
  const changeWeek = async (weeks) => {
    if (isLoading) return
    abortController?.abort()

    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)

    // Invalidate cache on week change
    cache.schedules = null
    await loadSchedules(true)
  }

  // Copy to advance booking
  const copyToAdvanceBooking = async () => {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = getDateFilter(weekDays)

      const [schedules, existingBookings] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb
          .collection('advanceBooking')
          .getFullList({ filter: dateFilter })
          .catch(() => []),
      ])

      if (!schedules.length) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Deduplicate schedules using Map for better performance
      const uniqueMap = new Map()
      for (const s of schedules) {
        const key = `${s.student}-${s.timeslot}-${s.room}`
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, s)
        }
      }
      const uniqueSchedules = Array.from(uniqueMap.values())

      // Filter out existing bookings using Set for O(1) lookup
      const existingSet = new Set(existingBookings.map((b) => `${b.timeslot}-${b.teacher}-${b.student}-${b.room}`))
      const schedulesToCopy = uniqueSchedules.filter(
        (s) => !existingSet.has(`${s.timeslot}-${s.teacher}-${s.student}-${s.room}`)
      )

      if (!schedulesToCopy.length) {
        toast.info('All schedules already copied!', {
          position: 'bottom-right',
          duration: 3000,
          description: 'No new records to copy for this week',
        })
        return
      }

      const confirmMsg = [
        `Copy ${schedulesToCopy.length} unique schedule(s) to Advance Booking?`,
        `Week: ${getWeekRangeDisplay(weekStart)}`,
        existingBookings.length > 0 ? `(${existingBookings.length} already exist, skipping duplicates)` : '',
        `This will create ${schedulesToCopy.length} advance booking record(s).`,
      ]
        .filter(Boolean)
        .join('\n\n')

      if (!confirm(confirmMsg)) return

      isCopying = true

      // Batch create for better performance
      const batchSize = 10
      for (let i = 0; i < schedulesToCopy.length; i += batchSize) {
        const batch = schedulesToCopy.slice(i, i + batchSize)
        await Promise.all(
          batch.map((s) =>
            pb.collection('advanceBooking').create({
              date: s.date,
              timeslot: s.timeslot,
              teacher: s.teacher,
              student: s.student,
              subject: s.subject,
              room: s.room,
              status: 'pending',
            })
          )
        )
      }

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

  // Delete current week schedules using batch API
  const deleteCurrentWeekSchedules = async () => {
    try {
      const weekDays = getWeekDays(weekStart)
      const weekRangeDisplay = getWeekRangeDisplay(weekStart)

      // First, get all schedule IDs for this week
      const schedules = await pb.collection('lessonSchedule').getFullList({
        filter: getDateFilter(weekDays),
        fields: 'id',
      })

      if (!schedules.length) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
        return
      }

      const scheduleIds = schedules.map((s) => s.id)
      const scheduleCount = scheduleIds.length

      const confirmMsg = [
        `Delete ALL schedules for this week?`,
        `Week: ${weekRangeDisplay}`,
        `This will delete ${scheduleCount} schedule(s).`,
        'This action cannot be undone!',
      ].join('\n\n')

      if (!confirm(confirmMsg)) return

      isDeleting = true

      // Use PocketBase's send method for batch deletion
      // PocketBase doesn't have a direct batch delete method, so we need to use send
      const batchSize = 50 // Delete in batches
      let deletedCount = 0
      let errors = []

      for (let i = 0; i < scheduleIds.length; i += batchSize) {
        const batch = scheduleIds.slice(i, i + batchSize)

        // Delete each record in the batch
        const deletePromises = batch.map((id) =>
          pb
            .collection('lessonSchedule')
            .delete(id)
            .catch((error) => {
              errors.push({ id, error: error.message })
              return null
            })
        )

        const results = await Promise.all(deletePromises)
        deletedCount += results.filter((r) => r !== null).length

        // Optional: show progress for large deletions
        if (scheduleCount > 100) {
          console.log(`Deleted ${deletedCount}/${scheduleCount} schedules...`)
        }
      }

      if (errors.length > 0) {
        console.warn(`Some schedules failed to delete:`, errors)
        toast.warning(`Partially deleted schedules`, {
          position: 'bottom-right',
          duration: 5000,
          description: `Deleted ${deletedCount}/${scheduleCount} schedules. ${errors.length} failed.`,
        })
      } else {
        toast.success('Schedules deleted successfully!', {
          position: 'bottom-right',
          duration: 3000,
          description: `${deletedCount} schedule(s) deleted for ${weekRangeDisplay}`,
        })
      }

      // Refresh the grid
      saveScrollPosition()
      cache.schedules = null
      await loadSchedules(true)
    } catch (error) {
      console.error('Error deleting schedules:', error)
      toast.error('Failed to delete schedules', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isDeleting = false
    }
  }

  // Cell formatter
  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name),
      h('span', { class: 'badge badge-neutral badge-xs' }, cell.student.englishName),
      h('span', { class: 'badge badge-error badge-xs' }, cell.teacher.name),
    ])
  }

  // Build cell data
  function buildCellData(schedule, room, timeslot, teacher) {
    const base = {
      room: { name: room.name, id: room.id },
      timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
      assignedTeacher: teacher,
    }

    if (!schedule) {
      return {
        ...base,
        label: 'Empty',
        subject: { name: '', id: '' },
        teacher: { name: '', id: '' },
        student: { englishName: '', id: '' },
      }
    }

    return {
      ...base,
      label: 'Schedule',
      id: schedule.id,
      subject: { name: schedule.expand?.subject?.name || '', id: schedule.expand?.subject?.id || '' },
      teacher: { name: schedule.expand?.teacher?.name || '', id: schedule.expand?.teacher?.id || '' },
      student: { englishName: schedule.expand?.student?.englishName || '', id: schedule.expand?.student?.id || '' },
    }
  }

  // Load schedules
  async function loadSchedules(forceRefresh = false) {
    if (isLoading) return

    abortController?.abort()
    abortController = new AbortController()
    const { signal } = abortController

    // Save scroll position before loading
    saveScrollPosition()

    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = getDateFilter(weekDays)

      // Use cache if available and not forcing refresh
      let schedules
      if (!forceRefresh && cache.isValid()) {
        schedules = cache.schedules
      } else {
        // Parallel fetching with caching
        const promises = []
        if (!timeslots.length) promises.push(pb.collection('timeSlot').getFullList({ sort: 'start' }))
        if (!rooms.length) promises.push(pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }))
        promises.push(
          pb.collection('lessonSchedule').getFullList({
            filter: dateFilter,
            expand: 'teacher,student,subject,room,timeslot',
            $autoCancel: false,
          })
        )

        const results = await Promise.all(promises)
        if (signal.aborted) return

        // Parse results
        let idx = 0
        if (!timeslots.length) timeslots = results[idx++]
        if (!rooms.length) rooms = results[idx++]
        schedules = results[idx]

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
        if (rId && tId && sId) {
          if (!scheduleMap.has(rId)) {
            scheduleMap.set(rId, new Map())
          }
          const roomMap = scheduleMap.get(rId)
          if (!roomMap.has(tId)) {
            roomMap.set(tId, new Map())
          }
          roomMap.get(tId).set(sId, s)
        }
      }

      // Build table data more efficiently
      const data = rooms.map((room) => {
        const teacher = room.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Room', value: room.name, disabled: true },
        ]

        const roomSchedules = scheduleMap.get(room.id)

        // Use for loop instead of forEach for better performance
        for (let i = 0; i < timeslots.length; i++) {
          const ts = timeslots[i]
          const students = roomSchedules?.get(ts.id)
          const schedule = students ? Array.from(students.values())[0] : null
          row.push(buildCellData(schedule, room, ts, teacher))
        }

        return row
      })

      if (signal.aborted) return

      // Update or create grid
      if (grid.schedule) {
        grid.schedule
          .updateConfig({
            data,
            style: {
              table: {
                'border-collapse': 'collapse',
                'table-layout': 'fixed', // Prevents layout shifts
              },
            },
          })
          .forceRender()

        // Restore scroll position after DOM update
        restoreScrollPosition()
      } else {
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
            table: 'w-full border text-xs !border-collapse',
            th: 'bg-base-200 p-2 border-t border-d !border-x-0 text-center',
            td: 'border-t border-d !border-x-0 p-2 align-middle text-center',
          },
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed',
            },
          },
        }).render(document.getElementById('grid'))

        grid.schedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          booking.data = {
            ...cellData,
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

          document.getElementById('editModal')?.showModal()
        })
      }
    } catch (error) {
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

  // Debounced reload
  let reloadTimeout
  const debouncedReload = () => {
    if (isLoading) return
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
      cache.schedules = null // Invalidate cache on updates
      loadSchedules(true)
    }, 150)
  }

  onMount(() => {
    if (!grid.schedule) loadSchedules()
    pb.collection('lessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    abortController?.abort()
    grid.schedule?.destroy()
    grid.schedule = null
    pb.collection('lessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">MTM Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex gap-2">
      <button class="btn btn-ghost btn-sm flex items-center gap-2" onclick={copyToAdvanceBooking} disabled={isCopying}>
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

      <!-- <button
        class="btn btn-error btn-outline btn-sm flex items-center gap-2"
        onclick={deleteCurrentWeekSchedules}
        disabled={isDeleting || isLoading}
      >
        {#if isDeleting}
          <span class="loading loading-spinner loading-sm"></span>
          Deleting...
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          Delete This Week
        {/if}
      </button> -->
    </div>

    <h3 class="text-xl font-semibold text-center mr-20">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span>Subject</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span>Student</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span>Teacher</div>
    </div>
  </div>

  <div id="grid" class="border rounded-lg"></div>
</div>

<ScheduleModal
  on:refresh={() => {
    saveScrollPosition()
    loadSchedules(true)
  }}
/>
