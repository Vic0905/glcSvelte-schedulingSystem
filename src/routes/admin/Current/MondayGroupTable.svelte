<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import MondayGroupModal from './MondayGroupModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #monday-group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #monday-group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #monday-group-grid th:nth-child(1), #monday-group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #monday-group-grid th:nth-child(1) { z-index: 25; }
    #monday-group-grid th:nth-child(2), #monday-group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #monday-group-grid th:nth-child(2) { z-index: 25; }
  `

  let weekStart = $state(getMondayStart(new Date()))
  let timeslots = []
  let mondayGroupModal
  let isCopying = $state(false)
  let isLoading = $state(false)

  function getMondayStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day // Get to Monday
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getMondayDisplay(startDate) {
    const start = new Date(startDate)
    return start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getMondayStart(d)
    loadMondayGroupSchedules()
  }

  const copyToAdvanceBooking = async () => {
    try {
      const schedules = await pb.collection('mondayGroupLessonSchedule').getFullList({
        filter: `date = "${weekStart}"`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No schedules found for this Monday', { position: 'bottom-right', duration: 3000 })
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
          description: 'No new records to copy for this Monday',
        })
        return
      }

      const confirmMessage =
        `Copy ${schedulesToCopy.length} unique Monday group schedule(s) to Advance Booking?\n\n` +
        `Date: ${getMondayDisplay(weekStart)}\n` +
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

      toast.success('Monday group schedules copied successfully!', {
        position: 'bottom-right',
        duration: 3000,
        description: `${schedulesToCopy.length} record(s) copied to Group Advance Booking`,
      })
    } catch (error) {
      console.error('Error copying to group advance booking:', error)
      toast.error('Failed to copy Monday group schedules', {
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

    // show "Scheduled" if hiddenDetails is true
    if (cell.hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h('div', { class: 'flex flex-col gap-1 items-center' }, [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name || 'No Subject'),
      h('div', { class: 'badge badge-info badge-xs' }, cell.teacher.name || 'No Teacher'),
      h('div', { class: 'badge badge-error badge-xs' }, cell.groupRoom.name || 'No Room'),
    ])
  }

  async function loadMondayGroupSchedules() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, groupRooms, schedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('mondayGroupLessonSchedule').getFullList({
          filter: `date = "${weekStart}"`,
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
              hiddenDetails: false,
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
              hiddenDetails: s.hiddenDetails || false,
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

      if (grid.mondayGroupSchedule) {
        const wrapper = document.querySelector('#monday-group-grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        grid.mondayGroupSchedule.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#monday-group-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        grid.mondayGroupSchedule = new Grid({
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
        }).render(document.getElementById('monday-group-grid'))

        grid.mondayGroupSchedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          booking.mondayData = {
            ...cellData,
            selectedDate: weekStart,
            timeslot: { id: cellData.timeslot?.id || '', ...cellData.timeslot },
            groupRoom: { ...cellData.groupRoom },
            students: cellData.students || [],
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          }

          if (booking.mondayData.mode === 'edit') {
            booking.mondayData.originalTeacherId = cellData.teacher.id
            booking.mondayData.originalSubjectId = cellData.subject.id
            booking.mondayData.originalTimeslotId = cellData.timeslot.id
            booking.mondayData.originalGroupRoomId = cellData.groupRoom.id
          }

          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            booking.mondayData.teacher = {
              id: cellData.assignedTeacher.id,
              name: cellData.assignedTeacher.name,
            }
          }

          if (mondayGroupModal?.showModal) {
            mondayGroupModal.showModal()
          } else {
            toast.error('Monday group modal not initialized')
          }
        })
      }
    } catch (error) {
      console.error('Error loading Monday group schedules:', error)
      toast.error('Failed to load Monday schedules')
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadMondayGroupSchedules, 50)
  }

  onMount(() => {
    grid.mondayGroupSchedule?.destroy()
    grid.mondayGroupSchedule = null
    loadMondayGroupSchedules()
    pb.collection('mondayGroupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    grid.mondayGroupSchedule?.destroy()
    grid.mondayGroupSchedule = null
    pb.collection('mondayGroupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday GRP Schedule Table</h2>
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

    <h3 class="text-xl font-semibold text-primary text-center mr-20">{getMondayDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span> Subject</div>
      <div class="flex gap-1"><span class="badge badge-info badge-xs"></span> Teacher</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span> Group Room</div>
    </div>
  </div>

  <div id="monday-group-grid" class="border rounded-lg"></div>
</div>

<MondayGroupModal on:refresh={loadMondayGroupSchedules} bind:this={mondayGroupModal} />
