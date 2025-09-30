<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let date = new Date().toISOString().split('T')[0]
  let currentDate = new Date()
  let teacherGrid = null
  let timeslots = []
  let teachers = []

  const changeDate = (days) => {
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadTeacherSchedule()
  }

  const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')

    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 items-center' }, [
          createBadge(item.subject?.name ?? 'No Subject', 'badge-primary whitespace-nowrap'),
          item.isGroup
            ? createBadge('Group Class', 'badge-secondary')
            : createBadge(item.student?.name ?? 'No Student', 'badge-neutral'),
          createBadge(item.room?.name ?? 'No Room', 'badge-error'),
        ])
      )
    )
  }

  const buildColumns = () => [
    { name: 'Teacher', formatter: (cell) => cell.value },
    ...timeslots.map((t) => ({
      name: `${t.start} - ${t.end}`,
      formatter: formatCell,
    })),
  ]

  const fetchScheduleData = async () => {
    const [individualSchedules, groupSchedules] = await Promise.all([
      pb.collection('lessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,room,timeslot',
      }),
      pb.collection('groupLessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      }),
    ])

    return {
      individualSchedules: individualSchedules.items,
      groupSchedules: groupSchedules.items,
    }
  }

  const normalizeSchedules = (individualSchedules, groupSchedules) => {
    const schedules = []

    // Process individual lessons
    individualSchedules.forEach((schedule) => {
      schedules.push({
        ...schedule,
        subject: schedule.expand.subject,
        student: schedule.expand.student,
        students: [],
        room: schedule.expand.room,
        isGroup: false,
        teacher: schedule.expand.teacher,
        timeslot: schedule.expand.timeslot,
      })
    })

    // Process group lessons
    groupSchedules.forEach((schedule) => {
      schedules.push({
        ...schedule,
        subject: schedule.expand.subject,
        student: null,
        students: Array.isArray(schedule.expand.student) ? schedule.expand.student : [],
        room: schedule.expand.grouproom,
        isGroup: true,
        teacher: schedule.expand.teacher,
        timeslot: schedule.expand.timeslot,
      })
    })

    return schedules
  }

  const processScheduleData = (schedules) => {
    const grouped = {}

    schedules.forEach((schedule) => {
      const teacherId = schedule.teacher?.id
      const timeslotId = schedule.timeslot?.id

      if (!grouped[teacherId]) {
        grouped[teacherId] = {
          teacher: schedule.teacher?.name,
          slots: {},
        }
      }

      if (!grouped[teacherId].slots[timeslotId]) {
        grouped[teacherId].slots[timeslotId] = []
      }

      grouped[teacherId].slots[timeslotId].push(schedule)
    })

    return grouped
  }

  const buildTableData = (grouped) => {
    return teachers.map((teacher) => {
      const entry = grouped[teacher.id] || { teacher: teacher.name, slots: {} }
      return [{ value: entry.teacher }, ...timeslots.map((timeslot) => entry.slots[timeslot.id] || [])]
    })
  }

  const initializeGrid = (data) => {
    const config = {
      columns: buildColumns(),
      data,
      search: false,
      sort: false,
      className: {
        table: 'w-full border text-sm',
        th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
        td: 'border p-2 text-center align-middle',
      },
    }

    if (teacherGrid) {
      teacherGrid.updateConfig({ data }).forceRender()
    } else {
      teacherGrid = new Grid(config).render(document.getElementById('teacherGrid'))
    }
  }

  async function loadTeacherSchedule() {
    try {
      // Load reference data if not cached
      if (!timeslots.length) {
        timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
      }
      if (!teachers.length) {
        teachers = await pb.collection('teacher').getFullList({ sort: 'name' })
      }

      const { individualSchedules, groupSchedules } = await fetchScheduleData()
      const schedules = normalizeSchedules(individualSchedules, groupSchedules)
      const grouped = processScheduleData(schedules)
      const data = buildTableData(grouped)

      initializeGrid(data)
    } catch (error) {
      console.error('Error loading teacher schedule:', error)
    }
  }

  onMount(() => {
    loadTeacherSchedule()
    pb.collection('lessonSchedule').subscribe('*', loadTeacherSchedule)
    pb.collection('groupLessonSchedule').subscribe('*', loadTeacherSchedule)
  })

  onDestroy(() => {
    if (teacherGrid) {
      teacherGrid.destroy()
      teacherGrid = null
    }
    pb.collection('lessonSchedule').unsubscribe()
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Teacher</h2>
    <h2 class="text-center flex-1">Schedule Table</h2>
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
        onchange={loadTeacherSchedule}
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

  <div id="teacherGrid" class="max-h-[680px] overflow-auto border rounded-lg"></div>
</div>
