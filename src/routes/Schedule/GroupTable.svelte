<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import GroupModal from './GroupModal.svelte'

  let date = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  let timeslots = []
  let groupModal

  const changeDate = (days) => {
    const currentDate = new Date(date)
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadGroupSchedules()
  }

  const createBadge = (text, colorClass) => h('div', { class: `badge ${colorClass} badge-xs` }, text)

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
        class: 'w-full max-w-full rounded p-1 flex flex-col gap-1 text-xs truncate',
      },
      [
        createBadge(cell.subject.name || 'No Subject', 'badge-primary'),
        createBadge(cell.teacher.name || 'No Teacher', 'badge-info'),
        createBadge(cell.groupRoom.name || 'No Room', 'badge-error'),
        ...studentBadges, // Spread multiple student badges
        // Add a count badge if there are many students
        ...(cell.students && cell.students.length > 3
          ? [createBadge(`+${cell.students.length - 3} more`, 'badge-warning')]
          : []),
      ]
    )
  }

  // Compose slot data
  const createSlotData = (item, groupRoom, groupRoomId, groupRoomData, t, assignedTeacher) => {
    if (!item) {
      return {
        label: 'Empty',
        id: '',
        date,
        subject: { name: '', id: '' },
        teacher: { name: '', id: '' },
        students: [], // Changed from student to students array
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
        name: `Student ${studentId}`,
        id: studentId,
      }))
    }

    return {
      label: 'Schedule',
      id: item.id || '',
      date,
      subject: {
        name: item.expand?.subject?.name || '',
        id: item.expand?.subject?.id || '',
      },
      teacher: {
        name: item.expand?.teacher?.name || '',
        id: item.expand?.teacher?.id || '',
      },
      students: studentsData, // Changed from student to students array
      groupRoom: { name: groupRoom, id: groupRoomId, maxstudents: groupRoomData?.maxstudents || 0 },
      timeslot: { id: t.id, start: t.start, end: t.end },
      assignedTeacher,
    }
  }

  async function loadGroupSchedules() {
    if (!timeslots.length) {
      timeslots = await pb.collection('timeslot').getFullList({ sort: 'start' })
    }

    const allGroupRooms = await pb.collection('groupRoom').getFullList({
      sort: 'name',
      expand: 'teacher',
    })

    const filter = `date = "${date}"`
    const records = await pb.collection('groupLessonSchedule').getFullList({
      filter: filter,
      expand: 'teacher,student,subject,grouproom,timeslot',
    })

    const scheduledGroupRooms = {}
    records.forEach((r) => {
      const gr = r.expand?.grouproom
      const ts = r.expand?.timeslot
      if (!gr || !ts) return
      if (!scheduledGroupRooms[gr.id]) scheduledGroupRooms[gr.id] = {}
      scheduledGroupRooms[gr.id][ts.id] = r
    })

    const data = allGroupRooms.map((gr) => {
      const slotMap = scheduledGroupRooms[gr.id] || {}
      const assignedTeacher = gr.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'

      const row = [
        { label: 'Teacher', value: teacherName, disabled: true },
        { label: 'Group Room', value: gr.name, disabled: true },
      ]

      timeslots.forEach((t) => {
        const item = slotMap[t.id]
        const slotData = createSlotData(item, gr.name, gr.id, gr, t, assignedTeacher)
        row.push(slotData)
      })

      return row
    })

    grid.groupColumns = [
      {
        name: 'Teacher',
        formatter: (cell) => h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
      },
      {
        name: 'Group Room',
        formatter: (cell) => h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
      },
      ...timeslots.map((t) => ({
        name: `${t.start} - ${t.end}`,
        id: t.id,
        width: 'auto',
        formatter: formatCell,
      })),
    ]

    if (grid.groupSchedule) {
      requestAnimationFrame(() => {
        grid.groupSchedule.updateConfig({ columns: grid.groupColumns, data }).forceRender()
      })
    } else {
      grid.groupSchedule = new Grid({
        columns: grid.groupColumns,
        data,
        search: false,
        sort: false,
        pagination: { enabled: true, limit: 50 },
        autoWidth: true,
        className: {
          table: 'w-full border text-sm',
          th: 'bg-base-200 p-2 border text-center',
          td: 'border p-2 whitespace-nowrap align-middle text-center',
        },
      }).render(document.getElementById('group-grid'))

      grid.groupSchedule.on('cellClick', (...args) => {
        const cellData = args[1].data
        if (cellData.disabled === true) return

        booking.data = {
          id: '',
          date: '',
          startDate: '',
          endDate: '',
          subject: { id: '', name: '' },
          teacher: { id: '', name: '' },
          students: [], // Changed from student to students array
          groupRoom: { id: '', name: '' },
          timeslot: { id: '', start: '', end: '' },
          mode: 'create',
        }

        console.log(args)

        Object.assign(booking.data, cellData)
        booking.data.date = cellData.date
        booking.data.startDate = cellData.date
        booking.data.endDate = cellData.date
        booking.data.timeslot.id = cellData.timeslot?.id || ''
        booking.data.groupRoom = { ...cellData.groupRoom }
        booking.data.students = cellData.students || [] // Handle students array
        booking.data.mode = cellData.label === 'Empty' ? 'create' : 'edit'

        if (cellData.label === 'Empty' && cellData.assignedTeacher) {
          booking.data.teacher.id = cellData.assignedTeacher.id
          booking.data.teacher.name = cellData.assignedTeacher.name
        }

        if (groupModal && typeof groupModal.showModal === 'function') {
          groupModal.showModal()
        } else {
          toast.error('Group modal not initialized or missing showModal method.')
        }
      })
    }
  }

  onMount(() => {
    if (grid.groupSchedule) {
      grid.groupSchedule.destroy()
      grid.groupSchedule = null
    }
    loadGroupSchedules()
  })

  onDestroy(() => {
    console.log('GroupTable component destroyed!')

    if (grid.groupSchedule) {
      grid.groupSchedule.destroy()
      grid.groupSchedule = null
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="">Group Room</h2>
    <h2 class="text-center flex-1">Group Schedule Table (Daily)</h2>
  </div>

  <!-- Filter row -->
  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="groupFilterDate" class="text-sm font-semibold">Filter Date:</label>
      <input
        type="date"
        id="groupFilterDate"
        bind:value={date}
        class="input input-bordered input-sm w-40"
        onchange={loadGroupSchedules}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
      {new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })} - {new Date(date).toLocaleDateString('en-US', { weekday: 'long' })}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(1)}>&rarr;</button>
    </div>
  </div>

  <!-- Legend for schedules -->
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

  <div id="group-grid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>

<GroupModal on:refresh={loadGroupSchedules} bind:this={groupModal} />
