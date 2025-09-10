<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { current, pb } from '../../lib/Pocketbase.svelte'
  import { onDestroy, onMount } from 'svelte'

  let currentDate = new Date()
  let date = new Date().toISOString().split('T')[0]
  let teacherGrid = null
  let timeslots = []
  let teachers = []

  const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.length === 0) return h('span', {}, '—')

    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 items-center' }, [
          createBadge(item.subject?.name ?? 'No Subject', 'badge-primary whitespace-nowrap'),
          item.isGroup
            ? h('div', { class: 'flex flex-col gap-0.5 items-center' }, [
                createBadge('Group Class', 'badge-secondary'),
                ...item.students.map((s) => createBadge(s.name, 'badge-neutral')),
              ])
            : createBadge(item.student?.name ?? 'No Student', 'badge-neutral'),
          createBadge(item.room?.name ?? 'No Room', 'badge-error'),
        ])
      )
    )
  }

  async function getSchedules(date) {
    const [individual, groups] = await Promise.all([
      pb.collection('lessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,room,timeslot',
      }),
      pb.collection('groupLessonSchedule').getList(1, 200, {
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      }),
    ])

    const map = new Map()

    // normalize individual lessons
    for (const s of individual.items) {
      const key = `${s.expand.student?.id}_${s.expand.subject?.id}_${s.expand.timeslot?.id}`
      map.set(key, {
        ...s,
        subject: s.expand.subject,
        student: s.expand.student,
        students: [],
        room: s.expand.room,
        isGroup: false,
        teacher: s.expand.teacher,
        timeslot: s.expand.timeslot,
      })
    }

    // normalize group lessons
    for (const s of groups.items) {
      const key = `group_${s.id}_${s.expand.subject?.id}_${s.expand.timeslot?.id}`
      map.set(key, {
        ...s,
        subject: s.expand.subject,
        student: null,
        students: Array.isArray(s.expand.student) ? s.expand.student : [],
        room: s.expand.grouproom,
        isGroup: true,
        teacher: s.expand.teacher,
        timeslot: s.expand.timeslot,
      })
    }

    return [...map.values()]
  }

  async function loadTeacherSchedule() {
    // fetch reference data ONCE
    if (!timeslots.length) timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    if (!teachers.length) teachers = await pb.collection('teacher').getFullList({ sort: 'name' })

    const schedules = await getSchedules(date)

    // group: teacherId -> { teacher: name, slots: { timeslotId: [lessons...] } }
    const grouped = {}
    for (const s of schedules) {
      const tId = s.teacher?.id
      const slotId = s.timeslot?.id
      if (!grouped[tId]) grouped[tId] = { teacher: s.teacher?.name, slots: {} }
      if (!grouped[tId].slots[slotId]) grouped[tId].slots[slotId] = []
      grouped[tId].slots[slotId].push(s)
    }

    // build rows in the same order as `teachers`
    const data = teachers.map((t) => {
      const entry = grouped[t.id] || { teacher: t.name, slots: {} }
      // Grid row = array: first cell teacher, then one cell per timeslot (each is array of lessons)
      return [{ value: entry.teacher }, ...timeslots.map((slot) => entry.slots[slot.id] || [])]
    })

    // create or update Grid
    if (teacherGrid) {
      // update only the data (keeps columns & DOM structure) => better perf
      teacherGrid.updateConfig({ data }).forceRender()
    } else {
      teacherGrid = new Grid({
        columns: [
          { name: 'Teacher', formatter: (c) => c.value },
          ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, formatter: formatCell })),
        ],
        data,
        search: false,
        sort: false,
        className: {
          table: 'w-full border text-sm',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 text-center align-middle',
        },
      }).render(document.getElementById('teacherGrid'))
    }
  }

  function changeDate(days) {
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadTeacherSchedule()
  }

  onMount(() => {
    loadTeacherSchedule()
    pb.collection('lessonSchedule').subscribe('*', loadTeacherSchedule)
    pb.collection('groupLessonSchedule').subscribe('*', loadTeacherSchedule)
  })

  onDestroy(() => {
    pb.collection('lessonSchedule').unsubscribe('*', loadTeacherSchedule)
    pb.collection('groupLessonSchedule').unsubscribe('*', loadTeacherSchedule)
    if (teacherGrid) teacherGrid.destroy()
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
  <div class="p-3 bg-base-200 rounded-lg">
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

  <div id="teacherGrid"></div>
</div>
