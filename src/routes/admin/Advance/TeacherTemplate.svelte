<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #teacherGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #teacherGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #teacherGrid th:nth-child(1), #teacherGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
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
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 items-center' }, [
          h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name ?? 'No Subject'),
          item.isGroup
            ? h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class')
            : h('span', { class: 'badge badge-neutral badge-xs' }, item.student?.englishName ?? 'No Student'),
          h('span', { class: 'badge badge-error badge-xs' }, item.room?.name ?? 'No Room'),
        ])
      )
    )
  }

  async function loadTeacherSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, teachersData, individualBookings, groupBookings] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        teachers.length ? teachers : pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('advanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      teachers = teachersData

      // Build schedule map
      const scheduleMap = {}

      // Process individual bookings
      for (const b of individualBookings.items) {
        const teacherId = b.expand?.teacher?.id
        const timeslotId = b.expand?.timeslot?.id
        const studentId = b.expand?.student?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        scheduleMap[teacherId][timeslotId][studentId] = {
          subject: b.expand?.subject,
          student: b.expand?.student,
          room: b.expand?.room,
          isGroup: false,
        }
      }

      // Process group bookings
      for (const b of groupBookings.items) {
        const teacherId = b.expand?.teacher?.id
        const timeslotId = b.expand?.timeslot?.id
        const subjectId = b.expand?.subject?.id
        const roomId = b.expand?.grouproom?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        const key = `group_${subjectId}_${roomId}`
        scheduleMap[teacherId][timeslotId][key] = {
          subject: b.expand?.subject,
          student: null,
          room: b.expand?.grouproom,
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

        teacherGrid.updateConfig({ columns, data }).forceRender()

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

  onMount(() => {
    loadTeacherSchedule()
    pb.collection('advanceBooking').subscribe('*', loadTeacherSchedule)
    pb.collection('groupAdvanceBooking').subscribe('*', loadTeacherSchedule)
  })

  onDestroy(() => {
    teacherGrid?.destroy()
    teacherGrid = null
    pb.collection('advanceBooking').unsubscribe()
    pb.collection('groupAdvanceBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Teacher View Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex items-center justify-between gap-4 ml-20">
    <h3 class="text-xl font-semibold text-primary flex-1 text-center">{getWeekRangeDisplay(weekStart)}</h3>

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

  <div id="teacherGrid" class="border rounded-lg"></div>
</div>
