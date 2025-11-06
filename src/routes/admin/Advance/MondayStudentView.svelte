<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #mondayStudentGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #mondayStudentGrid th { position: sticky; top: 0; z-index: 20; box-shadow: 0 1px 0 #ddd; }
    #mondayStudentGrid th:nth-child(1), #mondayStudentGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd;  }
    #mondayStudentGrid th:nth-child(1) { z-index: 25; }
    #mondayStudentGrid th:nth-child(2), #mondayStudentGrid td:nth-child(2) { position: sticky; left: 150px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #mondayStudentGrid th:nth-child(2) { z-index: 25; }
    #mondayStudentGrid th:nth-child(3), #mondayStudentGrid td:nth-child(3) { position: sticky; left: 300px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #mondayStudentGrid th:nth-child(3) { z-index: 25; }
    #mondayStudentGrid th:nth-child(4), #mondayStudentGrid td:nth-child(4) { position: sticky; left: 450px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #mondayStudentGrid th:nth-child(4) { z-index: 25; }
  `

  let selectedDate = $state(getMonday(new Date()))
  let mondayStudentGrid = null
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
    loadMondayStudentSchedule()
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
            h('span', { class: 'badge badge-info badge-xs' }, item.teacher?.name || ''),
            item.isGroup && h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'),
            h('span', { class: 'badge badge-error badge-xs' }, item.room?.name || ''),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadMondayStudentSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, allStudents, mondayIndividualSchedules, mondayGroupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('mondayAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('mondayAdvanceGroupBooking').getList(1, 500, {
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

      if (mondayStudentGrid) {
        const wrapper = document.querySelector('#mondayStudentGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        mondayStudentGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#mondayStudentGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        mondayStudentGrid = new Grid({
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
        }).render(document.getElementById('mondayStudentGrid'))
      }
    } catch (error) {
      console.error('Error loading Monday student schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadMondayStudentSchedule, 150)
  }

  onMount(() => {
    loadMondayStudentSchedule()
    // Subscribe to Monday advance booking collections
    pb.collection('mondayAdvanceBooking').subscribe('*', debouncedReload)
    pb.collection('mondayAdvanceGroupBooking').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    mondayStudentGrid?.destroy()
    mondayStudentGrid = null
    // Unsubscribe from Monday advance booking collections
    pb.collection('mondayAdvanceBooking').unsubscribe()
    pb.collection('mondayAdvanceGroupBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday Student Schedule (Advance Template)</h2>
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
        onchange={loadMondayStudentSchedule}
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

  <div id="mondayStudentGrid" class="border rounded-lg"></div>
</div>
