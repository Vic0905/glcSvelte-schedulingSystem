<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import GroupAdvanceBookingModal from './GroupAdvanceBookingModal.svelte'
  import GroupGoLiveModal from './GroupGoLiveModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // --- State ---
  let currentWeekStart = $state('')
  let timeslots = []
  let allGroupRooms = []
  let advanceGroupGrid = null
  let columns = null

  let showAdvanceModal = $state(false)
  let showGoLiveModal = $state(false)

  let advanceGroupBooking = $state({
    id: '',
    groupRoom: { id: '', name: '', maxstudents: 0 },
    timeslot: { id: '', start: '', end: '' },
    teacher: { id: '', name: '' },
    students: [], // Array for multiple students
    subject: { id: '', name: '' },
    mode: 'create',
  })

  // helpers
  const initializeWeek = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  // Generate Tuesday to Friday dates
  const getWeekDates = (startDate) => {
    const monday = new Date(startDate)
    const weekDates = []
    for (let i = 2; i <= 5; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + (i - 1))
      weekDates.push(d.toISOString().split('T')[0])
    }
    return weekDates
  }

  const getWeekRange = (startDate) => {
    const monday = new Date(startDate)
    const tuesday = new Date(monday)
    tuesday.setDate(monday.getDate() + 1)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)

    if (tuesday.getMonth() === friday.getMonth()) {
      return `${tuesday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${friday.getDate()}, ${friday.getFullYear()}`
    }
    return `${tuesday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} & ${friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeWeek = (weeks) => {
    const monday = new Date(currentWeekStart)
    monday.setDate(monday.getDate() + weeks * 7)
    currentWeekStart = monday.toISOString().split('T')[0]
    loadAdvanceGroupBookings()
  }

  // --- Cell Helpers ---
  const createBadge = (text, color) => h('div', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    // Handle multiple students
    const studentBadges =
      cell.students && cell.students.length > 0
        ? cell.students.map((student) => createBadge(student.englishName || 'Unknown Student', 'badge-neutral'))
        : [createBadge('No Students', 'badge-neutral')]

    return h(
      'div',
      {
        class: 'flex flex-col gap-1 items-center',
      },
      [
        createBadge(cell.subject.name || 'No Subject', 'badge-primary p-3'),
        createBadge(cell.teacher.name || 'No Teacher', 'badge-info'),
        createBadge(cell.groupRoom.name || 'No Room', 'badge-error'),
        // ...studentBadges, // Spread multiple student badges
        // // Add a count badge if there are many students
        // ...(cell.students && cell.students.length > 3
        //   ? [createBadge(`+${cell.students.length - 3} more`, 'badge-warning')]
        //   : []), ===temporarly disabled
      ]
    )
  }

  const createSlotData = (item, groupRoom, groupRoomId, groupRoomData, t, assignedTeacher) => {
    if (!item) {
      return {
        label: 'Empty',
        id: '',
        subject: { name: '', id: '' },
        teacher: { name: '', id: '' },
        students: [], // Empty array for students
        groupRoom: { name: groupRoom, id: groupRoomId, maxstudents: groupRoomData?.maxstudents || 0 },
        timeslot: { id: t.id, start: t.start, end: t.end },
        assignedTeacher,
      }
    }

    // Handle students as array
    let studentsData = []
    if (item.expand?.student && Array.isArray(item.expand.student)) {
      studentsData = item.expand.student.map((student) => ({
        englishName: student.englishName || '',
        id: student.id || '',
      }))
    } else if (item.student && Array.isArray(item.student)) {
      // Fallback to IDs only if expand data is not available
      studentsData = item.student.map((studentId) => ({
        englishName: `Student ${studentId}`,
        id: studentId,
      }))
    }

    return {
      label: 'Schedule',
      id: item.id || '',
      subject: {
        name: item.expand?.subject?.name || '',
        id: item.expand?.subject?.id || '',
      },
      teacher: {
        name: item.expand?.teacher?.name || '',
        id: item.expand?.teacher?.id || '',
      },
      students: studentsData, // Array of students
      groupRoom: { name: groupRoom, id: groupRoomId, maxstudents: groupRoomData?.maxstudents || 0 },
      timeslot: { id: t.id, start: t.start, end: t.end },
      assignedTeacher,
    }
  }

  // --- Load Data ---
  async function loadAdvanceGroupBookings() {
    // Cache timeslots + group rooms
    if (!timeslots.length) {
      timeslots = await pb.collection('timeslot').getFullList({ sort: 'start' })
    }
    if (!allGroupRooms.length) {
      allGroupRooms = await pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' })
    }

    // Use getList (paginated) - assuming you have a collection named 'groupAdvanceBooking'
    const { items: records } = await pb.collection('groupAdvanceBooking').getList(1, 500, {
      expand: 'teacher,student,subject,grouproom,timeslot',
    })

    const scheduledGroupRooms = {}
    for (const r of records) {
      const groupRoomId = r.expand?.grouproom?.id || r.grouproom
      const slotId = r.expand?.timeslot?.id || r.timeslot
      if (!scheduledGroupRooms[groupRoomId]) scheduledGroupRooms[groupRoomId] = {}
      scheduledGroupRooms[groupRoomId][slotId] = r
    }

    // Transform into grid rows
    const data = allGroupRooms.map((groupRoom) => {
      const slotMap = scheduledGroupRooms[groupRoom.id] || {}
      const assignedTeacher = groupRoom.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'
      const row = [
        { value: teacherName, disabled: true },
        { value: groupRoom.name, disabled: true },
      ]
      timeslots.forEach((t) => {
        const item = slotMap[t.id]
        row.push(createSlotData(item, groupRoom.name, groupRoom.id, groupRoom, t, assignedTeacher))
      })
      return row
    })

    // Build columns only once
    if (!columns) {
      columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        {
          name: 'Group Room',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: '160px',
          formatter: formatCell,
        })),
      ]
    }

    // Update or create grid
    if (advanceGroupGrid) {
      requestAnimationFrame(() => {
        advanceGroupGrid.updateConfig({ data }).forceRender()
      })
    } else {
      advanceGroupGrid = new Grid({
        columns,
        data,
        search: false,
        sort: false,
        pagination: false,
        className: {
          table: 'w-full border text-xs',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 align-middle text-center',
        },
      }).render(document.getElementById('advance-group-grid'))

      // Click handler (set once)
      advanceGroupGrid.on('cellClick', (_, cell) => {
        const cellData = cell.data
        if (cellData.disabled) return
        Object.assign(advanceGroupBooking, cellData)
        advanceGroupBooking.mode = cellData.label === 'Empty' ? 'create' : 'edit'
        if (cellData.label === 'Empty' && cellData.assignedTeacher) {
          advanceGroupBooking.teacher = { ...cellData.assignedTeacher }
        }
        showAdvanceModal = true
      })
    }
  }

  // 🗑️ Delete all advance group bookings
  const deleteAllAdvanceGroupBookings = async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL advance group bookings? This action cannot be undone.')) return

    try {
      const allBookings = await pb.collection('groupAdvanceBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No advance group bookings found to delete.')
        return
      }

      // Use Promise.all for faster bulk deletion
      await Promise.all(allBookings.map((b) => pb.collection('groupAdvanceBooking').delete(b.id)))

      alert(`✅ Successfully deleted ${allBookings.length} advance group bookings.`)
      loadAdvanceGroupBookings()
    } catch (error) {
      console.error('Error deleting advance group bookings:', error)
      alert('❌ Failed to delete advance group bookings. Check console for details.')
    }
  }

  onMount(() => {
    initializeWeek()
    loadAdvanceGroupBookings()
  })

  onDestroy(() => {
    if (advanceGroupGrid) {
      advanceGroupGrid.destroy()
      advanceGroupGrid = null
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Advance GRP Schedule Table (TEMPLATE)</h2>
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-error btn-sm" onclick={deleteAllAdvanceGroupBookings}>Delete All</button>
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getWeekRange(currentWeekStart)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
      <button class="btn btn-primary btn-sm" onclick={() => (showGoLiveModal = true)}>🚀 Go Live</button>
    </div>
  </div>

  <!-- Legend -->
  <div class="p-3 bg-base-200 rounded-lg">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-info badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Group Room</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Students</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-warning badge-xs"></div>
        <span>Additional Count</span>
      </div>
    </div>
  </div>

  <div id="advance-group-grid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>

<GroupAdvanceBookingModal bind:show={showAdvanceModal} bind:advanceGroupBooking onSave={loadAdvanceGroupBookings} />
<GroupGoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />
