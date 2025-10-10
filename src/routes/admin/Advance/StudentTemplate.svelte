<script>
  import { onMount, onDestroy } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let weekStart = $state(getWeekStart(new Date()))
  let studentGrid = null
  let timeslots = []

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
    const opts = { month: 'long', day: 'numeric', year: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadStudentSchedule()
  }

  const createBadge = (text, color) => h('span', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) =>
        h(
          'div',
          { class: 'flex flex-col gap-1 items-center' },
          [
            createBadge(item.subject?.name || '', 'badge-primary p-3'),
            createBadge(item.teacher?.name || '', 'badge-info'),
            item.isGroup && createBadge('Group Class', 'badge-secondary'),
            createBadge(item.room?.name || '', 'badge-error'),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadStudentSchedule() {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Fetch all data in parallel
      const [timeslotsData, students, individualBookings, groupBookings] = await Promise.all([
        timeslots.length ? Promise.resolve(timeslots) : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('advanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData

      // Build schedule lookup: student -> timeslot -> schedule
      const scheduleMap = {}

      // Initialize all students
      students.forEach((s) => {
        scheduleMap[s.id] = {
          student: s.name,
          englishName: s.englishName || '',
          course: s.course || '',
          level: s.level || '',
          slots: {},
        }
      })

      // Process individual bookings
      individualBookings.items.forEach((b) => {
        const studentId = b.expand?.student?.id
        const timeslotId = b.expand?.timeslot?.id

        if (!studentId || !timeslotId || !scheduleMap[studentId]) return

        // Only store first occurrence (represents entire week)
        if (!scheduleMap[studentId].slots[timeslotId]) {
          scheduleMap[studentId].slots[timeslotId] = {
            subject: b.expand?.subject,
            teacher: b.expand?.teacher,
            room: b.expand?.room,
            isGroup: false,
          }
        }
      })

      // Process group bookings
      groupBookings.items.forEach((b) => {
        const students = Array.isArray(b.expand?.student) ? b.expand.student : []
        const timeslotId = b.expand?.timeslot?.id

        if (!timeslotId) return

        students.forEach((student) => {
          if (!scheduleMap[student.id]) return

          // Only store first occurrence
          if (!scheduleMap[student.id].slots[timeslotId]) {
            scheduleMap[student.id].slots[timeslotId] = {
              subject: b.expand?.subject,
              teacher: b.expand?.teacher,
              room: b.expand?.grouproom,
              isGroup: true,
            }
          }
        })
      })

      // Build table data
      const data = Object.values(scheduleMap)
        .sort((a, b) => a.student.localeCompare(b.student, undefined, { numeric: true }))
        .map((entry) => [
          { label: 'Student', value: entry.student },
          { label: 'English Name', value: entry.englishName },
          { label: 'Course', value: entry.course },
          { label: 'Level', value: entry.level },
          ...timeslots.map((ts) => {
            const schedule = entry.slots[ts.id]
            return schedule ? [schedule] : []
          }),
        ])

      // Build columns
      const columns = [
        { name: 'Student', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'English Name', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Course', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Level', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      // Initialize or update grid
      if (studentGrid) {
        studentGrid.updateConfig({ data }).forceRender()
      } else {
        studentGrid = new Grid({
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
        }).render(document.getElementById('studentGrid'))
      }
    } catch (error) {
      console.error('Error loading schedule:', error)
    }
  }

  onMount(() => {
    loadStudentSchedule()
    pb.collection('advanceBooking').subscribe('*', loadStudentSchedule)
    pb.collection('groupAdvanceBooking').subscribe('*', loadStudentSchedule)
  })

  onDestroy(() => {
    if (studentGrid) {
      studentGrid.destroy()
      studentGrid = null
    }
    pb.collection('advanceBooking').unsubscribe()
    pb.collection('groupAdvanceBooking').unsubscribe()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold text-primary">Student</h2>
    <h2 class="text-2xl font-bold text-primary text-center flex-1">Advance Schedule (Weekly Template)</h2>
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Week Starting:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={loadStudentSchedule}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
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
        <div class="badge badge-info badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-secondary badge-xs"></div>
        <span>Group Class</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div class="max-h-[700px] overflow-auto border rounded-lg">
    <div id="studentGrid"></div>
  </div>
</div>
