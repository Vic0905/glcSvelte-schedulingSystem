<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  const stickyStyles = `
    #studentGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #studentGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #studentGrid th:nth-child(1), #studentGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #studentGrid th:nth-child(1) { z-index: 25; }
    #studentGrid th:nth-child(2), #studentGrid td:nth-child(2) { position: sticky; left: 150px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #studentGrid th:nth-child(2) { z-index: 25; }
  `

  let studentGrid = null
  let timeslots = []

  // Keep only this date display function (same as advance template)
  function getCurrentDateDisplay() {
    const today = new Date()
    return today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
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
            h('span', { class: 'badge badge-neutral badge-xs' }, item.teacher?.name || ''),
            item.isGroup && h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'),
            h('span', { class: 'badge badge-error badge-xs' }, item.room?.name || ''),
          ].filter(Boolean)
        )
      })
    )
  }

  async function loadStudentSchedule() {
    try {
      // Use getFullList instead of getList (same as advance template)
      const [timeslotsData, allStudents, mondayIndividualSchedules, mondayGroupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('mondayLessonSchedule').getFullList({
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('mondayGroupLessonSchedule').getFullList({
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      // Track which students have Monday lessons
      const studentsWithLessons = new Set()

      timeslots = timeslotsData

      // Process Monday individual schedules to track students with lessons
      for (const s of mondayIndividualSchedules) {
        const studentId = s.expand?.student?.id
        if (studentId) studentsWithLessons.add(studentId)
      }

      // Process Monday group schedules to track students with lessons
      for (const s of mondayGroupSchedules) {
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
          // course: s.course || '',  // Commented out like advance template
          // level: s.level || '',    // Commented out like advance template
          slots: {},
        }
      })

      // Process Monday individual schedules
      for (const s of mondayIndividualSchedules) {
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
      for (const s of mondayGroupSchedules) {
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

      // Build table data (same pattern as advance template)
      const data = Object.values(scheduleMap)
        .sort((a, b) => a.student.localeCompare(b.student, undefined, { numeric: true }))
        .map((entry) => [
          { label: 'Student', value: entry.student },
          { label: 'English Name', value: entry.englishName },
          // { label: 'Course', value: entry.course },
          // { label: 'Level', value: entry.level },
          ...timeslots.map((ts) => {
            const schedule = entry.slots[ts.id]
            return schedule ? [schedule] : []
          }),
        ])

      const columns = [
        { name: 'Student', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        { name: 'English Name', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        // { name: 'Course', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        // { name: 'Level', width: '150px', formatter: (cell) => h('div', { class: 'text-xs' }, cell.value) },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (studentGrid) {
        const wrapper = document.querySelector('#studentGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        studentGrid.updateConfig({ columns, data }).forceRender()

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
      console.error('Error loading Monday student schedule:', error)
      toast.error('Failed to load Monday student schedule')
    }
  }

  onMount(() => {
    loadStudentSchedule()

    // Add toast notifications for real-time updates (same pattern as advance template)
    pb.collection('mondayLessonSchedule').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New Monday schedule added')
      } else if (e.action === 'update') {
        toast.info('Monday schedule updated')
      } else if (e.action === 'delete') {
        toast.warning('Monday schedule removed')
      }
      loadStudentSchedule()
    })

    pb.collection('mondayGroupLessonSchedule').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New Monday group schedule added')
      } else if (e.action === 'update') {
        toast.info('Monday group schedule updated')
      } else if (e.action === 'delete') {
        toast.warning('Monday group schedule removed')
      }
      loadStudentSchedule()
    })
  })

  onDestroy(() => {
    studentGrid?.destroy()
    studentGrid = null
    pb.collection('mondayLessonSchedule').unsubscribe()
    pb.collection('mondayGroupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center">Monday Student Schedule</h2>
  </div>

  <!-- Simplified date display only (same as advance template) -->
  <div class="mb-6">
    <h3 class="text-xl font-semibold text-primary text-center">{getCurrentDateDisplay()}</h3>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-secondary badge-xs"></div>
        <span>Group Class</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
        <span>Scheduled (hidden)</span>
      </div>
    </div>
  </div>

  <div id="studentGrid" class="border rounded-lg"></div>
</div>
