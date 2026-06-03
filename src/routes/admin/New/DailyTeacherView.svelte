<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let currentDate = $state(getTodayDate())
  let isLoading = $state(false)
  let grid = null
  let unsubSchedule = null
  let unsubRoomType = null
  let unsubTeacher = null

  let cachedTimeslots = []
  let cachedTeachers = []
  let teacherRoomMap = new Map()

  function getTodayDate() {
    return new Date().toISOString().split('T')[0]
  }

  function isWeekend(dateStr) {
    const day = new Date(dateStr).getDay()
    return day === 0 || day === 6
  }

  function stepDay(dateStr, delta) {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + delta)
    while (isWeekend(d.toISOString().split('T')[0])) {
      d.setDate(d.getDate() + delta)
    }
    return d.toISOString().split('T')[0]
  }

  function formatDateDisplay(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  const changeDay = async (delta) => {
    const wrapper = document.querySelector('#teacherGridDaily .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    currentDate = stepDay(currentDate, delta)
    await load(savedScrollTop, savedScrollLeft)
  }

  const onDateChange = async (e) => {
    const wrapper = document.querySelector('#teacherGridDaily .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    currentDate = e.target.value
    await load(savedScrollTop, savedScrollLeft)
  }

  const goToToday = async () => {
    const wrapper = document.querySelector('#teacherGridDaily .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    currentDate = getTodayDate()
    if (isWeekend(currentDate)) currentDate = stepDay(currentDate, 1)
    await load(savedScrollTop, savedScrollLeft)
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
    cachedTeachers = teachers
    teacherRoomMap = new Map(roomTypes.filter((rt) => rt.expand?.teacher).map((rt) => [rt.expand.teacher.id, rt.name]))
  }

  async function load(savedScrollTop = null, savedScrollLeft = null) {
    if (isLoading) return
    isLoading = true
    try {
      const dateFilter = `start <= "${currentDate} 23:59:59" && end >= "${currentDate} 00:00:00"`

      const schedules = await pb.collection('schedule').getFullList({
        filter: dateFilter,
        expand: 'teacher,student,subject,room,timeslot',
      })

      const scheduleMap = new Map()
      const bookedTeacherIds = new Set()

      for (const s of schedules) {
        const tId = s.expand?.teacher?.id
        const tsId = s.expand?.timeslot?.id
        if (!tId || !tsId) continue
        bookedTeacherIds.add(tId)
        const key = `${tId}-${tsId}`
        if (!scheduleMap.has(key)) scheduleMap.set(key, [])
        scheduleMap.get(key).push({
          subject: s.expand?.subject,
          students: s.expand?.student ? [{ name: s.expand.student.englishName }] : [],
          roomName: s.expand?.room?.name ?? null,
        })
      }

      const teachers = cachedTeachers
        .filter((t) => t.status !== 'disabled' || bookedTeacherIds.has(t.id))
        .sort((a, b) => {
          const aRoom = teacherRoomMap.get(a.id)
          const bRoom = teacherRoomMap.get(b.id)
          const getWeight = (room) => (room ? 1 : 2)
          if (getWeight(aRoom) !== getWeight(bRoom)) return getWeight(aRoom) - getWeight(bRoom)
          return (aRoom || a.name).localeCompare(bRoom || b.name)
        })

      const data = teachers.map((t) => [
        { value: t.name, status: t.status },
        { value: teacherRoomMap.get(t.id) || '—' },
        ...cachedTimeslots.map((ts) => ({ schedules: scheduleMap.get(`${t.id}-${ts.id}`) || [] })),
      ])

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
                c.status === 'new' && h('span', { class: 'badge badge-success badge-xs' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'Room',
          width: '120px',
          formatter: (c) => h('div', { class: 'text-center font-bold text-neutral-700' }, c.value),
        },
        ...cachedTimeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '180px',
          formatter: formatCell,
        })),
      ]

      if (grid) {
        if (savedScrollTop === null) {
          const wrapper = document.querySelector('#teacherGridDaily .gridjs-wrapper')
          savedScrollTop = wrapper?.scrollTop ?? 0
          savedScrollLeft = wrapper?.scrollLeft ?? 0
        }

        grid.updateConfig({ data, columns }).forceRender()

        requestAnimationFrame(() => {
          const wrapper = document.querySelector('#teacherGridDaily .gridjs-wrapper')
          if (wrapper) {
            wrapper.scrollTop = savedScrollTop
            wrapper.scrollLeft = savedScrollLeft
          }
        })
      } else {
        grid = new Grid({
          columns,
          data,
          className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('teacherGridDaily'))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load teacher schedule')
    } finally {
      isLoading = false
    }
  }

  onMount(async () => {
    if (isWeekend(currentDate)) {
      currentDate = stepDay(currentDate, 1)
    }

    await loadStaticData()
    await load()

    const reloadWithScroll = () => {
      const wrapper = document.querySelector('#teacherGridDaily .gridjs-wrapper')
      const top = wrapper?.scrollTop ?? 0
      const left = wrapper?.scrollLeft ?? 0
      load(top, left)
    }

    unsubSchedule = await pb.collection('schedule').subscribe('*', reloadWithScroll)
    unsubRoomType = await pb.collection('roomType').subscribe('*', async () => {
      await loadStaticData()
      reloadWithScroll()
    })
    unsubTeacher = await pb.collection('teacher').subscribe('*', async () => {
      await loadStaticData()
      reloadWithScroll()
    })
  })

  onDestroy(() => {
    unsubSchedule?.()
    unsubRoomType?.()
    unsubTeacher?.()
    grid?.destroy()
    grid = null
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Teacher View Table (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between relative">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {formatDateDisplay(currentDate)}
    </h3>
    <div class="ml-auto flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={goToToday} disabled={isLoading || currentDate === getTodayDate()}>
        Today
      </button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(-1)} disabled={isLoading}>&larr;</button>
      <input
        type="date"
        class="input input-bordered input-sm"
        value={currentDate}
        onchange={onDateChange}
        disabled={isLoading}
      />
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="teacherGridDaily" class="border rounded-lg"></div>
</div>

<style>
  #teacherGridDaily :global(.gridjs-wrapper) {
    max-height: 600px;
    overflow: auto;
  }

  #teacherGridDaily :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  #teacherGridDaily :global(th:nth-child(1)),
  #teacherGridDaily :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background: white;
  }

  #teacherGridDaily :global(th:nth-child(1)) {
    z-index: 25;
    background-color: #484b4f;
  }

  #teacherGridDaily :global(th:nth-child(2)),
  #teacherGridDaily :global(td:nth-child(2)) {
    position: sticky;
    left: 150px;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background: white;
  }

  #teacherGridDaily :global(th:nth-child(2)) {
    z-index: 25;
    background-color: #484b4f;
  }
</style>
