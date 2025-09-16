<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import GroupAdvanceBookingModal from './GroupAdvanceBookingModal.svelte'
  import GroupGoLiveModal from './GroupGoLiveModal.svelte'

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

  // --- Helpers ---
  const initializeWeek = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  const getWeekDates = (startDate) => {
    const monday = new Date(startDate)
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d.toISOString().split('T')[0]
    })
  }

  const getWeekRange = (startDate) => {
    const monday = new Date(startDate)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)
    if (monday.getMonth() === friday.getMonth()) {
      return `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${friday.getDate()}, ${friday.getFullYear()}`
    }
    return `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - ${friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
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
        ? cell.students.map((student) => createBadge(student.name || 'Unknown Student', 'badge-accent'))
        : [createBadge('No Students', 'badge-accent')]

    return h(
      'div',
      {
        class: 'w-full max-w-full rounded p-2 flex flex-col gap-1 text-xs justify-center items-left whitespace-nowrap',
      },
      [
        createBadge(cell.subject.name || 'No Subject', 'badge-primary'),
        createBadge(cell.teacher.name || 'No Teacher', 'badge-success'),
        createBadge(cell.groupRoom.name || 'No Room', 'badge-error'),
        ...studentBadges, // Spread multiple student badges
        // Add a count badge if there are many students
        ...(cell.students && cell.students.length > 3
          ? [createBadge(`+${cell.students.length - 3} more`, 'badge-neutral')]
          : []),
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
        name: student.name || '',
        id: student.id || '',
      }))
    } else if (item.student && Array.isArray(item.student)) {
      // Fallback to IDs only if expand data is not available
      studentsData = item.student.map((studentId) => ({
        name: `Student ${studentId}`,
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
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        {
          name: 'Group Room',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
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
        autoWidth: true,
        className: {
          table: 'w-full border text-sm',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 whitespace-pre-line align-middle text-left font-semibold',
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
    <h2>Group Room</h2>
    <h2 class="text-center flex-1">Advance Group Schedule Table (Weekly Template)</h2>
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
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
        <div class="badge badge-success badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Group Room</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-accent badge-xs"></div>
        <span>Students</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Additional Count</span>
      </div>
    </div>
  </div>

  <div id="advance-group-grid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>

<GroupAdvanceBookingModal bind:show={showAdvanceModal} bind:advanceGroupBooking onSave={loadAdvanceGroupBookings} />
<GroupGoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />
