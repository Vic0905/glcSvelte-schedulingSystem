<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let weekStart = $state(getWeekStart(new Date()))
  let teacherGrid = null
  let timeslots = []
  let teachers = []

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
    loadTeacherSchedule()
  }

  const createBadge = (text, color) => h('span', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 items-center' }, [
          createBadge(item.subject?.name ?? 'No Subject', 'badge-primary p-3'),
          item.isGroup
            ? createBadge('Group Class', 'badge-secondary')
            : createBadge(item.student?.englishName ?? 'No Student', 'badge-neutral'),
          createBadge(item.room?.name ?? 'No Room', 'badge-error'),
        ])
      )
    )
  }

  async function loadTeacherSchedule() {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Fetch all data in parallel
      const [timeslotsData, teachersData, individualBookings, groupBookings] = await Promise.all([
        timeslots.length ? Promise.resolve(timeslots) : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        teachers.length ? Promise.resolve(teachers) : pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('advanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      teachers = teachersData

      // Build schedule lookup: teacher -> timeslot -> unique key -> schedule
      const scheduleMap = {}

      // Process individual bookings
      individualBookings.items.forEach((b) => {
        const teacherId = b.expand?.teacher?.id
        const timeslotId = b.expand?.timeslot?.id
        const studentId = b.expand?.student?.id

        if (!teacherId || !timeslotId) return

        if (!scheduleMap[teacherId]) scheduleMap[teacherId] = {}
        if (!scheduleMap[teacherId][timeslotId]) scheduleMap[teacherId][timeslotId] = {}

        // Use student ID as key (one entry per student per week)
        scheduleMap[teacherId][timeslotId][studentId] = {
          subject: b.expand?.subject,
          student: b.expand?.student,
          room: b.expand?.room,
          isGroup: false,
        }
      })

      // Process group bookings
      groupBookings.items.forEach((b) => {
        const teacherId = b.expand?.teacher?.id
        const timeslotId = b.expand?.timeslot?.id
        const subjectId = b.expand?.subject?.id
        const roomId = b.expand?.grouproom?.id

        if (!teacherId || !timeslotId) return

        if (!scheduleMap[teacherId]) scheduleMap[teacherId] = {}
        if (!scheduleMap[teacherId][timeslotId]) scheduleMap[teacherId][timeslotId] = {}

        // Use composite key for groups (one entry per group per week)
        const key = `group_${subjectId}_${roomId}`
        scheduleMap[teacherId][timeslotId][key] = {
          subject: b.expand?.subject,
          student: null,
          room: b.expand?.grouproom,
          isGroup: true,
        }
      })

      // Build table data
      const data = teachers.map((teacher) => {
        const teacherSchedule = scheduleMap[teacher.id] || {}
        return [
          { value: teacher.name, width: '120px' },
          ...timeslots.map((ts) => {
            const schedules = teacherSchedule[ts.id]
            return schedules ? Object.values(schedules) : []
          }),
        ]
      })

      // Build columns
      const columns = [
        { name: 'Teacher', width: '120px', formatter: (cell) => cell.value },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      // Initialize or update grid
      if (teacherGrid) {
        teacherGrid.updateConfig({ data }).forceRender()
      } else {
        teacherGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
            td: 'border p-2 text-center align-middle',
          },
        }).render(document.getElementById('teacherGrid'))
      }
    } catch (error) {
      console.error('Error loading teacher schedule:', error)
    }
  }

  onMount(() => {
    loadTeacherSchedule()
    pb.collection('advanceBooking').subscribe('*', loadTeacherSchedule)
    pb.collection('groupAdvanceBooking').subscribe('*', loadTeacherSchedule)
  })

  onDestroy(() => {
    if (teacherGrid) {
      teacherGrid.destroy()
      teacherGrid = null
    }
    pb.collection('advanceBooking').unsubscribe()
    pb.collection('groupAdvanceBooking').unsubscribe()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Teacher View Table (Advance Template)</h2>
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Week Starting:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={loadTeacherSchedule}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
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
        <div class="badge badge-secondary badge-xs"></div>
        <span>Group Lesson</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="teacherGrid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>
