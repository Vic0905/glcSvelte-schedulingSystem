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
  let rooms = []
  let grouprooms = []
  let isLoading = $state(false)
  let filteredStudents = new Map() // Store filtered students

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
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 items-center' }, [
          h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name ?? 'No Subject'),
          item.isGroup
            ? h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class')
            : h(
                'span',
                {
                  class: 'badge badge-neutral badge-xs',
                  title: filteredStudents.get(item.student?.id) ? '' : 'Graduated student with no bookings',
                },
                filteredStudents.get(item.student?.id) || 'Unknown Student'
              ),
          h('span', { class: 'badge badge-error badge-xs' }, item.room?.name ?? 'No Room'),
        ])
      )
    )
  }

  async function loadAndFilterStudents() {
    try {
      // Load all students with their status
      const allStudents = await pb.collection('student').getFullList({
        fields: 'id,englishName,status',
      })

      // Get student bookings count from lessonSchedule collection
      const studentBookings = await pb.collection('lessonSchedule').getFullList({
        fields: 'student',
      })

      // Count bookings per student
      const studentBookingCount = new Map()
      studentBookings.forEach((booking) => {
        const studentId = booking.student
        studentBookingCount.set(studentId, (studentBookingCount.get(studentId) || 0) + 1)
      })

      // Create filtered student map
      filteredStudents.clear()
      allStudents.forEach((student) => {
        if (student.status !== 'graduated') {
          // Show all non-graduated students
          filteredStudents.set(student.id, student.englishName)
        } else if (studentBookingCount.has(student.id)) {
          // Show graduated students only if they have bookings
          filteredStudents.set(student.id, student.englishName)
        }
        // Graduated students without bookings are filtered out
      })
    } catch (error) {
      console.error('Error loading and filtering students:', error)
    }
  }

  async function loadRoomsAndGrouprooms() {
    try {
      // Load both rooms and grouprooms
      const [roomRecords, grouproomRecords] = await Promise.all([
        pb.collection('room').getFullList({
          expand: 'teacher',
        }),
        pb.collection('grouproom').getFullList({
          expand: 'teacher',
        }),
      ])

      rooms = roomRecords
      grouprooms = grouproomRecords

      // Create a map of teacher IDs to their assigned rooms/grouprooms
      const teacherAssignmentMap = {}

      // Process regular rooms
      roomRecords.forEach((room) => {
        if (room.teacher && room.expand?.teacher) {
          teacherAssignmentMap[room.teacher] = {
            type: 'room',
            name: room.name || 'Unnamed Room',
            id: room.id,
            teacherName: room.expand.teacher.name,
            sortKey: `room_${room.name || ''}`,
          }
        }
      })

      // Process grouprooms
      grouproomRecords.forEach((grouproom) => {
        if (grouproom.teacher && grouproom.expand?.teacher) {
          // If teacher already has a room, keep room assignment (room takes precedence)
          if (!teacherAssignmentMap[grouproom.teacher]) {
            teacherAssignmentMap[grouproom.teacher] = {
              type: 'grouproom',
              name: grouproom.name || 'Unnamed Grouproom',
              id: grouproom.id,
              teacherName: grouproom.expand.teacher.name,
              maxStudents: grouproom.maxstudents,
              sortKey: `grouproom_${grouproom.name || ''}`,
            }
          }
        }
      })

      return teacherAssignmentMap
    } catch (error) {
      console.error('Error loading rooms and grouprooms:', error)
      return {}
    }
  }

  async function loadTeacherSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Load and filter students first
      await loadAndFilterStudents()

      // Load rooms, grouprooms and teachers first for sorting
      const teacherAssignmentMap = await loadRoomsAndGrouprooms()

      const [timeslotsData, individualSchedules, groupSchedules, allTeachers] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('lessonSchedule').getList(1, 200, {
          filter: dateFilter,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupLessonSchedule').getList(1, 200, {
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
        pb.collection('teacher').getFullList({ sort: 'name' }),
      ])

      timeslots = timeslotsData

      // Count teacher bookings to filter disabled teachers
      const teachersWithBookings = new Set()

      // Count individual schedule bookings
      for (const s of individualSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        if (teacherId) teachersWithBookings.add(teacherId)
      }

      // Count group schedule bookings
      for (const s of groupSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        if (teacherId) teachersWithBookings.add(teacherId)
      }

      // Filter teachers: show non-disabled OR disabled with bookings
      let filteredTeachers = allTeachers.filter((teacher) => {
        if (teacher.status !== 'disabled') return true
        return teachersWithBookings.has(teacher.id)
      })

      // Categorize teachers based on assignments
      const teachersWithRooms = []
      const teachersWithGrouproomsOnly = []
      const teachersWithoutAssignments = []

      filteredTeachers.forEach((teacher) => {
        const assignment = teacherAssignmentMap[teacher.id]

        if (assignment) {
          if (assignment.type === 'room') {
            teachersWithRooms.push({ teacher, assignment })
          } else if (assignment.type === 'grouproom') {
            teachersWithGrouproomsOnly.push({ teacher, assignment })
          }
        } else {
          teachersWithoutAssignments.push({ teacher, assignment: null })
        }
      })

      // Sort teachers with rooms by room name
      teachersWithRooms.sort((a, b) => {
        return a.assignment.name.localeCompare(b.assignment.name)
      })

      // Sort teachers with only grouprooms by grouproom name
      teachersWithGrouproomsOnly.sort((a, b) => {
        return a.assignment.name.localeCompare(b.assignment.name)
      })

      // Sort teachers without assignments by name
      teachersWithoutAssignments.sort((a, b) => {
        return a.teacher.name.localeCompare(b.teacher.name)
      })

      // Combine lists in order: room-assigned > grouproom-only > unassigned
      teachers = [
        ...teachersWithRooms.map((item) => item.teacher),
        ...teachersWithGrouproomsOnly.map((item) => item.teacher),
        ...teachersWithoutAssignments.map((item) => item.teacher),
      ]

      // Build schedule map
      const scheduleMap = {}

      // Process individual lessons - filter out graduated students without bookings
      for (const s of individualSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        const studentId = s.expand?.student?.id

        // Only include if student is in filteredStudents (non-graduated or graduated with bookings)
        if (!teacherId || !timeslotId || !studentId || !filteredStudents.has(studentId)) continue

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

      // Build table data with sorted teachers - ONLY SHOW TEACHER NAME
      const data = teachers.map((teacher) => {
        const teacherSchedule = scheduleMap[teacher.id] || {}
        const assignment = teacherAssignmentMap[teacher.id]

        // For sorting only - not displayed
        const sortValue = assignment ? assignment.sortKey : ''

        return [
          {
            value: teacher.name, // Only show teacher name
            sortValue: sortValue,
            rawName: teacher.name,
            assignmentType: assignment?.type,
            assignmentName: assignment?.name,
          },
          ...timeslots.map((ts) => {
            const schedules = teacherSchedule[ts.id]
            return schedules ? Object.values(schedules) : []
          }),
        ]
      })

      const columns = [
        {
          name: 'Teacher',
          width: '150px',
          formatter: (cell) => {
            // Only show teacher name - no room info
            return h('span', {}, cell.rawName || cell.value)
          },
          sort: {
            compare: (a, b) => {
              // First sort by assignment type (room > grouproom > none)
              if (a.assignmentType === 'room' && b.assignmentType !== 'room') return -1
              if (a.assignmentType !== 'room' && b.assignmentType === 'room') return 1

              // Both have same assignment type or no assignment
              if (a.assignmentType === b.assignmentType) {
                // Sort by assignment name
                if (a.assignmentName && b.assignmentName) {
                  const nameCompare = a.assignmentName.localeCompare(b.assignmentName)
                  if (nameCompare !== 0) return nameCompare
                }
                // Then by teacher name
                return a.rawName.localeCompare(b.rawName)
              }

              // If one has grouproom and other has none
              if (a.assignmentType === 'grouproom' && !b.assignmentType) return -1
              if (!a.assignmentType && b.assignmentType === 'grouproom') return 1

              return 0
            },
          },
        },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
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
          search: false,
          sort: true,
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
    pb.collection('room').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', debouncedReload)
    pb.collection('teacher').subscribe('*', debouncedReload)
    pb.collection('student').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    teacherGrid?.destroy()
    pb.collection('lessonSchedule').unsubscribe()
    pb.collection('groupLessonSchedule').unsubscribe()
    pb.collection('room').unsubscribe()
    pb.collection('grouproom').unsubscribe()
    pb.collection('teacher').unsubscribe()
    pb.collection('student').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Teacher View Table</h2>
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

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-4 text-xs mb-2">
      <div class="flex items-center gap-1">
        <span class="badge badge-primary badge-xs"></span>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="badge badge-neutral badge-xs"></span>
        <span>Student (graduated without bookings are hidden)</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="badge badge-secondary badge-xs"></span>
        <span>Group Lesson</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="badge badge-error badge-xs"></span>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="teacherGrid" class="border rounded-lg"></div>
</div>
