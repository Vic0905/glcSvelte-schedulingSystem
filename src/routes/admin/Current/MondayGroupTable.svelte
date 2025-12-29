<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import MondayGroupModal from './MondayGroupModal.svelte'

  const stickyStyles = `
    #monday-group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #monday-group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #monday-group-grid th:nth-child(1), #monday-group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #monday-group-grid th:nth-child(1) { z-index: 25; }
    #monday-group-grid th:nth-child(2), #monday-group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #monday-group-grid th:nth-child(2) { z-index: 25; }
  `

  let currentMonday = $state(getMondayStart(new Date()))
  let timeslots = []
  let mondayGroupGrid = null
  let showGroupModal = $state(false)
  let isCopying = $state(false)
  let isLoading = $state(false)
  let scrollPositions = $state({ top: 0, left: 0 })

  // Cache for frequently accessed data
  const cache = {
    schedules: null,
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
    isValid: () => cache.schedules && Date.now() - cache.lastFetch < cache.cacheDuration,
  }

  let groupBooking = $state({
    id: '',
    date: '',
    groupRoom: { id: '', name: '', maxstudents: 0 },
    timeslot: { id: '', start: '', end: '' },
    teacher: { id: '', name: '' },
    students: [],
    subject: { id: '', name: '' },
    mode: 'create',
    assignedTeacher: null,
    originalTeacherId: '',
    originalSubjectId: '',
    originalTimeslotId: '',
    originalGroupRoomId: '',
  })

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

  // Save scroll position before any updates
  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#monday-group-grid .gridjs-wrapper')
    if (wrapper) {
      scrollPositions = {
        top: wrapper.scrollTop,
        left: wrapper.scrollLeft,
      }
    }
  }

  // Restore scroll position after updates
  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#monday-group-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  const changeWeek = (weeks) => {
    const d = new Date(currentMonday)
    d.setDate(d.getDate() + weeks * 7)
    currentMonday = getMondayStart(d)
  }

  const copyToAdvanceBooking = async () => {
    try {
      const schedules = await pb.collection('mondayGroupLessonSchedule').getFullList({
        filter: `date = "${currentMonday}"`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (schedules.length === 0) {
        toast.info('No schedules found for this Monday', { position: 'bottom-right', duration: 3000 })
        return
      }

      // Get unique schedules using Map for better performance
      const uniqueSchedulesMap = new Map()
      schedules.forEach((schedule) => {
        const key = `${schedule.timeslot}-${schedule.grouproom}-${schedule.subject}-${schedule.teacher}`
        if (!uniqueSchedulesMap.has(key)) {
          uniqueSchedulesMap.set(key, schedule)
        }
      })
      const uniqueSchedules = Array.from(uniqueSchedulesMap.values())

      const existingBookings = await pb
        .collection('groupAdvanceBooking')
        .getFullList()
        .catch(() => [])

      // Filter out existing bookings using Set for O(1) lookup
      const existingSet = new Set(existingBookings.map((b) => `${b.timeslot}-${b.grouproom}-${b.subject}-${b.teacher}`))
      const schedulesToCopy = uniqueSchedules.filter(
        (schedule) =>
          !existingSet.has(`${schedule.timeslot}-${schedule.grouproom}-${schedule.subject}-${schedule.teacher}`)
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
        `Date: ${getMondayDisplay(currentMonday)}\n` +
        (existingBookings.length > 0
          ? `(Skipping ${uniqueSchedules.length - schedulesToCopy.length} duplicate(s))\n`
          : '') +
        `This will create ${schedulesToCopy.length} advance booking record(s).`

      if (!confirm(confirmMessage)) return

      isCopying = true

      // Batch create for better performance
      const batchSize = 10
      for (let i = 0; i < schedulesToCopy.length; i += batchSize) {
        const batch = schedulesToCopy.slice(i, i + batchSize)
        await Promise.all(
          batch.map((schedule) =>
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
      }

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

    // Show "Scheduled" if hiddenDetails is true
    if (cell.hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    const studentCount = cell.students?.length || 0
    const maxStudents = cell.groupRoom?.maxstudents || 0
    const additionalCount = Math.max(0, studentCount - maxStudents)

    const elements = [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name || 'No Subject'),
      h('div', { class: 'badge badge-info badge-xs' }, cell.teacher.name || 'No Teacher'),
      h('div', { class: 'badge badge-error badge-xs' }, cell.groupRoom.name || 'No Room'),
    ]

    if (studentCount > 0) {
      elements.push(h('div', { class: 'badge badge-neutral badge-xs' }, `${studentCount} student(s)`))
    }

    if (additionalCount > 0) {
      elements.push(h('div', { class: 'badge badge-warning badge-xs' }, `+${additionalCount}`))
    }

    return h('div', { class: 'flex flex-col gap-1 items-center text-xs' }, elements)
  }

  async function loadMondayGroupSchedules(forceRefresh = false) {
    if (isLoading) return

    // Save scroll position before loading
    saveScrollPosition()

    isLoading = true

    try {
      // Use cache if available and not forcing refresh
      let schedules
      if (!forceRefresh && cache.isValid()) {
        schedules = cache.schedules
      } else {
        // Parallel fetching with caching
        const [timeslotsData, groupRoomsData, schedulesData] = await Promise.all([
          timeslots.length
            ? timeslots
            : pb.collection('timeslot').getFullList({
                sort: 'start',
                fields: 'id,start,end',
              }),
          pb.collection('groupRoom').getFullList({
            sort: 'name',
            expand: 'teacher',
            fields: 'id,name,maxstudents,expand',
          }),
          pb.collection('mondayGroupLessonSchedule').getFullList({
            filter: `date = "${currentMonday}"`,
            expand: 'teacher,student,subject,grouproom,timeslot',
            fields: '*,expand',
            $autoCancel: false,
          }),
        ])

        timeslots = timeslotsData
        schedules = schedulesData

        // Update cache
        cache.schedules = schedules
        cache.lastFetch = Date.now()
      }

      // Build schedule map using Map for better performance
      const scheduleMap = new Map()
      for (const s of schedules) {
        const gr = s.expand?.grouproom
        const ts = s.expand?.timeslot
        if (!gr || !ts) continue

        if (!scheduleMap.has(gr.id)) {
          scheduleMap.set(gr.id, new Map())
        }
        const roomMap = scheduleMap.get(gr.id)
        if (!roomMap.has(ts.id)) {
          roomMap.set(ts.id, new Map())
        }

        const key = `${s.subject}_${s.teacher}`
        roomMap.get(ts.id).set(key, s)
      }

      // Get group rooms for display
      const groupRooms = await pb.collection('groupRoom').getFullList({
        sort: 'name',
        expand: 'teacher',
        fields: 'id,name,maxstudents,expand',
      })

      // Build table data more efficiently
      const data = groupRooms.map((gr) => {
        const roomMap = scheduleMap.get(gr.id) || new Map()
        const teacher = gr.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Group Room', value: gr.name, disabled: true },
        ]

        // Use for loop for better performance
        for (let i = 0; i < timeslots.length; i++) {
          const ts = timeslots[i]
          const slotMap = roomMap.get(ts.id)

          if (!slotMap || slotMap.size === 0) {
            row.push({
              label: 'Empty',
              date: currentMonday,
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              students: [],
              groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
              hiddenDetails: false,
            })
          } else {
            const s = Array.from(slotMap.values())[0]

            let studentsData = []
            if (s.expand?.student && Array.isArray(s.expand.student)) {
              // Use for loop for better performance
              for (const student of s.expand.student) {
                studentsData.push({
                  englishName: student.englishName || '',
                  id: student.id || '',
                })
              }
            } else if (s.student && Array.isArray(s.student)) {
              // Use for loop for better performance
              for (const studentId of s.student) {
                studentsData.push({
                  englishName: `Student ${studentId}`,
                  id: studentId,
                })
              }
            }

            row.push({
              label: 'Schedule',
              id: s.id || '',
              date: currentMonday,
              subject: { name: s.expand?.subject?.name || '', id: s.expand?.subject?.id || '' },
              teacher: { name: s.expand?.teacher?.name || '', id: s.expand?.teacher?.id || '' },
              students: studentsData,
              groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
              hiddenDetails: s.hiddenDetails || false,
            })
          }
        }

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
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      if (mondayGroupGrid) {
        mondayGroupGrid.updateConfig({ columns, data }).forceRender()

        // Restore scroll position after DOM update
        restoreScrollPosition()
      } else {
        mondayGroupGrid = new Grid({
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
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed', // Prevents layout shifts
            },
          },
        }).render(document.getElementById('monday-group-grid'))

        mondayGroupGrid.on('cellClick', (_, cell) => {
          const cellData = cell.data
          if (cellData.disabled) return

          Object.assign(groupBooking, cellData, {
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          })

          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            groupBooking.teacher = {
              id: cellData.assignedTeacher.id,
              name: cellData.assignedTeacher.name,
            }
          }

          if (groupBooking.mode === 'edit') {
            groupBooking.originalTeacherId = cellData.teacher?.id || ''
            groupBooking.originalSubjectId = cellData.subject?.id || ''
            groupBooking.originalTimeslotId = cellData.timeslot?.id || ''
            groupBooking.originalGroupRoomId = cellData.groupRoom?.id || ''
          }

          showGroupModal = true
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
    reloadTimeout = setTimeout(() => {
      cache.schedules = null // Invalidate cache on updates
      loadMondayGroupSchedules(true)
    }, 150)
  }

  onMount(() => {
    loadMondayGroupSchedules()
    pb.collection('mondayGroupLessonSchedule').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    mondayGroupGrid?.destroy()
    mondayGroupGrid = null
    pb.collection('mondayGroupLessonSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday GRP Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <button class="btn btn-success btn-sm" onclick={copyToAdvanceBooking} disabled={isCopying || isLoading}>
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

    <h3 class="text-xl font-semibold text-primary text-center flex-1">{getMondayDisplay(currentMonday)}</h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
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
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
        <span>Scheduled (Hidden Details)</span>
      </div>
    </div>
  </div>

  <div id="monday-group-grid" class="border rounded-lg"></div>
</div>

<MondayGroupModal
  bind:show={showGroupModal}
  bind:groupBooking
  onSave={() => {
    saveScrollPosition()
    cache.schedules = null // Invalidate cache
    loadMondayGroupSchedules(true)
  }}
/>
