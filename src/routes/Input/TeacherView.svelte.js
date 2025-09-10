import { onMount, onDestroy } from 'svelte'
import { Grid, h } from 'gridjs'
import 'gridjs/dist/theme/mermaid.css'
import { pb } from '../../lib/Pocketbase.svelte'

let date = new Date().toISOString().split('T')[0]
let currentDate = new Date()
let teacherGrid = null
let columns = null
let timeslots = []

// cache teachers so we don't refetch them every time
let cachedTeachers = []

// debounce utility
let debounceTimer
const debounce = (fn, delay = 250) => {
  return (...args) => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => fn(...args), delay)
  }
}

const changeDate = (days) => {
  currentDate.setDate(currentDate.getDate() + days)
  date = currentDate.toISOString().split('T')[0]
  debouncedLoad()
}

const createBadge = (text, colorClass) => h('span', { class: `badge ${colorClass} badge-xs` }, text)

const formatCell = (cell) => {
  if (!cell || cell.length === 0) return h('span', {}, '—')
  return h(
    'div',
    { class: 'text-xs' },
    cell.map((item) =>
      h('div', { class: 'flex flex-col gap-1 items-center' }, [
        createBadge(item.subject.name, 'badge-primary whitespace-nowrap'),
        item.isGroup
          ? h('div', { class: 'flex flex-col gap-0.5 items-center' }, [
              createBadge('Group Class', 'badge-secondary'),
              ...item.students.map((student) => createBadge(student.name, 'badge-neutral')),
            ])
          : createBadge(item.student.name, 'badge-neutral'),
        createBadge(item.room.name, 'badge-error'),
      ])
    )
  )
}

async function loadTeacherSchedule() {
  // fetch timeslots once
  if (!timeslots.length) {
    timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
  }

  // fetch teachers once
  if (!cachedTeachers.length) {
    cachedTeachers = await pb.collection('teacher').getFullList({ sort: 'name' })
  }

  // fetch individual lessons for this day
  const individualSchedulesPage = await pb.collection('lessonSchedule').getList(1, 200, {
    filter: `date = "${date}"`,
    expand: 'teacher,student,subject,room,timeslot',
  })

  // fetch group lessons for this day
  const groupSchedulesPage = await pb.collection('groupLessonSchedule').getList(1, 200, {
    filter: `date = "${date}"`,
    expand: 'teacher,student,subject,grouproom,timeslot',
  })

  const individualSchedules = individualSchedulesPage.items
  const groupSchedules = groupSchedulesPage.items

  // process individual schedules
  const studentAssignments = new Map()
  for (const s of individualSchedules) {
    const studentKey = `${s.expand.student?.id}_${s.expand.subject?.id}_${s.expand.timeslot?.id}`
    studentAssignments.set(studentKey, {
      ...s,
      isGroup: false,
      room: s.expand.room,
      student: s.expand.student,
      students: null,
    })
  }

  // process group schedules
  for (const s of groupSchedules) {
    const groupKey = `group_${s.id}_${s.expand.subject?.id}_${s.expand.timeslot?.id}`
    studentAssignments.set(groupKey, {
      ...s,
      isGroup: true,
      room: s.expand.grouproom, // use grouproom instead of room
      student: null,
      students: Array.isArray(s.expand.student) ? s.expand.student : [],
    })
  }

  // group by teacher group them by teacher
  const grouped = {}
  for (const s of studentAssignments.values()) {
    const { teacher, timeslot } = s.expand
    const teacherId = teacher?.id
    if (!grouped[teacherId]) {
      grouped[teacherId] = {
        teacher: teacher?.name,
        slots: {},
      }
    }
    const timeslotId = timeslot?.id
    if (!grouped[teacherId].slots[timeslotId]) {
      grouped[teacherId].slots[timeslotId] = []
    }
    grouped[teacherId].slots[timeslotId].push(s)
  }

  // build columns once
  if (!columns) {
    columns = [
      { name: 'Teacher', formatter: (cell) => cell.value },
      ...timeslots.map((t) => ({
        name: `${t.start} - ${t.end}`,
        formatter: formatCell,
      })),
    ]
  }

  // build rows (sorted by teacher name)
  const data = cachedTeachers.map((teacher) => {
    const entry = grouped[teacher.id] || { teacher: teacher.name, slots: {} }
    const row = [{ label: 'Teacher', value: entry.teacher }]
    timeslots.forEach((t) => {
      const slotData = entry.slots?.[t.id] || []
      row.push(
        slotData.map((item) => ({
          subject: item.expand.subject,
          student: item.student,
          students: item.students,
          room: item.room,
          isGroup: item.isGroup,
        }))
      )
    })
    return row
  })

  // reuse grid instance use the erquestanimationframe so that when next and previous the table changes also the data
  if (teacherGrid) {
    requestAnimationFrame(() => {
      teacherGrid.updateConfig({ data }).forceRender()
    })
  } else {
    teacherGrid = new Grid({
      columns,
      data,
      search: {
        enabled: true,
        selector: (cell) => (typeof cell === 'string' ? cell : cell?.value || ''),
      },
      sort: false,
      className: {
        table: 'w-full border text-sm relative',
        th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
        td: 'border p-2 whitespace-pre-line align-middle text-center font-semibold',
      },
    }).render(document.getElementById('teacherGrid'))
  }
}

const debouncedLoad = debounce(loadTeacherSchedule, 250)

onMount(() => {
  loadTeacherSchedule()
  // react to PocketBase changes for both collections
  pb.collection('lessonSchedule').subscribe('*', debouncedLoad)
  pb.collection('groupLessonSchedule').subscribe('*', debouncedLoad)
})

onDestroy(() => {
  console.log('TeacherView Table destroyed')
  if (teacherGrid) {
    teacherGrid.destroy()
    teacherGrid = null
  }
  // properly unsubscribe don't think so...
  pb.collection('lessonSchedule').unsubscribe('*', debouncedLoad)
  pb.collection('groupLessonSchedule').unsubscribe('*', debouncedLoad)
})

{
  /* <div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex item-center justify-between mb-4">
    <h2 class="text-2xl font-bold text-primary">Teacher</h2>
    <h2 class="text-2xl font-bold text-primary text-center flex-1">Schedule Table</h2>
  </div>

  <!-- Filter row -->
  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Filter Date:</label>
      <input
        type="date"
        id="filterDate"
        name="filterDate"
        bind:value={date}
        class="input input-bordered input-sm w-40"
        onchange={debouncedLoad}
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

<style>
  .gridjs-table {
    max-height: 500px;
    overflow: auto;
  }
</style> */
}
