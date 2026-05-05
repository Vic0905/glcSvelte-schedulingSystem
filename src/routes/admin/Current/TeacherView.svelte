<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let weekStart = $state(getWeekStart(new Date()))
  let teacherGrid = null
  let isLoading = $state(false)

  let cachedTimeslots = []
  let cachedTeachers = []

  function getWeekStart(date) {
    const d = new Date(date)
    const diff = d.getDay() === 0 ? -5 : d.getDay() === 1 ? 1 : 2 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
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

  // --- Toast Handler ---
  function handleToast(e, label = 'Schedule') {
    const messages = { create: `${label} created`, update: `${label} updated`, delete: `${label} deleted` }
    const types = { create: toast.success, update: toast.info, delete: toast.error }
    if (types[e.action]) types[e.action](messages[e.action])
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) => {
        const isNewStudent = !item.isGroup && item.student?.status === 'new'
        return h(
          'div',
          { class: 'flex flex-col gap-1 p-1 items-center text-center' },
          [
            h('div', { class: 'font-bold text-neutral-700 border-b border-base-500 mb-1 pb-1 w-full' }, [
              h('div', {}, item.subject?.name ?? 'No Subject'),
            ]),
            item.isGroup
              ? h('span', { class: 'badge badge-ghost badge-xs' }, 'Group Class')
              : h('span', { class: 'badge badge-ghost badge-xs' }, item.student?.englishName || 'Unknown Student'),
            isNewStudent ? h('span', { class: 'text-[10px] font-bold text-success uppercase mt-[-2px]' }, 'new') : null,
            h('span', { class: 'badge badge-ghost badge-xs' }, item.room?.name ?? 'No Room'),
          ].filter(Boolean)
        )
      })
    )
  }

  async function loadTeacherSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslots, allTeachers, individualSchedules, groupSchedules, roomList, groupRoomList] = await Promise.all([
        cachedTimeslots.length
          ? cachedTimeslots
          : pb.collection('timeSlot').getFullList({ sort: 'start', fields: 'id,start,end' }),
        cachedTeachers.length
          ? cachedTeachers
          : pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('lessonSchedule').getFullList({
          filter: `date = "${weekStart}"`,
          expand: 'teacher,student,subject,room,timeslot',
          fields:
            'expand.teacher.id,expand.student.id,expand.student.englishName,expand.student.status,expand.subject.name,expand.room.name,expand.timeslot.id',
        }),
        pb.collection('groupLessonSchedule').getFullList({
          filter: `date = "${weekStart}"`,
          expand: 'teacher,subject,grouproom,timeslot',
          fields: 'expand.teacher.id,expand.subject.name,expand.grouproom.name,expand.grouproom.id,expand.timeslot.id',
        }),
        pb.collection('room').getFullList({ expand: 'teacher', fields: 'name,teacher,id' }),
        pb.collection('grouproom').getFullList({ expand: 'teacher', fields: 'name,teacher,id' }),
      ])

      cachedTimeslots = timeslots
      cachedTeachers = allTeachers

      const teacherAssignmentMap = {}
      roomList.forEach((r) => {
        if (r.teacher) teacherAssignmentMap[r.teacher] = { type: 'room', name: r.name }
      })
      groupRoomList.forEach((gr) => {
        if (gr.teacher && !teacherAssignmentMap[gr.teacher])
          teacherAssignmentMap[gr.teacher] = { type: 'grouproom', name: gr.name }
      })

      const bookedTeacherIds = new Set([
        ...individualSchedules.map((s) => s.expand?.teacher?.id),
        ...groupSchedules.map((s) => s.expand?.teacher?.id),
      ])

      const filteredTeachers = allTeachers
        .filter((t) => t.status !== 'disabled' || bookedTeacherIds.has(t.id))
        .sort((a, b) => {
          const aAssign = teacherAssignmentMap[a.id],
            bAssign = teacherAssignmentMap[b.id]
          const getWeight = (assign) => (!assign ? 3 : assign.type === 'room' ? 1 : 2)
          if (getWeight(aAssign) !== getWeight(bAssign)) return getWeight(aAssign) - getWeight(bAssign)
          return (aAssign?.name || a.name).localeCompare(bAssign?.name || b.name)
        })

      const scheduleMap = {}
      const process = (s, isGroup) => {
        const tId = s.expand?.teacher?.id,
          tsId = s.expand?.timeslot?.id
        if (!tId || !tsId) return
        scheduleMap[tId] ??= {}
        scheduleMap[tId][tsId] ??= []
        scheduleMap[tId][tsId].push({
          subject: s.expand?.subject,
          student: s.expand?.student,
          room: isGroup ? s.expand?.grouproom : s.expand?.room,
          isGroup,
        })
      }
      individualSchedules.forEach((s) => process(s, false))
      groupSchedules.forEach((s) => process(s, true))

      const data = filteredTeachers.map((t) => [
        { rawName: t.name, status: t.status },
        { room: teacherAssignmentMap[t.id]?.name || null },
        ...timeslots.map((ts) => scheduleMap[t.id]?.[ts.id] || []),
      ])

      const columns = [
        {
          name: 'Teacher',
          width: '150px',
          formatter: (cell) =>
            h(
              'div',
              { class: 'flex flex-col items-center text-neutral-700 font-bold' },
              [
                h('span', { class: 'font-semibold' }, cell.rawName),
                cell.status === 'new' && h('span', { class: 'badge badge-success badge-xs' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'Room',
          width: '120px',
          formatter: (c) => h('div', { class: 'text-center text-neutral-700 font-bold' }, c?.room || '—'),
        },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '180px', formatter: formatCell })),
      ]

      if (teacherGrid) {
        const wrapper = document.querySelector('#teacherGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }
        teacherGrid.updateConfig({ data, columns }).forceRender()
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
          className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('teacherGrid'))
      }
    } catch (error) {
      console.error(error)
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    loadTeacherSchedule()

    // Subscribe with Toasts
    const sub1 = pb.collection('lessonSchedule').subscribe('*', (e) => {
      handleToast(e, 'Individual Lesson')
      loadTeacherSchedule()
    })
    const sub2 = pb.collection('groupLessonSchedule').subscribe('*', (e) => {
      handleToast(e, 'Group Lesson')
      loadTeacherSchedule()
    })

    return () => {
      sub1.then((u) => u())
      sub2.then((u) => u())
      teacherGrid?.destroy()
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
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
    <h3 class="text-xl font-semibold text-center mr-50">{getWeekRangeDisplay(weekStart)}</h3>
    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="teacherGrid" class="border rounded-lg"></div>
</div>

<style>
  /* Use :global() because Grid.js renders its own DOM outside Svelte's scope */
  #teacherGrid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  #teacherGrid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  /* First Column (Teacher) Sticky */
  #teacherGrid :global(th:nth-child(1)),
  #teacherGrid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background: white;
  }

  #teacherGrid :global(th:nth-child(1)) {
    z-index: 25;
    background-color: #484b4f;
  }

  /* Second Column (Room) Sticky */
  #teacherGrid :global(th:nth-child(2)),
  #teacherGrid :global(td:nth-child(2)) {
    position: sticky;
    left: 150px;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background: white;
  }

  #teacherGrid :global(th:nth-child(2)) {
    z-index: 25;
    background-color: #484b4f;
  }
</style>
