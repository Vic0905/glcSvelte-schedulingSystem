<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #studentGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #studentGrid th { 
      position: sticky; 
      top: 0; 
      z-index: 20; 
      box-shadow: 0 1px 0 #ddd; 
      background-color: #484b4f; 
      color: #ffffff; 
    }
    #studentGrid th:nth-child(1), #studentGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(1) { z-index: 25; }
    #studentGrid th:nth-child(2), #studentGrid td:nth-child(2) { position: sticky; left: 180px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(2) { z-index: 25; }
    #studentGrid th:nth-child(3), #studentGrid td:nth-child(3) { position: sticky; left: 330px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(3) { z-index: 25; }
    #studentGrid th:nth-child(4), #studentGrid td:nth-child(4) { position: sticky; left: 450px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(4) { z-index: 25; }
  `

  const cache = {
    timeslots: null,
    students: null,
    teachers: null,
    schedules: new Map(),
    cacheDuration: 30000,
    isValid: (key) => {
      const cached = cache.schedules.get(key)
      return cached && Date.now() - cached.timestamp < cache.cacheDuration
    },
  }

  let weekStart = $state(getWeekStart(new Date()))
  let studentGrid = null
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
    const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
    if (wrapper) scrollPositions = { top: wrapper.scrollTop, left: wrapper.scrollLeft }
  }

  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
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
      { class: 'text-xs' },
      cell.map((item) =>
        h(
          'div',
          { class: 'flex flex-col gap-1 items-center font-semibold' },
          [
            h('span', { class: 'badge badge-ghost badge-xs p-3 text-bold' }, item.subject?.name || ''),
            item.teacher && h('span', { class: 'badge badge-ghost badge-xs' }, item.teacher.name || ''),
            item.isGroup && h('span', { class: 'badge badge-ghost badge-xs' }, 'Group'),
            h('span', { class: 'badge badge-ghost badge-xs' }, item.room?.name || ''),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadStudentSchedule(forceRefresh = false) {
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
      // CRITICAL: Updated filter to use 'start' if 'date' doesn't exist in your schema
      // If you added a 'date' field to PB, change 'start ~' back to 'date ='
      const filterStr = `start ~ "${weekStart}"`

      const promises = [
        !cache.timeslots ? pb.collection('timeSlot').getFullList({ sort: 'start' }) : Promise.resolve(cache.timeslots),
        !cache.students ? pb.collection('student').getFullList({ sort: 'name' }) : Promise.resolve(cache.students),
        !cache.teachers ? pb.collection('teacher').getFullList({ sort: 'name' }) : Promise.resolve(cache.teachers),
        pb
          .collection('MtmSchedule')
          .getFullList({ filter: filterStr, expand: 'teacher,student,subject,room,timeslot' }),
        pb
          .collection('GrpSchedule')
          .getFullList({ filter: filterStr, expand: 'teacher,student,subject,grouproom,timeslot' }),
      ]

      const [ts, std, tch, mtm, grp] = await Promise.all(promises)

      cache.timeslots = ts
      cache.students = std
      cache.teachers = tch

      const scheduleMap = new Map()

      // Process Individual (MtmSchedule)
      mtm.forEach((s) => {
        const sid = s.expand?.student?.id
        const tid = s.expand?.timeslot?.id
        if (!sid || !tid) return
        if (!scheduleMap.has(sid)) scheduleMap.set(sid, new Map())
        scheduleMap.get(sid).set(tid, {
          subject: s.expand?.subject,
          teacher: s.expand?.teacher,
          room: s.expand?.room,
          isGroup: false,
        })
      })

      // Process Group (GrpSchedule)
      grp.forEach((s) => {
        const tid = s.expand?.timeslot?.id
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        if (!tid) return
        students.forEach((student) => {
          if (!scheduleMap.has(student.id)) scheduleMap.set(student.id, new Map())
          if (!scheduleMap.get(student.id).has(tid)) {
            scheduleMap.get(student.id).set(tid, {
              subject: s.expand?.subject,
              teacher: s.expand?.teacher,
              room: s.expand?.grouproom, // Using 'grouproom' per schema
              isGroup: true,
            })
          }
        })
      })

      const data = cache.students
        .filter((s) => s.status !== 'graduated' || scheduleMap.has(s.id))
        .map((s) => {
          const sMap = scheduleMap.get(s.id) || new Map()
          return [
            { value: s.name, status: s.status, created: s.created },
            { value: s.englishName || '' },
            { value: s.course || '' },
            { value: s.level || '' },
            ...cache.timeslots.map((t) => {
              const match = sMap.get(t.id)
              return match ? [match] : []
            }),
          ]
        })

      const columns = [
        {
          name: 'Student',
          width: '180px',
          formatter: (cell) =>
            h(
              'div',
              { class: 'text-xs flex flex-col items-center' },
              [
                h('span', { class: 'font-semibold' }, cell.value),
                cell.status === 'new' && h('span', { class: 'badge badge-success badge-xs' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'English Name',
          width: '150px',
          // Add formatter to extract the value property
          formatter: (cell) => h('span', { class: 'text-xs' }, cell.value),
        },
        {
          name: 'Course',
          width: '120px',
          formatter: (cell) => h('span', { class: 'text-xs' }, cell.value),
        },
        {
          name: 'Level',
          width: '100px',
          formatter: (cell) => h('span', { class: 'text-xs' }, cell.value),
        },
        ...cache.timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      const result = { data, columns }
      cache.schedules.set(weekStart, { data: result, timestamp: Date.now() })
      updateGrid(result)
    } catch (e) {
      console.error('Error loading schedule:', e)
    } finally {
      isLoading = false
    }
  }

  function updateGrid({ data, columns }) {
    if (studentGrid) {
      studentGrid.updateConfig({ data }).forceRender()
      restoreScrollPosition()
    } else {
      studentGrid = new Grid({
        columns,
        data,
        className: { table: 'w-full border text-xs !border-collapse' },
        style: { table: { 'border-collapse': 'collapse', 'table-layout': 'fixed' } },
      }).render(document.getElementById('studentGrid'))
    }
  }

  onMount(() => {
    loadStudentSchedule()
    const collections = ['MtmSchedule', 'GrpSchedule', 'teacher', 'student']
    collections.forEach((c) => pb.collection(c).subscribe('*', () => loadStudentSchedule(true)))
  })

  onDestroy(() => {
    abortController?.abort()
    studentGrid?.destroy()
    pb.collection('MtmSchedule').unsubscribe()
    pb.collection('GrpSchedule').unsubscribe()
  })
</script>

<svelte:head>{@html `<style>${stickyStyles}</style>`}</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold flex-1 text-center">Student Schedule View</h2>
    {#if isLoading}<div class="loading loading-spinner"></div>{/if}
  </div>

  <div class="grid grid-cols-3 items-center mb-4">
    <div class="flex justify-start">
      <input
        type="date"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={() => loadStudentSchedule(true)}
      />
    </div>

    <div class="flex justify-center">
      <h3 class="text-xl font-bold whitespace-nowrap">
        {getWeekRangeDisplay(weekStart)}
      </h3>
    </div>

    <div class="flex justify-end">
      <div class="join">
        <button
          class="btn btn-sm join-item"
          onclick={() => {
            const d = new Date(weekStart)
            d.setDate(d.getDate() - 7)
            weekStart = getWeekStart(d)
            loadStudentSchedule(true)
          }}>&larr;</button
        >
        <button
          class="btn btn-sm join-item"
          onclick={() => {
            const d = new Date(weekStart)
            d.setDate(d.getDate() + 7)
            weekStart = getWeekStart(d)
            loadStudentSchedule(true)
          }}>&rarr;</button
        >
      </div>
    </div>
  </div>

  <div id="studentGrid"></div>
</div>
