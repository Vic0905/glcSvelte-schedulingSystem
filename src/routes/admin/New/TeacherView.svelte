<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #teacherGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #teacherGrid th { 
      position: sticky; 
      top: 0; 
      z-index: 20; 
      box-shadow: 0 1px 0 #ddd; 
      background-color: #484b4f; 
      color: #ffffff; 
    }
    #teacherGrid th:nth-child(1), #teacherGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; background: #fff; }
    #teacherGrid th:nth-child(1) { z-index: 25; background-color: #484b4f; }
    #teacherGrid th:nth-child(2), #teacherGrid td:nth-child(2) { position: sticky; left: 150px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; background: #fff; }
    #teacherGrid th:nth-child(2) { z-index: 25; background-color: #484b4f; }
  `

  const cache = {
    timeslots: null,
    teachers: null,
    rooms: null,
    grouprooms: null,
    schedules: new Map(),
    cacheDuration: 30000,
    isValid: (key) => {
      const cached = cache.schedules.get(key)
      return cached && Date.now() - cached.timestamp < cache.cacheDuration
    },
  }

  let weekStart = $state(getWeekStart(new Date()))
  let teacherGrid = null
  let isLoading = $state(false)
  let abortController = null
  let scrollPositions = $state({ top: 0, left: 0 })

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

  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#teacherGrid .gridjs-wrapper')
    if (wrapper) scrollPositions = { top: wrapper.scrollTop, left: wrapper.scrollLeft }
  }

  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#teacherGrid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center font-semibold' },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 items-center' }, [
          h('span', { class: 'badge badge-ghost badge-xs p-3' }, item.subject?.name || 'No Subject'),
          item.isGroup
            ? h('span', { class: 'badge badge-primary badge-outline badge-xs' }, 'Group Class')
            : h('span', { class: 'badge badge-ghost badge-xs' }, item.student?.englishName || 'One-on-One'),
          h('span', { class: 'badge badge-ghost badge-xs' }, item.room?.name || item.grouproom?.name || 'No Room'),
        ])
      )
    )
  }

  async function loadTeacherSchedule(forceRefresh = false) {
    if (isLoading) return
    abortController?.abort()
    abortController = new AbortController()

    saveScrollPosition()

    if (!forceRefresh && cache.isValid(weekStart)) {
      updateGrid(cache.schedules.get(weekStart).data)
      return
    }

    isLoading = true
    try {
      const filterStr = `start ~ "${weekStart}"`

      const [ts, tch, rms, grms, mtm, grp] = await Promise.all([
        !cache.timeslots ? pb.collection('timeSlot').getFullList({ sort: 'start' }) : Promise.resolve(cache.timeslots),
        !cache.teachers ? pb.collection('teacher').getFullList({ sort: 'name' }) : Promise.resolve(cache.teachers),
        !cache.rooms ? pb.collection('room').getFullList({ expand: 'teacher' }) : Promise.resolve(cache.rooms),
        !cache.grouprooms
          ? pb.collection('grouproom').getFullList({ expand: 'teacher' })
          : Promise.resolve(cache.grouprooms),
        pb
          .collection('MtmSchedule')
          .getFullList({ filter: filterStr, expand: 'teacher,student,subject,room,timeslot' }),
        pb
          .collection('GrpSchedule')
          .getFullList({ filter: filterStr, expand: 'teacher,student,subject,grouproom,timeslot' }),
      ])

      cache.timeslots = ts
      cache.teachers = tch
      cache.rooms = rms
      cache.grouprooms = grms

      const assignmentMap = new Map()
      rms.forEach((r) => r.teacher && assignmentMap.set(r.teacher, { name: r.name, type: 'room' }))
      grms.forEach(
        (g) =>
          g.teacher &&
          !assignmentMap.has(g.teacher) &&
          assignmentMap.set(g.teacher, { name: g.name, type: 'grouproom' })
      )

      const scheduleMap = new Map()
      mtm.forEach((s) => {
        const tid = s.expand?.teacher?.id
        const tsid = s.expand?.timeslot?.id
        if (!tid || !tsid) return
        if (!scheduleMap.has(tid)) scheduleMap.set(tid, new Map())
        if (!scheduleMap.get(tid).has(tsid)) scheduleMap.get(tid).set(tsid, [])
        scheduleMap
          .get(tid)
          .get(tsid)
          .push({ subject: s.expand?.subject, student: s.expand?.student, room: s.expand?.room, isGroup: false })
      })

      grp.forEach((s) => {
        const tid = s.expand?.teacher?.id
        const tsid = s.expand?.timeslot?.id
        if (!tid || !tsid) return
        if (!scheduleMap.has(tid)) scheduleMap.set(tid, new Map())
        if (!scheduleMap.get(tid).has(tsid)) scheduleMap.get(tid).set(tsid, [])
        scheduleMap.get(tid).get(tsid).push({ subject: s.expand?.subject, room: s.expand?.grouproom, isGroup: true })
      })

      // THE UPDATED SORTING LOGIC
      const data = cache.teachers
        .filter((t) => t.status !== 'disabled' || scheduleMap.has(t.id))
        .map((t) => {
          const tMap = scheduleMap.get(t.id) || new Map()
          const assign = assignmentMap.get(t.id)
          return {
            teacherObj: t,
            roomName: assign?.name || null,
            row: [
              { name: t.name },
              { roomName: assign?.name || '—' },
              ...cache.timeslots.map((ts) => tMap.get(ts.id) || []),
            ],
          }
        })
        .sort((a, b) => {
          if (a.roomName && !b.roomName) return -1
          if (!a.roomName && b.roomName) return 1
          if (a.roomName && b.roomName) {
            const roomCompare = a.roomName.localeCompare(b.roomName, undefined, { numeric: true })
            if (roomCompare !== 0) return roomCompare
          }
          return a.teacherObj.name.localeCompare(b.teacherObj.name)
        })
        .map((item) => item.row)

      const columns = [
        {
          name: 'Teacher',
          width: '150px',
          formatter: (cell) => h('span', { class: 'font-semibold text-xs' }, cell.name),
        },
        { name: 'Room', width: '150px', formatter: (cell) => h('span', { class: 'text-xs' }, cell.roomName) },
        ...cache.timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      const result = { data, columns }
      cache.schedules.set(weekStart, { data: result, timestamp: Date.now() })
      updateGrid(result)
    } catch (e) {
      console.error('Error loading Teacher schedule:', e)
    } finally {
      isLoading = false
    }
  }

  function updateGrid({ data, columns }) {
    const container = document.getElementById('teacherGrid')
    if (!container) return

    if (teacherGrid) {
      teacherGrid.updateConfig({ data }).forceRender()
      restoreScrollPosition()
    } else {
      container.innerHTML = ''
      teacherGrid = new Grid({
        columns,
        data,
        className: { table: 'w-full border text-xs !border-collapse' },
        style: { table: { 'border-collapse': 'collapse' } },
      }).render(container)
    }
  }

  onMount(() => {
    loadTeacherSchedule()
    const collections = ['MtmSchedule', 'GrpSchedule', 'teacher', 'room', 'grouproom']
    collections.forEach((c) => pb.collection(c).subscribe('*', () => loadTeacherSchedule(true)))
  })

  onDestroy(() => {
    abortController?.abort()
    teacherGrid?.destroy()
    const collections = ['MtmSchedule', 'GrpSchedule', 'teacher', 'room', 'grouproom']
    collections.forEach((c) => pb.collection(c).unsubscribe())
  })
</script>

<svelte:head>{@html `<style>${stickyStyles}</style>`}</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold flex-1 text-center">Teacher Schedule View</h2>
    {#if isLoading}<div class="loading loading-spinner"></div>{/if}
  </div>

  <div class="grid grid-cols-3 items-center mb-4">
    <div class="flex justify-start">
      <input
        type="date"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={() => loadTeacherSchedule(true)}
      />
    </div>

    <div class="flex justify-center">
      <h3 class="text-xl font-bold whitespace-nowrap">
        {getWeekRangeDisplay(weekStart)}
      </h3>
    </div>

    <div class="flex justify-end join">
      <button
        class="btn btn-sm join-item"
        onclick={() => {
          const d = new Date(weekStart)
          d.setDate(d.getDate() - 7)
          weekStart = getWeekStart(d)
          loadTeacherSchedule(true)
        }}>&larr;</button
      >
      <button
        class="btn btn-sm join-item"
        onclick={() => {
          const d = new Date(weekStart)
          d.setDate(d.getDate() + 7)
          weekStart = getWeekStart(d)
          loadTeacherSchedule(true)
        }}>&rarr;</button
      >
    </div>
  </div>

  <div id="teacherGrid"></div>
</div>
