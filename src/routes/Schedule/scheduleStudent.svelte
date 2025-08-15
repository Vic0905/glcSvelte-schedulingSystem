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

  const prevDate = () => {
    currentDate.setDate(currentDate.getDate() - 1)
    date = currentDate.toISOString().split('T')[0]
    loadStudentSchedule()
  }

  const nextDate = () => {
    currentDate.setDate(currentDate.getDate() + 1)
    date = currentDate.toISOString().split('T')[0]
    loadStudentSchedule()
  }

  async function loadStudentSchedule() {
    if (timeslots.length === 0) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }

    const schedules = await pb.collection('lessonSchedule').getFullList({
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,room,timeslot',
    })

    // Group by student (no deduplication)
    const grouped = {}
    for (const s of schedules) {
      const student = s.expand.student
      const studentId = student?.id
      const studentName = student?.name
      const englishName = student?.englishName || ''
      const course = student?.course || ''
      const level = student?.level || ''

      if (!grouped[studentId]) {
        grouped[studentId] = {
          student: studentName,
          englishName,
          course,
          level,
          slots: {},
        }
      }

      const timeslotId = s.expand.timeslot?.id
      if (!grouped[studentId].slots[timeslotId]) {
        grouped[studentId].slots[timeslotId] = []
      }

      grouped[studentId].slots[timeslotId].push(s)
    }

    if (!columns) {
      columns = [
        {
          name: 'Student',
          formatter: (cell) => h('div', { className: 'text-xs font-semibold' }, cell.value),
        },
        {
          name: 'English Name',
          formatter: (cell) => h('div', { className: 'text-xs' }, cell.value),
        },
        {
          name: 'Course',
          formatter: (cell) => h('div', { className: 'text-xs' }, cell.value),
        },
        {
          name: 'Level',
          formatter: (cell) => h('div', { className: 'text-xs' }, cell.value),
        },

        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          formatter: (cell) => {
            if (!cell || cell.length === 0) return h('span', {}, '—')
            return h(
              'div',
              {
                class:
                  'w-full max-w-full rounded p-2 flex flex-col gap-1 text-xs justify-center items-left whitespace-nowrap',
              },
              cell.map((item) =>
                h('div', { class: 'flex flex-col gap-1' }, [
                  h('div', { class: 'badge badge-primary badge-xs' }, `${item.subject.name}`),
                  h('div', { class: 'badge badge-success badge-xs' }, `${item.teacher.name}`),
                  h('div', { class: 'badge badge-error badge-xs' }, `${item.room.name}`),
                ])
              )
            )
          },
        })),
      ]
    }

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
            }))
          )
        })

        return row
      })

    // Grid reuse
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
            if (cell?.value) return cell.value
            return ''
          },
        },
        sort: false,
        pagination: false,
        className: {
          table: 'w-full border text-sm',
          th: 'bg-base-200 p-2 border text-center',
          td: 'border p-2 whitespace-nowrap align-middle text-center',
        },
      }).render(document.getElementById('studentGrid'))
    }
  }

  onMount(() => {
    loadStudentSchedule()
    pb.collection('lessonSchedule').subscribe('*', loadStudentSchedule)
  })

  onDestroy(() => {
    if (studentGrid) {
      studentGrid.destroy()
      studentGrid = null
    }
    pb.collection('lessonSchedule').unsubscribe()
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
      <button class="btn btn-outline btn-sm" onclick={prevDate}>&larr; </button>
      <button class="btn btn-outline btn-sm" onclick={nextDate}> &rarr;</button>
    </div>
  </div>

  <div id="studentGrid" class="overflow-x-auto"></div>
</div>

<style>
</style>
