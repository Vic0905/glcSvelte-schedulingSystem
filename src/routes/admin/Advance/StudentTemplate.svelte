<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  const stickyStyles = `
    #studentGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #studentGrid th { 
    position: sticky; 
    top: 0; 
    z-index: 20; 
    box-shadow: 0 1px 0 #ddd; 
    background-color: #484b4f; /* dark (Tailwind gray-800) */
       color: #ffffff; /* white text */
    }
    #studentGrid th:nth-child(1), #studentGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(1) { z-index: 25; }

    #studentGrid th:nth-child(2), #studentGrid td:nth-child(2) { position: sticky; left: 180px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(2) { z-index: 25; }

    #studentGrid th:nth-child(3), #studentGrid td:nth-child(3) { position: sticky; left: 320px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(3) { z-index: 25; }

    #studentGrid th:nth-child(4), #studentGrid td:nth-child(4) { position: sticky; left: 440px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #studentGrid th:nth-child(4) { z-index: 25; }
  `

  // #studentGrid th:nth-child(3), #studentGrid td:nth-child(3) { position: sticky; left: 300px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
  //   #studentGrid th:nth-child(3) { z-index: 25; }
  //   #studentGrid th:nth-child(4), #studentGrid td:nth-child(4) { position: sticky; left: 450px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
  //   #studentGrid th:nth-child(4) { z-index: 25; }

  let studentGrid = null
  let timeslots = []

  function getCurrentDateDisplay() {
    const today = new Date()
    const day = today.getDay()

    // Get Tuesday (2) of the current week
    const tuesday = new Date(today)
    tuesday.setDate(today.getDate() + (day === 0 ? 2 : 2 - day))

    // Friday is 3 days after Tuesday
    const friday = new Date(tuesday)
    friday.setDate(tuesday.getDate() + 3)

    // Format output
    const format = (date, showYear = true) =>
      date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        ...(showYear && { year: 'numeric' }),
      })

    return tuesday.getMonth() === friday.getMonth() && tuesday.getFullYear() === friday.getFullYear()
      ? `${format(tuesday, false)} - ${friday.getDate()}, ${friday.getFullYear()}`
      : `${format(tuesday)} - ${format(friday)}`
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')

    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) =>
        h(
          'div',
          { class: 'flex flex-col gap-1 p-1 items-center text-center' },
          [
            // 🔹 Header (Subject + Teacher)
            h(
              'div',
              {
                class: 'font-bold text-neutral-700 border-b border-base-300 mb-1 pb-1 w-full',
              },
              [
                h('div', {}, item.subject?.name || ''),
                h('div', { class: 'text-[10px] uppercase' }, item.teacher?.name || ''),
              ]
            ),

            // 🔹 Below (Room + Group)
            item.room && h('span', { class: 'badge badge-ghost badge-xs' }, item.room.name),

            // item.isGroup && h('span', { class: 'badge badge-ghost badge-xs' }, 'Group Class'),
          ].filter(Boolean)
        )
      )
    )
  }

  async function loadStudentSchedule() {
    try {
      const [timeslotsData, allStudents, individualBookings, groupBookings] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('advanceBooking').getFullList({
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupAdvanceBooking').getFullList({
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      // Track which students have bookings
      const studentsWithBookings = new Set()

      timeslots = timeslotsData

      // Process ALL individual bookings to track students with bookings
      for (const b of individualBookings) {
        const studentId = b.expand?.student?.id
        if (studentId) studentsWithBookings.add(studentId)
      }

      // Process ALL group bookings to track students with bookings
      for (const b of groupBookings) {
        const students = Array.isArray(b.expand?.student) ? b.expand.student : []
        students.forEach((student) => studentsWithBookings.add(student.id))
      }

      // Filter students: include non-graduated OR graduated students WITH bookings
      const students = allStudents.filter((s) => {
        if (s.status !== 'graduated') return true
        return studentsWithBookings.has(s.id)
      })

      // Build schedule map
      const scheduleMap = {}
      students.forEach((s) => {
        scheduleMap[s.id] = {
          student: s.name,
          englishName: s.englishName || '',
          course: s.course || '',
          level: s.level || '',
          status: s.status,
          created: s.created,
          slots: {},
        }
      })

      // Process ALL individual bookings
      for (const b of individualBookings) {
        const studentId = b.expand?.student?.id
        const timeslotId = b.expand?.timeslot?.id
        if (!studentId || !timeslotId || !scheduleMap[studentId]) continue

        scheduleMap[studentId].slots[timeslotId] ??= {
          subject: b.expand?.subject,
          teacher: b.expand?.teacher,
          room: b.expand?.room,
          isGroup: false,
        }
      }

      // Process ALL group bookings
      for (const b of groupBookings) {
        const students = Array.isArray(b.expand?.student) ? b.expand.student : []
        const timeslotId = b.expand?.timeslot?.id
        if (!timeslotId) continue

        students.forEach((student) => {
          if (!scheduleMap[student.id]) return
          scheduleMap[student.id].slots[timeslotId] ??= {
            subject: b.expand?.subject,
            teacher: b.expand?.teacher,
            room: b.expand?.grouproom,
            isGroup: true,
          }
        })
      }

      // Build table data
      const data = Object.values(scheduleMap)
        .sort((a, b) => {
          const statusA = a.status === 'new' ? 1 : 0
          const statusB = b.status === 'new' ? 1 : 0

          // Push "new" to bottom
          if (statusA !== statusB) {
            return statusA - statusB
          }

          // Oldest first
          return new Date(a.created) - new Date(b.created)
        })

        .map((entry) => [
          { label: 'Student', value: entry.student, status: entry.status },
          { label: 'English Name', value: entry.englishName },
          { label: 'Course', value: entry.course },
          { label: 'Level', value: entry.level },
          ...timeslots.map((ts) => {
            const schedule = entry.slots[ts.id]
            return schedule ? [schedule] : []
          }),
        ])

      const columns = [
        {
          name: 'Name',
          width: '180px',
          formatter: (cell) =>
            h(
              'div',
              { class: 'flex flex-col items-center text-neutral-700 font-bold' },
              [
                h('span', { class: 'font-semibold' }, cell.value),
                cell.status === 'new' && h('span', { class: 'badge badge-success badge-xs' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'English Name',
          width: '140px',
          formatter: (cell) => h('div', { className: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        {
          name: 'Course',
          width: '120px',
          formatter: (cell) => h('div', { className: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        {
          name: 'Level',
          width: '100px',
          formatter: (cell) => h('div', { className: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '180px', formatter: formatCell })),
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
            table: 'w-full border text-xs !border-collapse',
            th: 'text-center',
            // th: 'bg-base-200 p-2 border-t border-d !border-x-0 text-center',
            // td: 'border-t border-d !border-x-0 p-2 align-middle text-center',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('studentGrid'))
      }
    } catch (error) {
      console.error('Error loading schedule:', error)
      toast.error('Failed to load student bookings')
    }
  }

  onMount(() => {
    loadStudentSchedule()

    // Add toast notifications for real-time updates
    pb.collection('advanceBooking').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New booking added')
      } else if (e.action === 'update') {
        toast.info('Booking updated')
      } else if (e.action === 'delete') {
        toast.warning('Booking removed')
      }
      loadStudentSchedule()
    })

    pb.collection('groupAdvanceBooking').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New group booking added')
      } else if (e.action === 'update') {
        toast.info('Group booking updated')
      } else if (e.action === 'delete') {
        toast.warning('Group booking removed')
      }
      loadStudentSchedule()
    })
  })

  onDestroy(() => {
    studentGrid?.destroy()
    studentGrid = null
    pb.collection('advanceBooking').unsubscribe()
    pb.collection('groupAdvanceBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="mb-4 text-2xl font-bold">
    <h2 class="text-center">Student View Table (Advance Template)</h2>
  </div>

  <!-- Simplified date display only -->
  <div class="mb-3">
    <h3 class="text-xl font-semibold text-center">{getCurrentDateDisplay()}</h3>
  </div>

  <div id="studentGrid" class="border rounded-lg"></div>
</div>
