<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let weekStart = $state(getWeekStart(new Date()))
  let groupGrid = null
  let timeslots = []
  let groupRooms = []
  let isLoading = false

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
    loadGroupSchedule()
  }

  const createBadge = (text, color) => h('span', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cellData) => {
    if (!cellData || !cellData.schedule) return h('span', {}, '—')
    const { schedule, studentName } = cellData
    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      createBadge(schedule.subject?.name ?? 'No Subject', 'badge-primary p-3'),
      createBadge(schedule.teacher?.name ?? 'No Teacher', 'badge-info'),
      createBadge(studentName, 'badge-neutral'),
    ])
  }

  async function loadGroupSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Fetch all data in parallel
      const [timeslotsData, groupRoomsData, schedules] = await Promise.all([
        timeslots.length ? Promise.resolve(timeslots) : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        groupRooms.length ? Promise.resolve(groupRooms) : pb.collection('grouproom').getFullList({ sort: 'name' }),
        pb.collection('groupLessonSchedule').getList(1, 500, {
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      groupRooms = groupRoomsData

      // Build schedule lookup: room -> timeslot -> schedule (with most students)
      const scheduleMap = {}

      schedules.items.forEach((s) => {
        const roomId = s.expand?.grouproom?.id
        const timeslotId = s.expand?.timeslot?.id

        if (!roomId || !timeslotId) return

        if (!scheduleMap[roomId]) scheduleMap[roomId] = {}

        // Store first or replace with one that has more students
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        const existing = scheduleMap[roomId][timeslotId]

        if (!existing || students.length > (existing.students?.length || 0)) {
          scheduleMap[roomId][timeslotId] = {
            subject: s.expand?.subject,
            teacher: s.expand?.teacher,
            students,
          }
        }
      })

      // Build table data
      const data = []
      groupRooms.forEach((room) => {
        const maxSlots = Math.min(room.maxstudents || 30, 50)
        const roomSchedule = scheduleMap[room.id] || {}

        for (let slot = 1; slot <= maxSlots; slot++) {
          const row = [room.name, `Slot ${slot}`]

          timeslots.forEach((ts) => {
            const schedule = roomSchedule[ts.id]
            const student = schedule?.students?.[slot - 1]

            row.push(
              student
                ? {
                    schedule,
                    studentName: student.englishName || 'Unknown',
                  }
                : null
            )
          })

          data.push(row)
        }
      })

      // Build columns
      const columns = [
        { name: 'Group Room', width: '120px' },
        { name: 'S-Slot', width: '120px' },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      // Initialize or update grid
      if (groupGrid) {
        groupGrid.updateConfig({ data }).forceRender()
      } else {
        groupGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: { enabled: true, limit: 100, summary: false },
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
            td: 'border p-2 text-center align-middle',
          },
          style: {
            table: { 'border-collapse': 'collapse' },
          },
        }).render(document.getElementById('groupGrid'))
      }
    } catch (error) {
      console.error('Error loading group schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadGroupSchedule, 150)
  }

  onMount(() => {
    loadGroupSchedule()
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', () => {
      groupRooms = []
      debouncedReload()
    })
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    if (groupGrid) {
      groupGrid.destroy()
      groupGrid = null
    }
    pb.collection('groupLessonSchedule').unsubscribe()
    pb.collection('grouproom').unsubscribe()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Group</h2>
    <h2 class="text-center flex-1">Schedule Table (Weekly)</h2>
    {#if isLoading}
      <div class="loading loading-spinner loading-sm"></div>
    {/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Week Starting:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={loadGroupSchedule}
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}> &larr; </button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}> &rarr; </button>
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
        <span>Student Names</span>
      </div>
    </div>
  </div>

  <div id="groupGrid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>
