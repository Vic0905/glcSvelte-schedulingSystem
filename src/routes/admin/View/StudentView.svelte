<script>
  import { onMount, onDestroy } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let date = new Date().toISOString().split('T')[0]
  let currentDate = new Date()
  let studentGrid = null
  let timeslots = []

  const changeDate = (days) => {
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadStudentSchedule()
  }

  const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs` }, text)

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
            createBadge(item.subject?.name || '', 'badge-primary'),
            createBadge(item.teacher?.name || '', 'badge-info'),
            item.isGroup && createBadge('Group Class', 'badge-secondary'),
            createBadge(item.room?.name || '', 'badge-error'),
          ].filter(Boolean)
        )
      )
    )
  }

  const buildColumns = () => [
    { name: 'Student', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
    { name: 'English Name', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
    { name: 'Course', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
    { name: 'Level', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
    ...timeslots.map((t) => ({
      name: `${t.start} - ${t.end}`,
      formatter: formatCell,
    })),
  ]

  const fetchScheduleData = async () => {
    const [students, individualSchedules, groupSchedules] = await Promise.all([
      pb.collection('student').getFullList({ sort: 'name' }),
      pb.collection('lessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,room,timeslot',
      }),
      pb.collection('groupLessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      }),
    ])

    return { students, individualSchedules: individualSchedules.items, groupSchedules: groupSchedules.items }
  }

  const processScheduleData = (students, individualSchedules, groupSchedules) => {
    // Initialize student data structure
    const grouped = {}
    students.forEach((student) => {
      grouped[student.id] = {
        student: student.name,
        englishName: student.englishName || '',
        course: student.course || '',
        level: student.level || '',
        slots: {},
      }
    })

    // Process individual schedules
    individualSchedules.forEach((schedule) => {
      const student = schedule.expand.student
      if (!student) return

      const timeslotId = schedule.expand.timeslot?.id
      if (!grouped[student.id].slots[timeslotId]) {
        grouped[student.id].slots[timeslotId] = []
      }

      grouped[student.id].slots[timeslotId].push({
        ...schedule,
        isGroup: false,
        expand: { ...schedule.expand, room: schedule.expand.room },
      })
    })

    // Process group schedules
    groupSchedules.forEach((schedule) => {
      const students = Array.isArray(schedule.expand.student) ? schedule.expand.student : []

      students.forEach((student) => {
        if (!grouped[student.id]) return

        const timeslotId = schedule.expand.timeslot?.id
        if (!grouped[student.id].slots[timeslotId]) {
          grouped[student.id].slots[timeslotId] = []
        }

        grouped[student.id].slots[timeslotId].push({
          ...schedule,
          isGroup: true,
          expand: { ...schedule.expand, student, room: schedule.expand.grouproom },
        })
      })
    })

    return grouped
  }

  const buildTableData = (grouped) => {
    return Object.values(grouped)
      .sort((a, b) => a.student.localeCompare(b.student, undefined, { numeric: true }))
      .map((entry) => {
        const row = [
          { label: 'Student', value: entry.student },
          { label: 'English Name', value: entry.englishName },
          { label: 'Course', value: entry.course },
          { label: 'Level', value: entry.level },
        ]

        timeslots.forEach((timeslot) => {
          const slotData = entry.slots[timeslot.id] || []
          row.push(
            slotData.map((item) => ({
              subject: item.expand.subject,
              teacher: item.expand.teacher,
              student: item.expand.student,
              room: item.expand.room,
              isGroup: item.isGroup,
            }))
          )
        })

        return row
      })
  }

  const initializeGrid = (data) => {
    const config = {
      columns: buildColumns(),
      data,
      search: false,
      sort: false,
      className: {
        table: 'w-full border text-sm max-w-[800px]',
        th: 'bg-base-200 p-2 border text-center',
        td: 'border p-2 whitespace-nowrap align-middle text-center',
      },
    }

    if (studentGrid) {
      requestAnimationFrame(() => {
        studentGrid.updateConfig({ data }).forceRender()
      })
    } else {
      studentGrid = new Grid(config).render(document.getElementById('studentGrid'))
    }
  }

  async function loadStudentSchedule() {
    try {
      // Load timeslots if not cached
      if (!timeslots.length) {
        timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
      }

      const { students, individualSchedules, groupSchedules } = await fetchScheduleData()
      const grouped = processScheduleData(students, individualSchedules, groupSchedules)
      const data = buildTableData(grouped)

      initializeGrid(data)
    } catch (error) {
      console.error('Error loading schedule:', error)
    }
  }

  onMount(() => {
    loadStudentSchedule()
    pb.collection('lessonSchedule').subscribe('*', loadStudentSchedule)
    pb.collection('groupLessonSchedule').subscribe('*', loadStudentSchedule)
  })

  onDestroy(() => {
    if (studentGrid) {
      studentGrid.destroy()
      studentGrid = null
    }
    pb.collection('lessonSchedule').unsubscribe()
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold text-primary">Student</h2>
    <h2 class="text-2xl font-bold text-primary text-center flex-1">Schedule Table</h2>
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
        onchange={loadStudentSchedule}
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
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(1)}>&rarr;</button>
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
        <div class="badge badge-secondary badge-xs"></div>
        <span>Group Class</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="studentGrid" class="max-h-[680px] overflow-auto border rounded-lg"></div>
</div>
