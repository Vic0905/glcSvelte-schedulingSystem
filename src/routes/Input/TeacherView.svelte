<script>
  import { onMount, onDestroy } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'

  let date = new Date().toISOString().split('T')[0]
  let currentDate = new Date()
  let teacherGrid,
    columns,
    timeslots = []

  const changeDate = (days) => {
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadTeacherSchedule()
  }

  const createBadge = (text, colorClass) => h('div', { class: `badge ${colorClass} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.length === 0) return h('span', {}, '—')
    return h(
      'div',
      {
        class: 'w-full max-w-full rounded p-2 flex flex-col gap-1 text-xs justify-left items-left whitespace-nowrap',
      },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1' }, [
          createBadge(item.subject.name, 'badge-primary'),
          // createBadge(item.teacher.name, 'badge-success'),
          createBadge(item.student.name, 'badge-accent'),
          createBadge(item.room.name, 'badge-error'),
        ])
      )
    )
  }

  async function loadTeacherSchedule() {
    if (!timeslots.length) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }

    const schedules = await pb.collection('lessonSchedule').getFullList({
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,room,timeslot',
    })

    // Deduplicate and group by teacher
    const studentAssignments = new Map()
    const grouped = {}

    for (const s of schedules) {
      const studentKey = `${s.expand.student?.name}_${s.expand.subject?.name}_${s.expand.timeslot?.id}`
      studentAssignments.set(studentKey, s)
    }

    for (const s of studentAssignments.values()) {
      const { teacher, room, timeslot } = s.expand
      const teacherId = teacher?.id

      if (!grouped[teacherId]) {
        grouped[teacherId] = {
          teacher: teacher?.name,
          room: room?.name || '—',
          slots: {},
        }
      }

      const timeslotId = timeslot?.id
      if (!grouped[teacherId].slots[timeslotId]) {
        grouped[teacherId].slots[timeslotId] = []
      }

      grouped[teacherId].slots[timeslotId].push(s)
    }

    // Build columns once
    if (!columns) {
      columns = [
        { name: 'Teacher', formatter: (cell) => cell.value },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          formatter: formatCell,
        })),
      ]
    }

    // Build data rows
    const data = Object.values(grouped)
      .sort((a, b) => a.teacher.localeCompare(b.teacher, undefined, { numeric: true }))
      .map((entry) => {
        const row = [{ label: 'Teacher', value: entry.teacher }]
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
          selector: (cell) => {
            if (typeof cell === 'string') return cell
            return cell?.value || ''
          },
        },
        sort: false,
        pagination: false,
        className: {
          table: 'w-full border text-sm max-w-[750px]',
          th: 'bg-base-200 p-2 border text-center',
          td: 'border p-2 whitespace-pre-line align-top text-center font-semibold',
        },
      }).render(document.getElementById('teacherGrid'))
    }
  }

  onMount(() => {
    loadTeacherSchedule()
    pb.collection('lessonSchedule').subscribe('*', loadTeacherSchedule)
  })

  onDestroy(() => {
    if (teacherGrid) {
      teacherGrid.destroy()
      teacherGrid = null
    }
    pb.collection('lessonSchedule').unsubscribe()
  })
</script>

<div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex item-center justify-between mb-4">
    <h2 class="text-2xl font-bold text-primary">Teacher</h2>
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

  <div id="teacherGrid" class="overflow-x-auto"></div>
</div>
