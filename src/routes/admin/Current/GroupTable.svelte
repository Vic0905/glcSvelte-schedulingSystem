<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import GroupModal from './GroupModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(1), #group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(1) { z-index: 25; }
    #group-grid th:nth-child(2), #group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(2) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let groupModal
  let isCopying = $state(false)
  let isLoading = $state(false)

  function getWeekStart(date) {
    const d = new Date(date)
    const diff = d.getDay() === 0 ? -5 : d.getDay() === 1 ? 1 : 2 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekDays(startDate) {
    const start = new Date(startDate)
    return Array.from({ length: 4 }, (_, i) => {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      return day.toISOString().split('T')[0]
    })
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    return `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
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

      const schedules = await pb.collection('groupLessonSchedule').getFullList({
        filter: dateFilter,
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No schedules found for this week', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules
      const uniqueSchedulesMap = {}
      schedules.forEach((schedule) => {
        const key = `${schedule.timeslot}-${schedule.grouproom}-${schedule.subject}-${schedule.teacher}`
        uniqueSchedulesMap[key] ??= schedule
      })
      const uniqueSchedules = Object.values(uniqueSchedulesMap)

      const existingBookings = await pb
        .collection('groupAdvanceBooking')
        .getFullList()
        .catch(() => [])

      const schedulesToCopy = uniqueSchedules.filter(
        (schedule) =>
          !existingBookings.some(
            (booking) =>
              booking.timeslot === schedule.timeslot &&
              booking.teacher === schedule.teacher &&
              booking.subject === schedule.subject &&
              booking.grouproom === schedule.grouproom
          )
      )

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

      await Promise.all(
        schedulesToCopy.map((schedule) =>
          pb.collection('groupAdvanceBooking').create({
            date: schedule.date,
            timeslot: schedule.timeslot,
            teacher: schedule.teacher,
            student: schedule.student,
            subject: schedule.subject,
            grouproom: schedule.grouproom,
            status: 'pending',
          })
        )
      )

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

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    const elements = [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name || 'No Subject'),
      h('div', { class: 'badge badge-error badge-xs' }, cell.teacher.name || 'No Teacher'),
      // h('div', { class: 'badge badge-error badge-xs' }, cell.groupRoom.name || 'No Room'),
    ]

    // Add student count badge like in advance group
    const studentCount = cell.students?.length || 0
    if (studentCount > 0) {
      elements.push(
        h('div', { class: 'badge badge-neutral badge-xs' }, `${studentCount} student${studentCount !== 1 ? 's' : ''}`)
      )
    }

    return h('div', { class: 'flex flex-col gap-1 items-center text-xs' }, elements)
  }

  async function loadGroupSchedules() {
    if (isLoading) return
    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      const [timeslotsData, groupRooms, schedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('groupLessonSchedule').getFullList({
          filter: dateFilter,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData

      // Build schedule map
      const scheduleMap = {}
      for (const s of schedules) {
        const gr = s.expand?.grouproom
        const ts = s.expand?.timeslot
        if (!gr || !ts) continue

        scheduleMap[gr.id] ??= {}
        scheduleMap[gr.id][ts.id] ??= {}

        const key = `${s.subject}_${s.teacher}`
        scheduleMap[gr.id][ts.id][key] = s
      }

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
            const s = Object.values(schedules)[0]

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
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, id: t.id, width: '160px', formatter: formatCell })),
      ]

      if (grid.groupSchedule) {
        const wrapper = document.querySelector('#group-grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        grid.groupSchedule.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#group-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
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
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 align-middle text-center',
          },
          style: { table: { 'border-collapse': 'collapse' } },
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

          if (booking.data.mode === 'edit') {
            booking.data.originalTeacherId = cellData.teacher.id
            booking.data.originalSubjectId = cellData.subject.id
            booking.data.originalTimeslotId = cellData.timeslot.id
            booking.data.originalGroupRoomId = cellData.groupRoom.id
          }

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
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadGroupSchedules, 150)
  }

  onMount(() => {
    grid.groupSchedule?.destroy()
    grid.groupSchedule = null
    loadGroupSchedules()
    pb.collection('groupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    grid.groupSchedule?.destroy()
    grid.groupSchedule = null
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">GRP Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
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

    <h3 class="text-xl font-semibold text-primary text-center mr-20">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span> Subject</div>
      <div class="flex gap-1"><span class="badge badge-info badge-xs"></span> Teacher</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span> Student(s)</div>
    </div>
  </div>

  <div id="group-grid" class="border rounded-lg"></div>
</div>

<GroupModal on:refresh={loadGroupSchedules} bind:this={groupModal} />
