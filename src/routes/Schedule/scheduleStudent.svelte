<script>
  import { onMount, onDestroy } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'

  let date = new Date().toISOString().split('T')[0]
  let currentDate = new Date()
  let studentGrid
  let columns
  let timeslots = []

  // simple debounce to prevent too many reloads when fast-clicking
  let debounceTimer
  const reloadWithDebounce = () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => loadStudentSchedule(), 150)
  }

  const changeDate = (days) => {
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    reloadWithDebounce()
  }

  const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.length === 0) return h('span', {}, '—')
    return h(
      'div',
      {
        class: 'text-xs',
      },
      cell.map((item) =>
        h(
          'div',
          { class: 'flex flex-col gap-1 items-center' },
          [
            createBadge(item.subject?.name || '', 'badge-primary'),
            createBadge(item.teacher?.name || '', 'badge-success'),
            item.isGroup ? createBadge('Group Class', 'badge-secondary') : null,
            createBadge(item.room?.name || '', 'badge-error'),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadStudentSchedule() {
    // cache timeslots
    if (timeslots.length === 0) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }

    const students = await pb.collection('student').getFullList({ sort: 'name' })

    // fetch individual lessons for this day
    const individualSchedules = await pb.collection('lessonSchedule').getList(1, 200, {
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,room,timeslot',
    })

    // fetch group lessons for this day
    const groupSchedules = await pb.collection('groupLessonSchedule').getList(1, 200, {
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,grouproom,timeslot',
    })

    // group by student (pre-fill all students first)
    const grouped = {}
    for (const stu of students) {
      grouped[stu.id] = {
        student: stu.name,
        englishName: stu.englishName || '',
        course: stu.course || '',
        level: stu.level || '',
        slots: {}, // empty for now
      }
    }

    // process individual schedules
    for (const s of individualSchedules.items) {
      const student = s.expand.student
      if (!student) continue
      const studentId = student.id

      const timeslotId = s.expand.timeslot?.id
      if (!grouped[studentId].slots[timeslotId]) {
        grouped[studentId].slots[timeslotId] = []
      }
      grouped[studentId].slots[timeslotId].push({
        ...s,
        isGroup: false,
        expand: {
          ...s.expand,
          room: s.expand.room, // use regular room for individual lessons
        },
      })
    }

    // process group schedules
    for (const s of groupSchedules.items) {
      const students = Array.isArray(s.expand.student) ? s.expand.student : []

      // add this group lesson to each student in the group
      for (const student of students) {
        const studentId = student.id

        // make sure the student exists in our grouped object
        if (!grouped[studentId]) continue

        const timeslotId = s.expand.timeslot?.id
        if (!grouped[studentId].slots[timeslotId]) {
          grouped[studentId].slots[timeslotId] = []
        }

        grouped[studentId].slots[timeslotId].push({
          ...s,
          isGroup: true,
          expand: {
            ...s.expand,
            student: student, // set the specific student for this entry
            room: s.expand.grouproom, // use grouproom for group lessons
          },
        })
      }
    }

    // build columns once
    if (!columns) {
      columns = [
        { name: 'Student', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'English Name', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Course', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Level', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          formatter: formatCell,
        })),
      ]
    }

    // build rows fields that are present in the database
    const data = Object.values(grouped)
      .sort((a, b) => a.student.localeCompare(b.student, undefined, { numeric: true }))
      .map((entry) => {
        const row = [
          { label: 'Student', value: entry.student },
          { label: 'English Name', value: entry.englishName },
          { label: 'Course', value: entry.course },
          { label: 'Level', value: entry.level },
        ]
        timeslots.forEach((t) => {
          const slotData = entry.slots[t.id] || []
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

    // grid reuse
    if (studentGrid) {
      requestAnimationFrame(() => {
        studentGrid.updateConfig({ data }).forceRender()
      })
    } else {
      studentGrid = new Grid({
        columns,
        data,
        search: {
          enabled: true,
          selector: (cell) => {
            if (typeof cell === 'string') return cell
            return cell?.value || ''
          },
        },
        sort: false,
        className: {
          table: 'w-full border text-sm max-w-[800px]',
          th: 'bg-base-200 p-2 border text-center',
          td: 'border p-2 whitespace-nowrap align-middle text-center',
        },
      }).render(document.getElementById('studentGrid'))
    }
  }

  onMount(() => {
    loadStudentSchedule()
    // subscribe to both collections
    pb.collection('lessonSchedule').subscribe('*', loadStudentSchedule)
    pb.collection('groupLessonSchedule').subscribe('*', loadStudentSchedule)
  })

  onDestroy(() => {
    if (studentGrid) {
      studentGrid.destroy()
      studentGrid = null
    }
    // unsubscribe from both collections
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
  <div class="p-3 bg-base-200 rounded-lg">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
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

  <div id="studentGrid"></div>
</div>
