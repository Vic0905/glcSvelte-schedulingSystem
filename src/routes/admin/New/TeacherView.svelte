<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let teacherGrid = $state(null)
  let weekStart = $state(getWeekStart(new Date()))
  let isLoading = $state(false)

  // Stable data — fetched once
  let cachedTimeslots = []
  let cachedRoomTypes = []
  let cachedTeachers = []
  let teacherRoomMap = new Map()

  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day < 2 ? day + 5 : day - 2
    d.setDate(d.getDate() - diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    const opts = { month: 'long', day: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }

  const changeWeek = async (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    await loadSchedules()
  }

  function handleToast(e, label = 'Schedule') {
    const messages = { create: `${label} created`, update: `${label} updated`, delete: `${label} deleted` }
    const types = { create: toast.success, update: toast.info, delete: toast.error }
    if (types[e.action]) types[e.action](messages[e.action])
  }

  const formatCell = (cell) => {
    if (!cell?.schedules?.length) return h('span', { class: 'text-gray-400' }, '—')

    const { schedules } = cell
    return h('div', { class: 'flex flex-col gap-1 p-1 items-center text-center' }, [
      h('div', { class: 'font-bold text-neutral-700 border-b border-base-700 mb-1 pb-1 w-full' }, [
        h('div', {}, schedules[0].subject?.name || 'No Subject'),
        h('span', { class: 'badge badge-ghost badge-xs' }, schedules[0].roomName || 'No Room'),
      ]),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-1' },
        schedules.flatMap((s) =>
          s.students.map((std) => h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, std.name))
        )
      ),
    ])
  }

  async function loadStaticData() {
    const [timeslots, roomTypes, teachers] = await Promise.all([
      pb.collection('timeslot').getFullList({ sort: 'start' }),
      pb.collection('roomType').getFullList({ sort: 'name', expand: 'teacher' }),
      pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
    ])
    cachedTimeslots = timeslots
    cachedRoomTypes = roomTypes
    cachedTeachers = teachers
    teacherRoomMap = new Map(roomTypes.filter((rt) => rt.expand?.teacher).map((rt) => [rt.expand.teacher.id, rt.name]))
  }

  async function loadSchedules() {
    if (isLoading) return
    isLoading = true
    try {
      const endD = new Date(weekStart)
      endD.setDate(endD.getDate() + 3)
      const endDateStr = `${endD.toISOString().split('T')[0]} 23:59:59`

      const schedules = await pb.collection('schedule').getFullList({
        filter: `start <= "${endDateStr}" && end >= "${weekStart} 00:00:00"`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      // Build scheduleMap: "teacherId-timeslotId" -> [entries]
      const scheduleMap = new Map()
      const bookedTeacherIds = new Set()

      schedules.forEach((s) => {
        const tId = s.expand?.teacher?.id
        const tsId = s.expand?.timeslot?.id
        if (!tId || !tsId) return
        bookedTeacherIds.add(tId)
        const key = `${tId}-${tsId}`
        if (!scheduleMap.has(key)) scheduleMap.set(key, [])
        scheduleMap.get(key).push({
          subject: s.expand?.subject,
          students: s.expand?.student ? [{ name: s.expand.student.englishName }] : [],
          roomName: s.expand?.room?.name ?? null,
        })
      })

      // Show all non-disabled teachers + any disabled teacher who has a booking this week
      const teachers = cachedTeachers
        .filter((t) => t.status !== 'disabled' || bookedTeacherIds.has(t.id))
        .sort((a, b) => {
          const aRoom = teacherRoomMap.get(a.id),
            bRoom = teacherRoomMap.get(b.id)
          const getWeight = (room) => (room ? 1 : 2)
          if (getWeight(aRoom) !== getWeight(bRoom)) return getWeight(aRoom) - getWeight(bRoom)
          return (aRoom || a.name).localeCompare(bRoom || b.name)
        })

      const data = teachers.map((t) => [
        { value: t.name, status: t.status },
        { value: teacherRoomMap.get(t.id) || '—' },
        ...cachedTimeslots.map((ts) => ({ schedules: scheduleMap.get(`${t.id}-${ts.id}`) || [] })),
      ])

      if (teacherGrid) {
        const wrapper = document.querySelector('#teacherGridNew .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }
        teacherGrid.updateConfig({ data }).forceRender()
        requestAnimationFrame(() => {
          const w = document.querySelector('#teacherGridNew .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        const columns = [
          {
            name: 'Teacher',
            width: '150px',
            formatter: (c) =>
              h(
                'div',
                { class: 'flex flex-col items-center text-neutral-700 font-bold' },
                [
                  h('span', {}, c.value),
                  c.status === 'new' ? h('span', { class: 'badge badge-success badge-xs' }, 'New') : null,
                ].filter(Boolean)
              ),
          },
          {
            name: 'Room',
            width: '120px',
            formatter: (c) => h('div', { class: 'text-center font-bold text-neutral-700' }, c.value),
          },
          ...cachedTimeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '180px', formatter: formatCell })),
        ]
        teacherGrid = new Grid({
          columns,
          data,
          className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('teacherGridNew'))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load teacher schedule')
    } finally {
      isLoading = false
    }
  }

  $effect(() => {
    loadStaticData().then(loadSchedules)

    const subSchedule = pb.collection('schedule').subscribe('*', (e) => {
      handleToast(e, 'Schedule')
      loadSchedules()
    })

    // Invalidate static cache + reload if rooms or teachers change
    const subRoomType = pb.collection('roomType').subscribe('*', async () => {
      await loadStaticData()
      loadSchedules()
    })
    const subTeacher = pb.collection('teacher').subscribe('*', async () => {
      await loadStaticData()
      loadSchedules()
    })

    return () => {
      subSchedule.then((u) => u())
      subRoomType.then((u) => u())
      subTeacher.then((u) => u())
      teacherGrid?.destroy()
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Teacher View Table (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between relative">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {getWeekRangeDisplay(weekStart)}
    </h3>
    <div class="ml-auto flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="teacherGridNew" class="border rounded-lg"></div>
</div>

<style>
  #teacherGridNew :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  #teacherGridNew :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  #teacherGridNew :global(th:nth-child(1)),
  #teacherGridNew :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background: white;
  }

  #teacherGridNew :global(th:nth-child(1)) {
    z-index: 25;
    background-color: #484b4f;
  }

  #teacherGridNew :global(th:nth-child(2)),
  #teacherGridNew :global(td:nth-child(2)) {
    position: sticky;
    left: 150px;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background: white;
  }

  #teacherGridNew :global(th:nth-child(2)) {
    z-index: 25;
    background-color: #484b4f;
  }
</style>
