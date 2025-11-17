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
    #studentGrid th:nth-child(3), #studentGrid td:nth-child(3) { position: sticky; left: 300px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(3) { z-index: 25; }
    #studentGrid th:nth-child(4), #studentGrid td:nth-child(4) { position: sticky; left: 450px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(4) { z-index: 25; }
  `

  let selectedDate = $state(getMonday(new Date()))
  let studentGrid = null
  let timeslots = []
  let isLoading = $state(false)

  function getMonday(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is Sunday
    d.setDate(diff)
    return d.toISOString().split('T')[0]
  }

  function getDateDisplay(date) {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const changeWeek = (weeks) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + weeks * 7)
    selectedDate = getMonday(d)
    loadStudentSchedule()
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')

    // Check if all items have hiddenDetails
    const allHidden = cell.every((item) => item.hiddenDetails)
    if (allHidden) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) => {
        // Show "Scheduled" for individual hidden items
        if (item.hiddenDetails) {
          return h('div', { class: 'badge badge-success badge-sm mb-1' }, 'Scheduled')
        }

        return h(
          'div',
          { class: 'flex flex-col gap-1 items-center' },
          [
            h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name || ''),
            h('span', { class: 'badge badge-info badge-xs' }, item.teacher?.name || ''),
            item.isGroup && h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'),
            h('span', { class: 'badge badge-error badge-xs' }, item.room?.name || ''),
          ].filter(Boolean)
        )
      })
    )
  }

  async function loadStudentSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, allStudents, mondayIndividualSchedules, mondayGroupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('mondayLessonSchedule').getList(1, 200, {
          filter: `date = "${selectedDate}"`,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('mondayGroupLessonSchedule').getList(1, 200, {
          filter: `date = "${selectedDate}"`,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      // Track which students have lessons on this Monday
      const studentsWithLessons = new Set()

      timeslots = timeslotsData

      // Process Monday individual schedules to track students with lessons
      for (const s of mondayIndividualSchedules.items) {
        const studentId = s.expand?.student?.id
        if (studentId) studentsWithLessons.add(studentId)
      }

      // Process Monday group schedules to track students with lessons
      for (const s of mondayGroupSchedules.items) {
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        students.forEach((student) => studentsWithLessons.add(student.id))
      }

      // Filter students: include non-graduated OR graduated students WITH lessons this Monday
      const students = allStudents.filter((s) => {
        if (s.status !== 'graduated') return true
        return studentsWithLessons.has(s.id)
      })

      // Build schedule map
      const scheduleMap = {}
      students.forEach((s) => {
        scheduleMap[s.id] = {
          student: s.name,
          englishName: s.englishName || '',
          course: s.course || '',
          level: s.level || '',
          slots: {},
        }
      })

      // Process Monday individual schedules
      for (const s of mondayIndividualSchedules.items) {
        const studentId = s.expand?.student?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!studentId || !timeslotId || !scheduleMap[studentId]) continue

        scheduleMap[studentId].slots[timeslotId] ??= {
          subject: s.expand?.subject,
          teacher: s.expand?.teacher,
          room: s.expand?.room,
          isGroup: false,
          hiddenDetails: s.hiddenDetails || false,
        }
      }

      // Process Monday group schedules
      for (const s of mondayGroupSchedules.items) {
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        const timeslotId = s.expand?.timeslot?.id
        if (!timeslotId) continue

        students.forEach((student) => {
          if (!scheduleMap[student.id]) return
          scheduleMap[student.id].slots[timeslotId] ??= {
            subject: s.expand?.subject,
            teacher: s.expand?.teacher,
            room: s.expand?.grouproom,
            isGroup: true,
            hiddenDetails: s.hiddenDetails || false,
          }
        })
      }

      // Build table data
      const data = Object.values(scheduleMap)
        .sort((a, b) => a.student.localeCompare(b.student, undefined, { numeric: true }))
        .map((entry) => [
          { label: 'Student', value: entry.student },
          { label: 'English Name', value: entry.englishName },
          { label: 'Course', value: entry.course },
          { label: 'Level', value: entry.level },
          ...timeslots.map((ts) => {
            const schedule = entry.slots[ts.id]
            return schedule ? [schedule] : []
          }),
        ])

      const columns = [
        { name: 'Student', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'English Name', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Course', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'Level', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (studentGrid) {
        const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        studentGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#studentGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
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
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('studentGrid'))
      }
    } catch (error) {
      console.error('Error loading schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadStudentSchedule, 150)
  }

  onMount(() => {
    loadStudentSchedule()
    // Subscribe to Monday collections instead of regular collections
    pb.collection('mondayLessonSchedule').subscribe('*', debouncedReload)
    pb.collection('mondayGroupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    studentGrid?.destroy()
    // Unsubscribe from Monday collections
    pb.collection('mondayLessonSchedule').unsubscribe()
    pb.collection('mondayGroupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday Student Schedule</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Monday Date:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={selectedDate}
        class="input input-bordered input-sm w-40"
        onchange={loadStudentSchedule}
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">{getDateDisplay(selectedDate)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span> Subject</div>
      <div class="flex gap-1"><span class="badge badge-info badge-xs"></span> Teacher</div>
      <div class="flex gap-1"><span class="badge badge-secondary badge-xs"></span> Group Class</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span> Room</div>
    </div>
  </div>

  <div id="studentGrid" class="border rounded-lg"></div>
</div>
