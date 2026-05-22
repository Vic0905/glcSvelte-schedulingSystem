<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  // Centralized, isolated cache object
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
    clearDependencies: () => {
      cache.schedules.clear()
      cache.teachers = null
      cache.students = null
    },
  }

  // Reactive States using Svelte 5 Runes
  let weekStart = $state(getWeekStart(new Date()))
  let isLoading = $state(false)
  let scrollPositions = $state({ top: 0, left: 0 })

  let studentGrid = null
  let abortController = null
  let reloadTimeout = null

  // Track specific unsubscribe closures to prevent tearing down global listeners
  let unsubSchedules = null
  let unsubTeachers = null
  let unsubStudents = null

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
    const wrapper = document.querySelector('#studentGridNew .gridjs-wrapper')
    if (wrapper) scrollPositions = { top: wrapper.scrollTop, left: wrapper.scrollLeft }
  }

  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#studentGridNew .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  const changeWeek = (weeks) => {
    if (isLoading) return
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadStudentSchedule(true)
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', { class: 'text-neutral-400' }, '—')
    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) =>
        h(
          'div',
          { class: 'flex flex-col gap-1 p-1 items-center text-center' },
          [
            h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-200 mb-1 pb-1 w-full' }, [
              h('div', {}, item.subject?.name || ''),
              h(
                'div',
                { class: 'text-[10px] uppercase mt-1 tracking-wider text-neutral-700' },
                item.teacher?.name || ''
              ),
            ]),
            item.room && h('span', { class: 'badge badge-ghost badge-xs scale-90' }, item.room.name),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadStudentSchedule(forceRefresh = false) {
    if (isLoading) return

    abortController?.abort()
    abortController = new AbortController()
    const { signal } = abortController

    saveScrollPosition()

    if (!forceRefresh && cache.isValid(weekStart)) {
      updateGrid(cache.schedules.get(weekStart).data)
      return
    }

    isLoading = true

    try {
      const endD = new Date(weekStart)
      endD.setDate(endD.getDate() + 3)
      const endDateStr = `${endD.toISOString().split('T')[0]} 23:59:59`
      const startDateStr = `${weekStart} 00:00:00`
      const dateFilter = `start <= "${endDateStr}" && end >= "${startDateStr}"`

      const promises = []

      if (!cache.timeslots) {
        promises.push(pb.collection('timeslot').getFullList({ sort: 'start', requestKey: 'timeslots' }))
      }
      if (!cache.students) {
        // Optimization: Server-side exclusion of graduated students
        promises.push(
          pb.collection('student').getFullList({
            filter: 'status != "graduated"',
            fields: 'id,name,englishName,course,level,status,created',
            requestKey: 'students',
          })
        )
      }
      if (!cache.teachers) {
        // Optimization: Server-side filter to omit dead records immediately
        promises.push(
          pb.collection('teacher').getFullList({
            sort: 'name',
            filter: 'status != "disabled"',
            fields: 'id,name,status',
            requestKey: 'teachers',
          })
        )
      }

      promises.push(
        pb.collection('schedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
          $autoCancel: false,
          requestKey: `schedules_${weekStart}`,
        })
      )

      const results = await Promise.all(promises)
      if (signal.aborted) return

      let idx = 0
      if (!cache.timeslots) cache.timeslots = results[idx++]
      if (!cache.students) cache.students = results[idx++]
      if (!cache.teachers) cache.teachers = results[idx++]

      const allSchedules = results[idx++]

      // Create indexed Maps for fast O(1) correlation matching
      const teacherMap = new Map(cache.teachers.map((t) => [t.id, t]))
      const scheduleMap = new Map()

      for (const s of allSchedules) {
        const timeslotId = s.expand?.timeslot?.id
        const teacherId = s.expand?.teacher?.id
        if (!timeslotId) continue

        const teacher = teacherMap.get(teacherId)
        // If teacher is disabled and has no live historical slot payload, skip it cleanly
        if (!teacher && teacherId) continue

        const entry = {
          subject: s.expand?.subject,
          teacher: teacher ? { ...s.expand?.teacher, status: teacher.status } : null,
          room: s.expand?.room,
          isGroup: Array.isArray(s.expand?.student),
        }

        const students = Array.isArray(s.expand?.student)
          ? s.expand.student
          : s.expand?.student
            ? [s.expand.student]
            : []

        for (const student of students) {
          if (!scheduleMap.has(student.id)) scheduleMap.set(student.id, new Map())

          const isIndividual = !Array.isArray(s.expand?.student)
          const studentTimeSlots = scheduleMap.get(student.id)

          if (isIndividual || !studentTimeSlots.has(timeslotId)) {
            studentTimeSlots.set(timeslotId, entry)
          }
        }
      }

      const data = cache.students.map((student) => {
        const studentSchedules = scheduleMap.get(student.id) || new Map()
        return [
          { label: 'Student', value: student.name, status: student.status, created: student.created },
          { label: 'English Name', value: student.englishName || '' },
          { label: 'Course', value: student.course || '' },
          { label: 'Level', value: student.level || '' },
          ...cache.timeslots.map((ts) => {
            const sched = studentSchedules.get(ts.id)
            return sched ? [sched] : []
          }),
        ]
      })

      // Sort data layout: Mirror the original behavior exactly
      data.sort((a, b) => {
        const statusA = a[0].status === 'new' ? 1 : 0
        const statusB = b[0].status === 'new' ? 1 : 0

        // 1. Primary Sort: Revert to your original configuration (Old students float up, New students drop down)
        if (statusA !== statusB) return statusA - statusB

        // 2. Tie-breaker: Chronological alignment (Oldest created accounts remain at the absolute top)
        return new Date(a[0].created).getTime() - new Date(b[0].created).getTime()
      })

      const columns = [
        {
          name: 'Student',
          width: '180px',
          formatter: (cell) =>
            h(
              'div',
              { class: 'flex flex-col items-center text-center text-neutral-700 font-bold' },
              [
                h('span', { class: 'font-semibold' }, cell.value),
                cell.status === 'new' && h('span', { class: 'badge badge-soft badge-success badge-xs mt-1' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'English Name',
          width: '140px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        {
          name: 'Course',
          width: '120px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        {
          name: 'Level',
          width: '120px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        ...cache.timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '180px',
          formatter: formatCell,
        })),
      ]

      const result = { data, columns }
      cache.schedules.set(weekStart, { data: result, timestamp: Date.now() })

      if (signal.aborted) return
      updateGrid(result)
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) return
      console.error('Error loading student schedule:', error)
      toast.error('Failed to load student schedule')
    } finally {
      if (!signal.aborted) {
        isLoading = false
        abortController = null
      }
    }
  }

  function updateGrid({ data, columns }) {
    const targetEl = document.getElementById('studentGridNew')
    if (!targetEl) return

    if (studentGrid) {
      studentGrid.updateConfig({ data, columns }).forceRender()
      restoreScrollPosition()
    } else {
      studentGrid = new Grid({
        columns,
        data,
        search: false,
        sort: false,
        pagination: false,
        className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
        style: { table: { 'border-collapse': 'collapse', 'table-layout': 'fixed' } },
      }).render(targetEl)
    }
  }

  function handleToast(e, label = 'Schedule') {
    const messages = { create: `${label} created`, update: `${label} updated`, delete: `${label} deleted` }
    const types = { create: toast.success, update: toast.info, delete: toast.error }
    types[e.action]?.(messages[e.action])
  }

  const debouncedReload = () => {
    if (isLoading) return
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
      cache.clearDependencies()
      loadStudentSchedule(true)
    }, 200)
  }

  onMount(() => {
    loadStudentSchedule()

    // Fixed: Capture subscription functions directly to avoid app-wide unmount leaks
    pb.collection('schedule')
      .subscribe('*', (e) => {
        handleToast(e, 'Schedule')
        cache.schedules.delete(weekStart)
        loadStudentSchedule(true)
      })
      .then((unsub) => (unsubSchedules = unsub))

    pb.collection('teacher')
      .subscribe('*', debouncedReload)
      .then((unsub) => (unsubTeachers = unsub))
    pb.collection('student')
      .subscribe('*', debouncedReload)
      .then((unsub) => (unsubStudents = unsub))
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    abortController?.abort()

    // Safely execute targeted cleanups
    if (typeof unsubSchedules === 'function') unsubSchedules()
    if (typeof unsubTeachers === 'function') unsubTeachers()
    if (typeof unsubStudents === 'function') unsubStudents()

    if (studentGrid) {
      studentGrid.destroy()
      studentGrid = null
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Student View Table (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between relative h-10">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold whitespace-nowrap">
      {getWeekRangeDisplay(weekStart)}
    </h3>
    <div class="ml-auto flex items-center gap-2 z-10">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="studentGridNew" class="border rounded-lg overflow-hidden"></div>
</div>

<style>
  #studentGridNew :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  /* Structural improvement: target the table row background explicitly to guarantee inheriting values smoothly */
  #studentGridNew :global(tr) {
    background-color: #ffffff;
  }

  #studentGridNew :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px -1px 0 #ddd;
    background-color: #484b4f !important;
    color: #ffffff;
  }

  #studentGridNew :global(td) {
    background-color: inherit;
  }

  #studentGridNew :global(th:nth-child(1)),
  #studentGridNew :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #studentGridNew :global(th:nth-child(1)) {
    z-index: 25;
    background-color: #484b4f !important;
  }

  #studentGridNew :global(th:nth-child(2)),
  #studentGridNew :global(td:nth-child(2)) {
    position: sticky;
    left: 180px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #studentGridNew :global(th:nth-child(2)) {
    z-index: 25;
    background-color: #484b4f !important;
  }

  #studentGridNew :global(th:nth-child(3)),
  #studentGridNew :global(td:nth-child(3)) {
    position: sticky;
    left: 320px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #studentGridNew :global(th:nth-child(3)) {
    z-index: 25;
    background-color: #484b4f !important;
  }

  #studentGridNew :global(th:nth-child(4)),
  #studentGridNew :global(td:nth-child(4)) {
    position: sticky;
    left: 440px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #studentGridNew :global(th:nth-child(4)) {
    z-index: 25;
    background-color: #484b4f !important;
  }
</style>
