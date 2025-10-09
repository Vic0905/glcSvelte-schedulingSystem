<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import GroupModal from './GroupModal.svelte'

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let groupModal

  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day === 0 ? -5 : day === 1 ? 1 : 2 - day
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekDays(startDate) {
    const days = []
    const start = new Date(startDate)
    for (let i = 0; i < 4; i++) {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      days.push(day.toISOString().split('T')[0])
    }
    return days
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    const opts = { month: 'long', day: 'numeric', year: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadGroupSchedules()
  }

  const createBadge = (text, color) => h('div', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    const students = cell.students || []
    const visible = students.slice(0, 3)
    const remaining = students.length - 3

    return h('div', { class: 'flex flex-col gap-1 items-center' }, [
      createBadge(cell.subject.name || 'No Subject', 'badge-primary p-3'),
      createBadge(cell.teacher.name || 'No Teacher', 'badge-info'),
      createBadge(cell.groupRoom.name || 'No Room', 'badge-error'),
      ...(students.length > 0
        ? visible.map((s) => createBadge(s.englishName || 'Unknown Student', 'badge-neutral'))
        : [createBadge('No Students', 'badge-neutral')]),
      ...(remaining > 0 ? [createBadge(`+${remaining} more`, 'badge-warning')] : []),
    ])
  }

  async function loadGroupSchedules() {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      // Fetch all data in parallel
      const [timeslotsData, groupRooms, schedules] = await Promise.all([
        timeslots.length ? Promise.resolve(timeslots) : pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('groupLessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData

      // Build schedule lookup: groupRoom -> timeslot -> scheduleKey -> schedule
      const scheduleMap = {}
      schedules.forEach((s) => {
        const gr = s.expand?.grouproom
        const ts = s.expand?.timeslot
        if (!gr || !ts) return

        if (!scheduleMap[gr.id]) scheduleMap[gr.id] = {}
        if (!scheduleMap[gr.id][ts.id]) scheduleMap[gr.id][ts.id] = {}

        const key = `${s.subject}_${s.teacher}`
        scheduleMap[gr.id][ts.id][key] = s
      })

      // Build table data
      const data = groupRooms.map((gr) => {
        const teacher = gr.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Group Room', value: gr.name, disabled: true },
        ]

        timeslots.forEach((ts) => {
          const schedules = scheduleMap[gr.id]?.[ts.id]

          if (!schedules || Object.keys(schedules).length === 0) {
            // Empty slot
            row.push({
              label: 'Empty',
              date: weekStart,
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              students: [],
              groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          } else {
            // Use first schedule entry
            const s = Object.values(schedules)[0]

            // Process students array
            let studentsData = []
            if (s.expand?.student && Array.isArray(s.expand.student)) {
              studentsData = s.expand.student.map((student) => ({
                englishName: student.englishName || '',
                id: student.id || '',
              }))
            } else if (s.student && Array.isArray(s.student)) {
              studentsData = s.student.map((id) => ({ name: `Student ${id}`, id }))
            }

            row.push({
              label: 'Schedule',
              id: s.id || '',
              date: weekStart,
              subject: { name: s.expand?.subject?.name || '', id: s.expand?.subject?.id || '' },
              teacher: { name: s.expand?.teacher?.name || '', id: s.expand?.teacher?.id || '' },
              students: studentsData,
              groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          }
        })

        return row
      })

      // Build columns
      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
        },
        {
          name: 'Group Room',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed', style: 'pointer-events:none;' }, cell.value),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      // Initialize or update grid
      if (grid.groupSchedule) {
        requestAnimationFrame(() => {
          grid.groupSchedule.updateConfig({ columns, data }).forceRender()
        })
      } else {
        grid.groupSchedule = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          autoWidth: true,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
            td: 'border p-2 align-middle text-center',
          },
        }).render(document.getElementById('group-grid'))

        grid.groupSchedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          booking.data = {
            ...cellData,
            startDate: weekStart,
            endDate: endDate.toISOString().split('T')[0],
            timeslot: { id: cellData.timeslot?.id || '', ...cellData.timeslot },
            groupRoom: { ...cellData.groupRoom },
            students: cellData.students || [],
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          }

          // Store originals for edit mode
          if (booking.data.mode === 'edit') {
            booking.data.originalTeacherId = cellData.teacher.id
            booking.data.originalSubjectId = cellData.subject.id
            booking.data.originalTimeslotId = cellData.timeslot.id
            booking.data.originalGroupRoomId = cellData.groupRoom.id
          }

          // Auto-assign teacher for empty slots
          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            booking.data.teacher = {
              id: cellData.assignedTeacher.id,
              name: cellData.assignedTeacher.name,
            }
          }

          if (groupModal?.showModal) {
            groupModal.showModal()
          } else {
            toast.error('Group modal not initialized')
          }
        })
      }
    } catch (error) {
      console.error('Error loading group schedules:', error)
      toast.error('Failed to load schedules')
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
    if (grid.groupSchedule) {
      grid.groupSchedule.destroy()
      grid.groupSchedule = null
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2>Group Room</h2>
    <h2 class="text-center flex-1">Group Schedule Table (Weekly)</h2>
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="groupFilterDate" class="text-sm font-semibold">Week Starting:</label>
      <input
        type="date"
        id="groupFilterDate"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        onchange={loadGroupSchedules}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr; Prev Week</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>Next Week &rarr;</button>
    </div>
  </div>

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
