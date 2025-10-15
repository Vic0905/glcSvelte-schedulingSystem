<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #studentGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #studentGrid th { position: sticky; top: 0; z-index: 20; box-shadow: 0 1px 0 #ddd; }
    #studentGrid th:nth-child(1), #studentGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(1) { z-index: 25; }
    #studentGrid th:nth-child(2), #studentGrid td:nth-child(2) { position: sticky; left: 150px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(2) { z-index: 25; }
    #studentGrid th:nth-child(3), #studentGrid td:nth-child(3) { position: sticky; left: 300px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(3) { z-index: 25; }
    #studentGrid th:nth-child(4), #studentGrid td:nth-child(4) { position: sticky; left: 450px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(4) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let studentGrid = null
  let timeslots = []
  let isLoading = $state(false)

  function getWeekStart(date) {
    const d = new Date(date)
    const diff = d.getDay() === 0 ? -5 : d.getDay() === 1 ? 1 : 2 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekDays(startDate) {
    const start = new Date(startDate)
    return Array.from({ length: 4 }, (_, i) => {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      return day.toISOString().split('T')[0]
    })
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    return `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadStudentSchedule()
  }

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
            h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name || ''),
            h('span', { class: 'badge badge-info badge-xs' }, item.teacher?.name || ''),
            item.isGroup && h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'),
            h('span', { class: 'badge badge-error badge-xs' }, item.room?.name || ''),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadStudentSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      const [timeslotsData, students, individualSchedules, groupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('lessonSchedule').getList(1, 200, {
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupLessonSchedule').getList(1, 200, {
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData

      // Build schedule map
      const scheduleMap = {}
      students.forEach((s) => {
        scheduleMap[s.id] = {
          student: s.name,
          englishName: s.englishName || '',
          course: s.course || '',
          level: s.level || '',
          slots: {},
        }
      })

      // Process individual schedules
      for (const s of individualSchedules.items) {
        const studentId = s.expand?.student?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!studentId || !timeslotId || !scheduleMap[studentId]) continue

        scheduleMap[studentId].slots[timeslotId] ??= {
          subject: s.expand?.subject,
          teacher: s.expand?.teacher,
          room: s.expand?.room,
          isGroup: false,
        }
      }

      // Process group schedules
      for (const s of groupSchedules.items) {
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        const timeslotId = s.expand?.timeslot?.id
        if (!timeslotId) continue

        students.forEach((student) => {
          if (!scheduleMap[student.id]) return
          scheduleMap[student.id].slots[timeslotId] ??= {
            subject: s.expand?.subject,
            teacher: s.expand?.teacher,
            room: s.expand?.grouproom,
            isGroup: true,
          }
        })
      }

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

      const columns = [
        { name: 'Student', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'English Name', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Course', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Level', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (studentGrid) {
        const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        studentGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#studentGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
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
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('studentGrid'))
      }
    } catch (error) {
      console.error('Error loading schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadStudentSchedule, 150)
  }

  onMount(() => {
    loadStudentSchedule()
    pb.collection('lessonSchedule').subscribe('*', debouncedReload)
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    studentGrid?.destroy()
    pb.collection('lessonSchedule').unsubscribe()
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Student View Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
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
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
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

  <div id="studentGrid" class="border rounded-lg"></div>
</div>
