<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  const stickyStyles = `
    #mondayStudentGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #mondayStudentGrid th { position: sticky; top: 0; z-index: 20; box-shadow: 0 1px 0 #ddd; }
    #mondayStudentGrid th:nth-child(1), #mondayStudentGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd;  }
    #mondayStudentGrid th:nth-child(1) { z-index: 25; }
    #mondayStudentGrid th:nth-child(2), #mondayStudentGrid td:nth-child(2) { position: sticky; left: 150px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
    #mondayStudentGrid th:nth-child(2) { z-index: 25; }
  `
  // #mondayStudentGrid th:nth-child(3), #mondayStudentGrid td:nth-child(3) { position: sticky; left: 300px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
  //   #mondayStudentGrid th:nth-child(3) { z-index: 25; }
  //   #mondayStudentGrid th:nth-child(4), #mondayStudentGrid td:nth-child(4) { position: sticky; left: 450px; z-index: 10; box-shadow: inset -1px 0 0 #ddd;  }
  //   #mondayStudentGrid th:nth-child(4) { z-index: 25; }

  let mondayStudentGrid = null
  let timeslots = []
  let isLoading = $state(false)

  // Keep only this date display function
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

    // Check if all items have hiddenDetails = true
    const allHidden = cell.every((item) => item.hiddenDetails === true)
    if (allHidden) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) => {
        // Show "Scheduled" for items with hiddenDetails = true
        if (item.hiddenDetails === true) {
          return h('div', { class: 'badge badge-success badge-sm mb-1' }, 'Scheduled')
        }

        // Show normal booking details for items with hiddenDetails = false
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

  async function loadMondayStudentSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      // FIX 1: Use getFullList() instead of getList(1, 500)
      const [timeslotsData, allStudents, mondayIndividualSchedules, mondayGroupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({ sort: 'name' }),
        pb.collection('mondayAdvanceBooking').getFullList({
          // CHANGED
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('mondayAdvanceGroupBooking').getFullList({
          // CHANGED
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      // Debug log to see what we're loading
      console.log('Loaded data:', {
        individualSchedules: mondayIndividualSchedules.length,
        groupSchedules: mondayGroupSchedules.length,
        sampleSchedule: mondayIndividualSchedules[0]
          ? {
              hiddenDetails: mondayIndividualSchedules[0].hiddenDetails,
              type: typeof mondayIndividualSchedules[0].hiddenDetails,
            }
          : null,
      })

      // Track which students have Monday advance bookings
      const studentsWithBookings = new Set()

      timeslots = timeslotsData

      // Process Monday individual advance bookings
      for (const s of mondayIndividualSchedules) {
        // CHANGED: No .items
        const studentId = s.expand?.student?.id
        if (studentId) studentsWithBookings.add(studentId)
      }

      // Process Monday group advance bookings
      for (const s of mondayGroupSchedules) {
        // CHANGED: No .items
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        students.forEach((student) => studentsWithBookings.add(student.id))
      }

      // Filter students: include non-graduated OR graduated students WITH advance bookings
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
          // course: s.course || '',
          // level: s.level || '',
          slots: {},
        }
      })

      // Process Monday individual advance bookings
      for (const s of mondayIndividualSchedules) {
        // CHANGED: No .items
        const studentId = s.expand?.student?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!studentId || !timeslotId || !scheduleMap[studentId]) continue

        // FIX 2: Ensure hiddenDetails is properly set
        scheduleMap[studentId].slots[timeslotId] ??= {
          subject: s.expand?.subject,
          teacher: s.expand?.teacher,
          room: s.expand?.room,
          isGroup: false,
          hiddenDetails: s.hiddenDetails === true, // Ensure boolean comparison
        }
      }

      // Process Monday group advance bookings
      for (const s of mondayGroupSchedules) {
        // CHANGED: No .items
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
            hiddenDetails: s.hiddenDetails === true, // Ensure boolean comparison
          }
        })
      }

      // Build table data
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
      toast.error('Failed to load Monday student schedule')
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

  <!-- Simplified date display only -->
  <div class="mb-6">
    <h3 class="text-xl font-semibold text-primary text-center">{getCurrentDateDisplay()}</h3>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2 mb-4">
    <div class="flex flex-wrap items-center gap-4 text-xs mb-2">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-info badge-xs"></div>
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

  <div id="mondayStudentGrid" class="border rounded-lg"></div>
</div>
