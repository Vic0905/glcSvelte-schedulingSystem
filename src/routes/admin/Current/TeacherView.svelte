<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #teacherGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #teacherGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #teacherGrid th:nth-child(1), #teacherGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15;  box-shadow: inset -1px 0 0 #ddd; }
    #teacherGrid th:nth-child(1) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let teacherGrid = null
  let timeslots = []
  let teachers = []
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
    loadTeacherSchedule()
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) => {
        const badges = [h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name ?? 'No Subject')]

        if (item.isGroup) {
          badges.push(h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'))
        } else {
          badges.push(h('span', { class: 'badge badge-neutral badge-xs' }, item.student?.englishName ?? 'No Student'))
          if (item.student?.status === 'new') {
            badges.push(h('span', { class: 'badge badge-success badge-xs' }, 'NEW'))
          }
        }

        badges.push(h('span', { class: 'badge badge-error badge-xs' }, item.room?.name ?? 'No Room'))

        return h('div', { class: 'flex flex-col gap-1 items-center' }, badges)
      })
    )
  }

  async function loadTeacherSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      const [timeslotsData, teachersData, individualSchedules, groupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        teachers.length ? teachers : pb.collection('teacher').getFullList({ sort: 'name' }),
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
      teachers = teachersData

      // Build schedule map
      const scheduleMap = {}

      // Process individual lessons
      for (const s of individualSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        const studentId = s.expand?.student?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        scheduleMap[teacherId][timeslotId][studentId] = {
          subject: s.expand?.subject,
          student: s.expand?.student,
          room: s.expand?.room,
          isGroup: false,
        }
      }

      // Process group lessons
      for (const s of groupSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        const subjectId = s.expand?.subject?.id
        const roomId = s.expand?.grouproom?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        const key = `group_${subjectId}_${roomId}`
        scheduleMap[teacherId][timeslotId][key] = {
          subject: s.expand?.subject,
          student: null,
          room: s.expand?.grouproom,
          isGroup: true,
        }
      }

      // Build table data
      const data = teachers.map((teacher) => {
        const teacherSchedule = scheduleMap[teacher.id] || {}
        return [
          { value: teacher.name },
          ...timeslots.map((ts) => {
            const schedules = teacherSchedule[ts.id]
            return schedules ? Object.values(schedules) : []
          }),
        ]
      })

      const columns = [
        { name: 'Teacher', width: '120px', formatter: (cell) => cell.value },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (teacherGrid) {
        const wrapper = document.querySelector('#teacherGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        teacherGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#teacherGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        teacherGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 text-center align-middle',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('teacherGrid'))
      }
    } catch (error) {
      console.error('Error loading teacher schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadTeacherSchedule, 150)
  }

  onMount(() => {
    loadTeacherSchedule()
    pb.collection('lessonSchedule').subscribe('*', debouncedReload)
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    teacherGrid?.destroy()
    pb.collection('lessonSchedule').unsubscribe()
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Teacher View Table (Current)</h2>
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
        onchange={loadTeacherSchedule}
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span> Subject</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span> Student</div>
      <div class="flex gap-1"><span class="badge badge-Success badge-xs"></span> New Student</div>
      <div class="flex gap-1"><span class="badge badge-secondary badge-xs"></span> Group Lesson</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span> Room</div>
    </div>
  </div>

  <div id="teacherGrid" class="border rounded-lg"></div>
</div>
