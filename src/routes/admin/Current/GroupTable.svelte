<script>
  import { onDestroy, onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import GroupModal from './GroupModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let groupModal
  let isCopying = $state(false)

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
    const opt = { month: 'long', day: 'numeric' }
    const opts = { month: 'long', day: 'numeric', year: 'numeric' }
    return `${start.toLocaleDateString('en-US', opt)} - ${end.toLocaleDateString('en-US', opts)}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    loadGroupSchedules()
  }

  const copyToAdvanceBooking = async () => {
    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = `(${weekDays.map((d) => `date = "${d}"`).join(' || ')})`

      // Fetch all schedules for the current week
      const schedules = await pb.collection('groupLessonSchedule').getFullList({
        filter: dateFilter,
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules (one per timeslot-grouproom-subject-teacher combination)
      const uniqueSchedulesMap = {}
      schedules.forEach((schedule) => {
        const key = `${schedule.timeslot}-${schedule.grouproom}-${schedule.subject}-${schedule.teacher}`
        if (!uniqueSchedulesMap[key]) {
          uniqueSchedulesMap[key] = schedule
        }
      })
      const uniqueSchedules = Object.values(uniqueSchedulesMap)

      // Check if any records already exist in groupAdvanceBooking (check without date filter)
      const existingBookings = await pb
        .collection('groupAdvanceBooking')
        .getFullList()
        .catch(() => [])

      // Filter out schedules that already exist in groupAdvanceBooking
      const schedulesToCopy = uniqueSchedules.filter((schedule) => {
        return !existingBookings.some(
          (booking) =>
            booking.timeslot === schedule.timeslot &&
            booking.teacher === schedule.teacher &&
            booking.subject === schedule.subject &&
            booking.grouproom === schedule.grouproom
        )
      })

      if (schedulesToCopy.length === 0) {
        toast.info('All schedules already copied!', {
          position: 'bottom-right',
          duration: 3000,
          description: 'No new records to copy for this week',
        })
        return
      }

      const confirmMessage =
        `Copy ${schedulesToCopy.length} unique group schedule(s) to Advance Booking?\n\n` +
        `Week: ${getWeekRangeDisplay(weekStart)}\n` +
        (existingBookings.length > 0
          ? `(Skipping ${uniqueSchedules.length - schedulesToCopy.length} duplicate(s))\n`
          : '') +
        `This will create ${schedulesToCopy.length} advance booking record(s).`

      if (!confirm(confirmMessage)) return

      isCopying = true

      // Copy each unique schedule to groupAdvanceBooking collection (only once, using first date)
      const copyPromises = schedulesToCopy.map((schedule) => {
        const bookingData = {
          date: schedule.date, // Use the date from the schedule itself
          timeslot: schedule.timeslot,
          teacher: schedule.teacher,
          student: schedule.student, // This should be an array of student IDs
          subject: schedule.subject,
          grouproom: schedule.grouproom,
          status: 'pending',
        }
        return pb.collection('groupAdvanceBooking').create(bookingData)
      })

      await Promise.all(copyPromises)

      toast.success('Group schedules copied successfully!', {
        position: 'bottom-right',
        duration: 3000,
        description: `${schedulesToCopy.length} record(s) copied to Group Advance Booking`,
      })
    } catch (error) {
      console.error('Error copying to group advance booking:', error)
      toast.error('Failed to copy group schedules', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isCopying = false
    }
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
      // ...(students.length > 0
      //   ? visible.map((s) => createBadge(s.englishName || 'Unknown Student', 'badge-neutral'))
      //   : [createBadge('No Students', 'badge-neutral')]),
      // ...(remaining > 0 ? [createBadge(`+${remaining} more`, 'badge-warning')] : []),
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
    <h2 class="text-center flex-1">GRP Schedule Table (Weekly)</h2>
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button class="btn btn-success btn-sm" onclick={copyToAdvanceBooking} disabled={isCopying}>
        {#if isCopying}
          <span class="loading loading-spinner loading-sm"></span>
          Copying...
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          Copy to Advance Booking
        {/if}
      </button>
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-20">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
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
