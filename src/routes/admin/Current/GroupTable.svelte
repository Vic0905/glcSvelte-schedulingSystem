<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import GroupModal from './GroupModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(1), #group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(1) { z-index: 25; }
    #group-grid th:nth-child(2), #group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(2) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let groupModal
  let isCopying = $state(false)
  let isLoading = $state(false)
  let abortController = null
  let scrollPositions = $state({ top: 0, left: 0 })

  // Cache for frequently accessed data
  const cache = {
    groupSchedules: null,
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
    isValid: () => cache.groupSchedules && Date.now() - cache.lastFetch < cache.cacheDuration,
    invalidate: () => {
      cache.groupSchedules = null
      cache.lastFetch = 0
    },
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
    const wrapper = document.querySelector('#group-grid .gridjs-wrapper')
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
      const wrapper = document.querySelector('#group-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  // Week navigation with caching
  const changeWeek = async (weeks) => {
    if (isLoading) return
    abortController?.abort()

    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)

    // Invalidate cache on week change
    cache.invalidate()
    await loadGroupSchedules(true)
  }

  // Enhanced copy to advance booking with caching
  const copyToAdvanceBooking = async () => {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = `(${getDateFilter(weekDays)})`

      // Use cache if available
      let schedules
      if (cache.isValid()) {
        schedules = cache.groupSchedules
      } else {
        schedules = await pb.collection('groupLessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
        })
      }

      if (schedules.length === 0) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules using Map for better performance
      const uniqueSchedulesMap = new Map()
      schedules.forEach((schedule) => {
        const key = `${schedule.timeslot}-${schedule.grouproom}-${schedule.subject}-${schedule.teacher}`
        if (!uniqueSchedulesMap.has(key)) {
          uniqueSchedulesMap.set(key, schedule)
        }
      })
      const uniqueSchedules = Array.from(uniqueSchedulesMap.values())

      // Get existing bookings in parallel
      const existingBookings = await pb
        .collection('groupAdvanceBooking')
        .getFullList()
        .catch(() => [])

      // Filter out existing bookings using Set for O(1) lookup
      const existingSet = new Set(
        existingBookings.map(
          (booking) => `${booking.timeslot}-${booking.teacher}-${booking.subject}-${booking.grouproom}`
        )
      )

      const schedulesToCopy = uniqueSchedules.filter(
        (schedule) =>
          !existingSet.has(`${schedule.timeslot}-${schedule.teacher}-${schedule.subject}-${schedule.grouproom}`)
      )

      if (schedulesToCopy.length === 0) {
        toast.info('All schedules already copied!', {
          position: 'bottom-right',
          duration: 3000,
          description: 'No new records to copy for this week',
        })
        return
      }

      const confirmMessage = [
        `Copy ${schedulesToCopy.length} unique group schedule(s) to Advance Booking?`,
        `Week: ${getWeekRangeDisplay(weekStart)}`,
        existingBookings.length > 0 ? `(Skipping ${uniqueSchedules.length - schedulesToCopy.length} duplicate(s))` : '',
        `This will create ${schedulesToCopy.length} advance booking record(s).`,
      ]
        .filter(Boolean)
        .join('\n\n')

      if (!confirm(confirmMessage)) return

      isCopying = true

      // Batch creation for better performance
      const batchSize = 10
      for (let i = 0; i < schedulesToCopy.length; i += batchSize) {
        const batch = schedulesToCopy.slice(i, i + batchSize)
        await Promise.all(
          batch.map((schedule) =>
            pb.collection('groupAdvanceBooking').create({
              date: schedule.date,
              timeslot: schedule.timeslot,
              teacher: schedule.teacher,
              student: schedule.student,
              subject: schedule.subject,
              grouproom: schedule.grouproom,
              status: 'pending',
            })
          )
        )
      }

      toast.success('Group schedules copied successfully!', {
        position: 'bottom-right',
        duration: 3000,
        description: `${schedulesToCopy.length} record(s) copied to Group Advance Booking`,
      })
    } catch (error) {
      console.error('Error copying to group advance booking:', error)
      toast.error('Failed to copy group schedules', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isCopying = false
    }
  }

  // Enhanced cell formatter
  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    const elements = [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name || 'No Subject'),
      h('div', { class: 'badge badge-error badge-xs' }, cell.teacher.name || 'No Teacher'),
    ]

    // Add student count badge
    const studentCount = cell.students?.length || 0
    if (studentCount > 0) {
      elements.push(
        h('div', { class: 'badge badge-neutral badge-xs' }, `${studentCount} student${studentCount !== 1 ? 's' : ''}`)
      )
    }

    return h('div', { class: 'flex flex-col gap-1 items-center text-xs' }, elements)
  }

  // Enhanced load function with caching
  async function loadGroupSchedules(forceRefresh = false) {
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
        schedules = cache.groupSchedules
      } else {
        // Parallel fetching with caching
        const promises = []
        if (!timeslots.length) promises.push(pb.collection('timeslot').getFullList({ sort: 'start' }))
        promises.push(pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }))
        promises.push(
          pb.collection('groupLessonSchedule').getFullList({
            filter: dateFilter,
            expand: 'teacher,student,subject,grouproom,timeslot',
            $autoCancel: false,
          })
        )

        const results = await Promise.all(promises)
        if (signal.aborted) return

        // Parse results
        let idx = 0
        if (!timeslots.length) timeslots = results[idx++]
        const groupRooms = results[idx++]
        schedules = results[idx]

        // Update cache
        cache.groupSchedules = schedules
        cache.lastFetch = Date.now()

        // Build schedule map using Map for better performance
        const scheduleMap = new Map()
        for (const s of schedules) {
          const gr = s.expand?.grouproom
          const ts = s.expand?.timeslot
          if (!gr || !ts) continue

          if (!scheduleMap.has(gr.id)) {
            scheduleMap.set(gr.id, new Map())
          }
          const roomMap = scheduleMap.get(gr.id)
          if (!roomMap.has(ts.id)) {
            roomMap.set(ts.id, new Map())
          }

          const key = `${s.subject}_${s.teacher}`
          roomMap.get(ts.id).set(key, s)
        }

        // Build table data efficiently
        const data = groupRooms.map((gr) => {
          const teacher = gr.expand?.teacher
          const row = [
            { label: 'Teacher', value: teacher?.name || '-', disabled: true },
            { label: 'Group Room', value: gr.name, disabled: true },
          ]

          const roomSchedules = scheduleMap.get(gr.id)

          // Use for loop instead of forEach for better performance
          for (let i = 0; i < timeslots.length; i++) {
            const ts = timeslots[i]
            const timeslotSchedules = roomSchedules?.get(ts.id)

            if (!timeslotSchedules || timeslotSchedules.size === 0) {
              row.push({
                label: 'Empty',
                date: weekStart,
                subject: { name: '', id: '' },
                teacher: { name: '', id: '' },
                students: [],
                groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
                timeslot: { id: ts.id, start: ts.start, end: ts.end },
                assignedTeacher: teacher,
              })
            } else {
              const s = Array.from(timeslotSchedules.values())[0]

              let studentsData = []
              if (s.expand?.student && Array.isArray(s.expand.student)) {
                studentsData = s.expand.student.map((student) => ({
                  englishName: student.englishName || '',
                  id: student.id || '',
                }))
              } else if (s.student && Array.isArray(s.student)) {
                studentsData = s.student.map((id) => ({ name: `Student ${id}`, id }))
              }

              row.push({
                label: 'Schedule',
                id: s.id || '',
                date: weekStart,
                subject: { name: s.expand?.subject?.name || '', id: s.expand?.subject?.id || '' },
                teacher: { name: s.expand?.teacher?.name || '', id: s.expand?.teacher?.id || '' },
                students: studentsData,
                groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
                timeslot: { id: ts.id, start: ts.start, end: ts.end },
                assignedTeacher: teacher,
              })
            }
          }

          return row
        })

        if (signal.aborted) return

        // Update or create grid
        if (grid.groupSchedule) {
          grid.groupSchedule
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
                h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
            },
            {
              name: 'Group Room',
              width: '120px',
              formatter: (cell) =>
                h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
            },
            ...timeslots.map((t) => ({
              name: `${t.start} - ${t.end}`,
              id: t.id,
              width: '160px',
              formatter: formatCell,
            })),
          ]

          grid.groupSchedule = new Grid({
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
            style: {
              table: {
                'border-collapse': 'collapse',
                'table-layout': 'fixed',
              },
            },
          }).render(document.getElementById('group-grid'))

          grid.groupSchedule.on('cellClick', (...args) => {
            const cellData = args[1].data
            if (cellData.disabled) return

            const endDate = new Date(weekStart)
            endDate.setDate(endDate.getDate() + 3)

            booking.data = {
              ...cellData,
              startDate: weekStart,
              endDate: endDate.toISOString().split('T')[0],
              timeslot: { id: cellData.timeslot?.id || '', ...cellData.timeslot },
              groupRoom: { ...cellData.groupRoom },
              students: cellData.students || [],
              mode: cellData.label === 'Empty' ? 'create' : 'edit',
            }

            if (booking.data.mode === 'edit') {
              booking.data.originalTeacherId = cellData.teacher.id
              booking.data.originalSubjectId = cellData.subject.id
              booking.data.originalTimeslotId = cellData.timeslot.id
              booking.data.originalGroupRoomId = cellData.groupRoom.id
            }

            if (cellData.label === 'Empty' && cellData.assignedTeacher) {
              booking.data.teacher = {
                id: cellData.assignedTeacher.id,
                name: cellData.assignedTeacher.name,
              }
            }

            if (groupModal?.showModal) {
              groupModal.showModal()
            } else {
              toast.error('Group modal not initialized')
            }
          })
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) {
        console.log('Request cancelled')
        return
      }
      console.error('Error loading group schedules:', error)
      toast.error('Failed to load schedules')
    } finally {
      isLoading = false
      abortController = null
    }
  }

  // Debounced reload with cache invalidation
  let reloadTimeout
  const debouncedReload = () => {
    if (isLoading) return
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
      cache.invalidate() // Invalidate cache on updates
      loadGroupSchedules(true)
    }, 150)
  }

  onMount(() => {
    if (!grid.groupSchedule) loadGroupSchedules()
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    abortController?.abort()
    grid.groupSchedule?.destroy()
    grid.groupSchedule = null
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">GRP Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button class="btn btn-ghost btn-sm" onclick={copyToAdvanceBooking} disabled={isCopying}>
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

    <h3 class="text-xl font-semibold text-center mr-20">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span> Subject</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span> Teacher</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span> Student(s)</div>
    </div>
  </div>

  <div id="group-grid" class="border rounded-lg"></div>
</div>

<GroupModal
  on:refresh={() => {
    saveScrollPosition()
    cache.invalidate()
    loadGroupSchedules(true)
  }}
  bind:this={groupModal}
/>
