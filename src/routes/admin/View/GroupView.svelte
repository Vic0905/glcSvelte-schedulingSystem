<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let date = new Date().toISOString().split('T')[0]
  let currentDate = new Date()
  let groupGrid = null
  let timeslots = []
  let groupRooms = []
  let isLoading = false

  // Cache for formatted badges to avoid recreating identical elements
  const badgeCache = new Map()

  const changeDate = (days) => {
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadGroupSchedule()
  }

  // Optimized badge creation with caching
  const createBadge = (text, colorClass) => {
    const key = `${text}-${colorClass}`
    if (badgeCache.has(key)) {
      return badgeCache.get(key)
    }

    const badge = h('span', { class: `badge ${colorClass} badge-xs whitespace-nowrap` }, text)
    badgeCache.set(key, badge)
    return badge
  }

  // Memoized cell formatter
  const formatCell = (() => {
    const cellCache = new Map()

    return (cellData) => {
      if (!cellData || !cellData.schedule) return h('span', {}, '—')

      const { schedule, studentName } = cellData
      const cacheKey = `${schedule.id}-${studentName}`

      if (cellCache.has(cacheKey)) {
        return cellCache.get(cacheKey)
      }

      const cell = h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
        createBadge(schedule.subject?.name ?? 'No Subject', 'badge-primary'),
        createBadge(schedule.teacher?.name ?? 'No Teacher', 'badge-info'),
        createBadge(studentName, 'badge-neutral'),
      ])

      cellCache.set(cacheKey, cell)
      return cell
    }
  })()

  // Optimized data fetching with parallel requests
  const fetchAllData = async () => {
    const promises = []

    // Only fetch if not cached
    if (!timeslots.length) {
      promises.push(
        pb
          .collection('timeSlot')
          .getFullList({ sort: 'start' })
          .then((data) => ({ type: 'timeslots', data }))
      )
    }

    if (!groupRooms.length) {
      promises.push(
        pb
          .collection('grouproom')
          .getFullList({ sort: 'name' })
          .then((data) => ({ type: 'groupRooms', data }))
      )
    }

    // Always fetch schedule data for the current date
    promises.push(
      pb
        .collection('groupLessonSchedule')
        .getList(1, 500, {
          filter: `date = "${date}"`,
          expand: 'teacher,student,subject,grouproom,timeslot',
        })
        .then((response) => ({ type: 'schedules', data: response.items }))
    )

    const results = await Promise.all(promises)

    // Update cached data
    results.forEach((result) => {
      switch (result.type) {
        case 'timeslots':
          timeslots = result.data
          break
        case 'groupRooms':
          groupRooms = result.data
          break
        case 'schedules':
          // This will be processed separately
          break
      }
    })

    return results.find((r) => r.type === 'schedules')?.data || []
  }

  // Optimized schedule normalization
  const normalizeGroupSchedules = (groupSchedules) => {
    return groupSchedules.map((schedule) => ({
      id: schedule.id,
      subject: schedule.expand?.subject,
      students: Array.isArray(schedule.expand?.student) ? schedule.expand.student : [],
      room: schedule.expand?.grouproom,
      teacher: schedule.expand?.teacher,
      timeslot: schedule.expand?.timeslot,
    }))
  }

  // Optimized data processing with early returns and reduced iterations
  const processGroupScheduleData = (schedules) => {
    if (!schedules.length) return {}

    const grouped = {}

    schedules.forEach((schedule) => {
      const roomId = schedule.room?.id
      const timeslotId = schedule.timeslot?.id

      if (!roomId || !timeslotId) return // Early return for invalid data

      if (!grouped[roomId]) {
        grouped[roomId] = {
          room: schedule.room.name,
          slots: {},
        }
      }

      // Use the schedule with most students if duplicate timeslot
      if (
        !grouped[roomId].slots[timeslotId] ||
        schedule.students.length > grouped[roomId].slots[timeslotId].students.length
      ) {
        grouped[roomId].slots[timeslotId] = schedule
      }
    })

    return grouped
  }

  // Optimized table building with reduced memory allocations
  const buildGroupTableData = (grouped) => {
    if (!groupRooms.length || !timeslots.length) return []

    const tableData = []
    const timeSlotCount = timeslots.length

    groupRooms.forEach((room) => {
      const roomSchedule = grouped[room.id]
      const maxStudents = Math.min(room.maxstudents || 30, 50) // Cap at 50 to prevent excessive rows
      const roomDisplay = `${room.name}`

      for (let slotNumber = 1; slotNumber <= maxStudents; slotNumber++) {
        // Pre-allocate array with known size
        const row = new Array(timeSlotCount + 2)

        row[0] = roomDisplay
        row[1] = `Slot ${slotNumber}`

        // Process timeslots
        for (let i = 0; i < timeSlotCount; i++) {
          const timeslot = timeslots[i]
          const schedule = roomSchedule?.slots[timeslot.id]
          const student = schedule?.students?.[slotNumber - 1]

          row[i + 2] = student
            ? {
                schedule: schedule,
                studentName: student.name,
              }
            : null
        }

        tableData.push(row)
      }
    })

    return tableData
  }

  // Optimized grid initialization with better config
  const initializeGroupGrid = (data) => {
    const columns = [
      { name: 'Group Room', width: '150px' },
      { name: 'S-Slot', width: '120px' },
      ...timeslots.map((t) => ({
        name: `${t.start} - ${t.end}`,
        width: '140px',
        formatter: formatCell,
      })),
    ]

    const config = {
      columns,
      data,
      search: false,
      sort: false,
      pagination: {
        limit: 100, // Paginate to improve rendering performance
        summary: false,
      },
      className: {
        table: 'w-full border text-sm',
        th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
        td: 'border p-1 text-center align-middle', // Reduced padding
      },
      style: {
        table: {
          'border-collapse': 'collapse',
        },
      },
    }

    if (groupGrid) {
      groupGrid.updateConfig({ data }).forceRender()
    } else {
      groupGrid = new Grid(config).render(document.getElementById('groupGrid'))
    }
  }

  // Main loading function with loading state
  async function loadGroupSchedule() {
    if (isLoading) return // Prevent concurrent loads

    isLoading = true

    try {
      const groupSchedules = await fetchAllData()
      const schedules = normalizeGroupSchedules(groupSchedules)
      const grouped = processGroupScheduleData(schedules)
      const data = buildGroupTableData(grouped)

      initializeGroupGrid(data)
    } catch (error) {
      console.error('Error loading group schedule:', error)
    } finally {
      isLoading = false
    }
  }

  // Debounced reload for rapid date changes
  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadGroupSchedule, 150)
  }

  onMount(() => {
    loadGroupSchedule()

    // Use debounced reload for subscriptions to prevent excessive updates
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', () => {
      groupRooms = [] // Reset cache
      debouncedReload()
    })
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)

    if (groupGrid) {
      groupGrid.destroy()
      groupGrid = null
    }

    // Clear caches to prevent memory leaks
    badgeCache.clear()

    pb.collection('groupLessonSchedule').unsubscribe()
    pb.collection('grouproom').unsubscribe()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Group Room</h2>
    <h2 class="text-center flex-1">Schedule Table</h2>
    {#if isLoading}
      <div class="loading loading-spinner loading-sm"></div>
    {/if}
  </div>

  <!-- Filter row -->
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Filter Date:</label>
      <input
        type="date"
        id="filterDate"
        name="filterDate"
        bind:value={date}
        class="input input-bordered input-sm w-40"
        onchange={loadGroupSchedule}
        disabled={isLoading}
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
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <!-- Legend -->
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
        <span>Student Names</span>
      </div>
    </div>
  </div>

  <div id="groupGrid" class="max-h-[680px] overflow-auto border rounded-lg"></div>
</div>
