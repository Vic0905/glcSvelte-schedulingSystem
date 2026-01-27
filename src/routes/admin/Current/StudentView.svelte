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
  `

  // Cache for frequently accessed data
  const cache = {
    timeslots: null,
    students: null,
    teachers: null,
    schedules: new Map(), // Map weekStart -> { data, timestamp }
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
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

  function getDateFilter(weekDays) {
    return weekDays.map((d) => `date = "${d}"`).join(' || ')
  }

  // Save scroll position before any updates
  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
    if (wrapper) {
      scrollPositions = {
        top: wrapper.scrollTop,
        left: wrapper.scrollLeft,
      }
    }
  }

  // Restore scroll position after updates
  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadStudentSchedule(true) // Force load when changing week
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
            item.teacher &&
              h(
                'span',
                {
                  class: 'badge badge-neutral badge-xs',
                  title: item.teacher.status === 'disabled' ? 'Disabled teacher' : '',
                },
                item.teacher.name || ''
              ),
            item.isGroup && h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'),
            h('span', { class: 'badge badge-error badge-xs' }, item.room?.name || ''),
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

    // Save scroll position before loading
    saveScrollPosition()

    // Check cache first
    if (!forceRefresh && cache.isValid(weekStart)) {
      const cached = cache.schedules.get(weekStart)
      updateGrid(cached.data)
      return
    }

    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = getDateFilter(weekDays)

      // Load data in parallel
      const promises = []

      // Load timeslots only once
      if (!cache.timeslots) {
        promises.push(pb.collection('timeSlot').getFullList({ sort: 'start' }))
      }

      // Load students only once (cached)
      if (!cache.students) {
        promises.push(
          pb.collection('student').getFullList({
            sort: 'name',
            fields: 'id,name,englishName,status',
          })
        )
      }

      // Load teachers only once (cached)
      if (!cache.teachers) {
        promises.push(
          pb.collection('teacher').getFullList({
            sort: 'name',
            fields: 'id,name,status',
          })
        )
      }

      // Always load schedules
      promises.push(
        pb.collection('lessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
          $autoCancel: false,
        })
      )

      promises.push(
        pb.collection('groupLessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
          $autoCancel: false,
        })
      )

      const results = await Promise.all(promises)
      if (signal.aborted) return

      // Parse results efficiently
      let idx = 0

      if (!cache.timeslots) {
        cache.timeslots = results[idx++]
      }

      if (!cache.students) {
        cache.students = results[idx++]
      }

      if (!cache.teachers) {
        cache.teachers = results[idx++]
      }

      const individualSchedules = results[idx++]
      const groupSchedules = results[idx++]

      // Create maps for quick lookups
      const teacherMap = new Map()
      cache.teachers.forEach((teacher) => {
        teacherMap.set(teacher.id, teacher)
      })

      // Build schedule map using Map for O(1) lookups
      const scheduleMap = new Map()

      // Track teachers with lessons for filtering disabled teachers
      const teachersWithLessons = new Set()

      // Process individual schedules
      for (const s of individualSchedules) {
        const studentId = s.expand?.student?.id
        const timeslotId = s.expand?.timeslot?.id
        const teacherId = s.expand?.teacher?.id
        if (!studentId || !timeslotId) continue

        if (teacherId) {
          teachersWithLessons.add(teacherId)
        }

        if (!scheduleMap.has(studentId)) {
          scheduleMap.set(studentId, new Map())
        }

        const teacher = teacherMap.get(teacherId)
        scheduleMap.get(studentId).set(timeslotId, {
          subject: s.expand?.subject,
          teacher: teacher
            ? {
                ...s.expand?.teacher,
                status: teacher.status,
              }
            : null,
          room: s.expand?.room,
          isGroup: false,
        })
      }

      // Process group schedules
      for (const s of groupSchedules) {
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        const timeslotId = s.expand?.timeslot?.id
        const teacherId = s.expand?.teacher?.id

        if (teacherId) {
          teachersWithLessons.add(teacherId)
        }

        if (!timeslotId) continue

        for (const student of students) {
          if (!scheduleMap.has(student.id)) {
            scheduleMap.set(student.id, new Map())
          }

          // Only set if not already exists (individual takes precedence)
          if (!scheduleMap.get(student.id).has(timeslotId)) {
            const teacher = teacherMap.get(teacherId)
            scheduleMap.get(student.id).set(timeslotId, {
              subject: s.expand?.subject,
              teacher: teacher
                ? {
                    ...s.expand?.teacher,
                    status: teacher.status,
                  }
                : null,
              room: s.expand?.grouproom,
              isGroup: true,
            })
          }
        }
      }

      // Filter teachers: show non-disabled OR disabled with lessons
      const filteredTeachers = new Map()
      cache.teachers.forEach((teacher) => {
        if (teacher.status !== 'disabled') {
          filteredTeachers.set(teacher.id, teacher)
        } else if (teachersWithLessons.has(teacher.id)) {
          // Show disabled teachers only if they have lessons
          filteredTeachers.set(teacher.id, teacher)
        }
      })

      // Filter students: include non-graduated OR graduated students WITH lessons
      const filteredStudents = []
      const studentsWithLessons = new Set(scheduleMap.keys())

      cache.students.forEach((student) => {
        if (student.status !== 'graduated') {
          filteredStudents.push(student)
        } else if (studentsWithLessons.has(student.id)) {
          // Show graduated students only if they have lessons
          filteredStudents.push(student)
        }
      })

      // Filter schedule data to exclude disabled teachers without lessons
      const filteredScheduleMap = new Map()
      scheduleMap.forEach((timeslotMap, studentId) => {
        const filteredTimeslotMap = new Map()

        timeslotMap.forEach((schedule, timeslotId) => {
          // Only include schedule if teacher is not disabled OR is disabled but has lessons
          if (!schedule.teacher || filteredTeachers.has(schedule.teacher.id)) {
            filteredTimeslotMap.set(timeslotId, schedule)
          }
        })

        if (filteredTimeslotMap.size > 0) {
          filteredScheduleMap.set(studentId, filteredTimeslotMap)
        }
      })

      // Build table data efficiently
      const data = filteredStudents.map((student) => {
        const studentSchedules = filteredScheduleMap.get(student.id) || new Map()

        const row = [
          { label: 'Student', value: student.name },
          { label: 'English Name', value: student.englishName || '' },
          ...cache.timeslots.map((ts) => {
            const schedule = studentSchedules.get(ts.id)
            return schedule ? [schedule] : []
          }),
        ]

        return row
      })

      // Sort by student name
      data.sort((a, b) => a[0].value.localeCompare(b[0].value))

      const columns = [
        {
          name: 'Student',
          width: '150px',
          formatter: (cell) => h('div', { class: 'text-xs truncate' }, cell.value),
        },
        {
          name: 'English Name',
          width: '150px',
          formatter: (cell) => h('div', { class: 'text-xs' }, cell.value),
        },
        ...cache.timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      const result = { data, columns }

      // Cache the result
      cache.schedules.set(weekStart, {
        data: result,
        timestamp: Date.now(),
      })

      if (signal.aborted) return

      // Update grid
      updateGrid(result)
    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) {
        console.log('Request cancelled')
        return
      }
      console.error('Error loading student schedule:', error)
    } finally {
      isLoading = false
      abortController = null
    }
  }

  function updateGrid({ data, columns }) {
    if (studentGrid) {
      studentGrid
        .updateConfig({
          data,
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed',
            },
          },
        })
        .forceRender()

      // Restore scroll position after DOM update
      restoreScrollPosition()
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
        style: {
          table: {
            'border-collapse': 'collapse',
            'table-layout': 'fixed',
          },
        },
      }).render(document.getElementById('studentGrid'))
    }
  }

  // Debounced reload
  let reloadTimeout
  const debouncedReload = () => {
    if (isLoading) return
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
      // Invalidate cache for current week
      cache.schedules.delete(weekStart)
      loadStudentSchedule(true)
    }, 150)
  }

  onMount(() => {
    loadStudentSchedule()
    pb.collection('lessonSchedule').subscribe('*', debouncedReload)
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
    pb.collection('teacher').subscribe('*', debouncedReload)
    pb.collection('student').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    abortController?.abort()
    studentGrid?.destroy()
    pb.collection('lessonSchedule').unsubscribe()
    pb.collection('groupLessonSchedule').unsubscribe()
    pb.collection('teacher').unsubscribe()
    pb.collection('student').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
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
        onchange={() => loadStudentSchedule(true)}
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-center mr-50">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-4 text-xs mb-2">
      <div class="flex items-center gap-1">
        <span class="badge badge-primary badge-xs"></span>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="badge badge-neutral badge-xs"></span>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="badge badge-secondary badge-xs"></span>
        <span>Group Class</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="badge badge-error badge-xs"></span>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="studentGrid" class="border rounded-lg"></div>
</div>
