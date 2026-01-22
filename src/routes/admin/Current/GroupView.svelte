<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #groupGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #groupGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #groupGrid th:nth-child(1), #groupGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #groupGrid th:nth-child(1) { z-index: 25; }
    #groupGrid th:nth-child(2), #groupGrid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #groupGrid th:nth-child(2) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let groupGrid = null
  let timeslots = []
  let groupRooms = []
  let isLoading = $state(false)
  let abortController = null
  let scrollPositions = $state({ top: 0, left: 0 })

  // Cache for frequently accessed data
  const cache = {
    groupSchedules: null,
    timeslots: null,
    groupRooms: null,
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
    isValid: () => cache.groupSchedules && Date.now() - cache.lastFetch < cache.cacheDuration,
    invalidate: () => {
      cache.groupSchedules = null
      cache.timeslots = null
      cache.groupRooms = null
      cache.lastFetch = 0
    },
  }

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
    const wrapper = document.querySelector('#groupGrid .gridjs-wrapper')
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
      const wrapper = document.querySelector('#groupGrid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  const changeWeek = async (weeks) => {
    if (isLoading) return
    abortController?.abort()

    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)

    // Invalidate cache on week change
    cache.invalidate()
    await loadGroupSchedule(true)
  }

  const formatCell = (cellData) => {
    if (!cellData?.schedule) return h('span', {}, '—')
    const { schedule, studentName } = cellData
    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, schedule.subject?.name ?? 'No Subject'),
      h('span', { class: 'badge badge-neutral badge-xs' }, studentName),
      h('span', { class: 'badge badge-error badge-xs' }, schedule.teacher?.name ?? 'No Teacher'),
    ])
  }

  async function loadGroupSchedule(forceRefresh = false) {
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
      let schedules, timeslotsData, groupRoomsData

      if (!forceRefresh && cache.isValid()) {
        schedules = cache.groupSchedules
        timeslotsData = cache.timeslots
        groupRoomsData = cache.groupRooms
      } else {
        // Parallel fetching with caching
        const promises = []

        if (!timeslots.length || !cache.timeslots) {
          promises.push(pb.collection('timeSlot').getFullList({ sort: 'start' }))
        } else {
          promises.push(Promise.resolve(timeslots))
        }

        if (!groupRooms.length || !cache.groupRooms) {
          promises.push(pb.collection('grouproom').getFullList({ sort: 'name' }))
        } else {
          promises.push(Promise.resolve(groupRooms))
        }

        promises.push(
          pb.collection('groupLessonSchedule').getList(1, 500, {
            filter: dateFilter,
            expand: 'teacher,student,subject,grouproom,timeslot',
            $autoCancel: false,
          })
        )

        const results = await Promise.all(promises)
        if (signal.aborted) return

        // Parse results
        let idx = 0
        timeslotsData = results[idx++]
        groupRoomsData = results[idx++]
        const scheduleResult = results[idx]

        // Update cache
        cache.groupSchedules = scheduleResult.items
        cache.timeslots = timeslotsData
        cache.groupRooms = groupRoomsData
        cache.lastFetch = Date.now()

        timeslots = timeslotsData
        groupRooms = groupRoomsData
        schedules = scheduleResult.items
      }

      // Build schedule map using Map for better performance
      const scheduleMap = new Map()
      for (const s of schedules) {
        const roomId = s.expand?.grouproom?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!roomId || !timeslotId) continue

        if (!scheduleMap.has(roomId)) {
          scheduleMap.set(roomId, new Map())
        }
        const roomMap = scheduleMap.get(roomId)

        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        const existing = roomMap.get(timeslotId)

        if (!existing || students.length > (existing.students?.length || 0)) {
          roomMap.set(timeslotId, {
            subject: s.expand?.subject,
            teacher: s.expand?.teacher,
            students,
          })
        }
      }

      if (signal.aborted) return

      // Build table data efficiently
      const data = groupRooms.flatMap((room, roomIndex) => {
        const maxSlots = Math.min(room.maxstudents || 30, 50)
        const roomSchedule = scheduleMap.get(room.id) || new Map()

        const rows = Array.from({ length: maxSlots }, (_, i) => {
          const slot = i + 1
          const rowData = [
            room.name,
            `Slot ${slot}`,
            ...timeslots.map((ts) => {
              const schedule = roomSchedule.get(ts.id)
              const student = schedule?.students?.[i]
              return student ? { schedule, studentName: student.englishName || student.name || 'Unknown' } : null
            }),
          ]
          return rowData
        })

        // Add separator row with room name (matching the template style)
        if (roomIndex < groupRooms.length - 1) {
          rows.push([
            h(
              'div',
              {
                class: 'text-xs font-bold italic opacity-80',
                innerHTML: `┄┄┄ ${room.name} end ┄┄┄`,
              },
              ''
            ),
            '',
            ...timeslots.map(() =>
              h('div', {
                class: 'h-[1px] w-full bg-gradient-to-r from-transparent via-primary/20 to-transparent my-1',
              })
            ),
          ])
        }

        return rows
      })

      if (signal.aborted) return

      const columns = [
        { name: 'Group Room', width: '120px' },
        { name: 'S-Slot', width: '120px' },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (groupGrid) {
        groupGrid
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
        groupGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 text-center align-middle',
          },
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed',
            },
          },
        }).render(document.getElementById('groupGrid'))
      }
    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) {
        console.log('Request cancelled')
        return
      }
      console.error('Error loading group schedule:', error)
    } finally {
      isLoading = false
      abortController = null
    }
  }

  // Handle date input change
  const handleDateChange = () => {
    cache.invalidate()
    loadGroupSchedule(true)
  }

  // Debounced reload with cache invalidation
  let reloadTimeout
  const debouncedReload = () => {
    if (isLoading) return
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
      cache.invalidate()
      loadGroupSchedule(true)
    }, 150)
  }

  onMount(() => {
    loadGroupSchedule()
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', () => {
      groupRooms = []
      cache.invalidate()
      debouncedReload()
    })
    pb.collection('timeSlot').subscribe('*', () => {
      timeslots = []
      cache.invalidate()
      debouncedReload()
    })
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    abortController?.abort()
    groupGrid?.destroy()
    pb.collection('groupLessonSchedule').unsubscribe()
    pb.collection('grouproom').unsubscribe()
    pb.collection('timeSlot').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">GRP Room Slot Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Week Starting:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={handleDateChange}
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-center mr-50">{getWeekRangeDisplay(weekStart)}</h3>

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
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Teacher</span>
      </div>
    </div>
  </div>

  <div id="groupGrid" class="border rounded-lg"></div>
</div>
