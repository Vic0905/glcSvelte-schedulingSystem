<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import MondayAdvanceGroupModal from './MondayAdvanceGroupModal.svelte'
  import MondayGroupGoLiveModal from './MondayGroupGoLiveModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #advance-group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #advance-group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #advance-group-grid th:nth-child(1), #advance-group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #advance-group-grid th:nth-child(1) { z-index: 25; }
    #advance-group-grid th:nth-child(2), #advance-group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #advance-group-grid th:nth-child(2) { z-index: 25; }
  `

  let currentMonday = $state('')
  let timeslots = []
  let allGroupRooms = []
  let advanceGroupGrid = null
  let showAdvanceModal = $state(false)
  let showGoLiveModal = $state(false)
  let isLoading = $state(false)

  let advanceGroupBooking = $state({
    id: '',
    groupRoom: { id: '', name: '', maxstudents: 0 },
    timeslot: { id: '', start: '', end: '' },
    teacher: { id: '', name: '' },
    students: [],
    subject: { id: '', name: '' },
    mode: 'create',
  })

  const initializeMonday = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentMonday = monday.toISOString().split('T')[0]
  }

  const getMondayDate = (mondayDate) => {
    const monday = new Date(mondayDate)
    return monday.toISOString().split('T')[0]
  }

  const getMondayDisplay = (mondayDate) => {
    const monday = new Date(mondayDate)
    return `Monday, ${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeMonday = (weeks) => {
    const monday = new Date(currentMonday)
    monday.setDate(monday.getDate() + weeks * 7)
    currentMonday = monday.toISOString().split('T')[0]
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    // Show "Scheduled" if hiddenDetails is true
    if (cell.hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h('div', { class: 'flex flex-col gap-1 items-center' }, [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name || 'No Subject'),
      h('div', { class: 'badge badge-info badge-xs' }, cell.teacher.name || 'No Teacher'),
      h('div', { class: 'badge badge-error badge-xs' }, cell.groupRoom.name || 'No Room'),
    ])
  }

  async function loadAdvanceGroupBookings() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, groupRoomsData, records] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeslot').getFullList({ sort: 'start' }),
        allGroupRooms.length
          ? allGroupRooms
          : pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('mondayAdvanceGroupBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      allGroupRooms = groupRoomsData

      // Build schedule map
      const scheduledGroupRooms = {}
      for (const r of records.items) {
        const groupRoomId = r.expand?.grouproom?.id || r.grouproom
        const slotId = r.expand?.timeslot?.id || r.timeslot
        scheduledGroupRooms[groupRoomId] ??= {}
        scheduledGroupRooms[groupRoomId][slotId] = r
      }

      // Build table data
      const data = allGroupRooms.map((groupRoom) => {
        const slotMap = scheduledGroupRooms[groupRoom.id] || {}
        const assignedTeacher = groupRoom.expand?.teacher
        const row = [
          { value: assignedTeacher?.name || '-', disabled: true },
          { value: groupRoom.name, disabled: true },
        ]

        timeslots.forEach((t) => {
          const item = slotMap[t.id]

          if (!item) {
            row.push({
              label: 'Empty',
              id: '',
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              students: [],
              groupRoom: { name: groupRoom.name, id: groupRoom.id, maxstudents: groupRoom.maxstudents || 0 },
              timeslot: { id: t.id, start: t.start, end: t.end },
              assignedTeacher,
              hiddenDetails: false,
            })
          } else {
            let studentsData = []
            if (item.expand?.student && Array.isArray(item.expand.student)) {
              studentsData = item.expand.student.map((student) => ({
                englishName: student.englishName || '',
                id: student.id || '',
              }))
            } else if (item.student && Array.isArray(item.student)) {
              studentsData = item.student.map((studentId) => ({
                englishName: `Student ${studentId}`,
                id: studentId,
              }))
            }

            row.push({
              label: 'Schedule',
              id: item.id || '',
              subject: { name: item.expand?.subject?.name || '', id: item.expand?.subject?.id || '' },
              teacher: { name: item.expand?.teacher?.name || '', id: item.expand?.teacher?.id || '' },
              students: studentsData,
              groupRoom: { name: groupRoom.name, id: groupRoom.id, maxstudents: groupRoom.maxstudents || 0 },
              timeslot: { id: t.id, start: t.start, end: t.end },
              assignedTeacher,
              hiddenDetails: item.hiddenDetails || false,
            })
          }
        })

        return row
      })

      const columns = [
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
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, id: t.id, width: '160px', formatter: formatCell })),
      ]

      if (advanceGroupGrid) {
        const wrapper = document.querySelector('#advance-group-grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        advanceGroupGrid.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#advance-group-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
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
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 align-middle text-center',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('advance-group-grid'))

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
    } catch (error) {
      console.error('Error loading advance group bookings:', error)
    } finally {
      isLoading = false
    }
  }

  const deleteAllAdvanceGroupBookings = async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL Monday advance group bookings? This action cannot be undone.'))
      return

    try {
      const allBookings = await pb.collection('mondayAdvanceGroupBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No Monday advance group bookings found to delete.')
        return
      }

      await Promise.all(allBookings.map((b) => pb.collection('mondayAdvanceGroupBooking').delete(b.id)))
      alert(`✅ Successfully deleted ${allBookings.length} Monday advance group bookings.`)
      loadAdvanceGroupBookings()
    } catch (error) {
      console.error('Error deleting Monday advance group bookings:', error)
      alert('❌ Failed to delete Monday advance group bookings. Check console for details.')
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadAdvanceGroupBookings, 100)
  }

  async function copyFromAdvanceBooking() {
    if (isLoading) return
    if (!confirm('⚡ Copy all records from Advance Booking to Monday Advance Booking?')) return

    isLoading = true
    try {
      // Fetch all advance bookings
      const advanceBookings = await pb.collection('groupAdvanceBooking').getFullList({
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (!advanceBookings.length) {
        alert('No records found in Advance Booking.')
        return
      }

      // Optional: delete existing Monday bookings before copying
      const existing = await pb.collection('mondayAdvanceGroupBooking').getFullList()
      if (existing.length > 0) {
        const confirmDelete = confirm(
          `There are already ${existing.length} Monday advance bookings.\nDo you want to delete them before copying?`
        )
        if (confirmDelete) {
          await Promise.all(existing.map((b) => pb.collection('mondayAdvanceGroupBooking').delete(b.id)))
        }
      }

      // Copy each advance booking to mondayAdvanceGroupBooking
      for (const booking of advanceBookings) {
        await pb.collection('mondayAdvanceGroupBooking').create({
          grouproom: booking.grouproom || booking.expand?.grouproom?.id,
          timeslot: booking.timeslot || booking.expand?.timeslot?.id,
          teacher: booking.teacher || booking.expand?.teacher?.id,
          student: booking.student || booking.expand?.student?.id,
          subject: booking.subject || booking.expand?.subject?.id,
          hiddenDetails: true,
        })
      }

      alert(`✅ Successfully copied ${advanceBookings.length} records from Advance Booking!`)
      loadAdvanceGroupBookings()
    } catch (error) {
      console.error('Error copying from Advance Booking:', error)
      alert('❌ Failed to copy from Advance Booking. Check console for details.')
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    initializeMonday()
    loadAdvanceGroupBookings()
    pb.collection('mondayAdvanceGroupBooking').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    advanceGroupGrid?.destroy()
    advanceGroupGrid = null
    pb.collection('mondayAdvanceGroupBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday GRP Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-2">
      <button class="btn btn-success btn-sm" onclick={copyFromAdvanceBooking}>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        Copy from advance
      </button>
      <button class="btn btn-error btn-sm" onclick={deleteAllAdvanceGroupBookings}>Delete All</button>
    </div>

    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getMondayDisplay(currentMonday)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeMonday(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeMonday(1)} disabled={isLoading}>&rarr;</button>
      <button class="btn btn-primary btn-sm" onclick={() => (showGoLiveModal = true)}>🚀 Go Live</button>
    </div>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
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

  <div id="advance-group-grid" class="border rounded-lg"></div>
</div>

<MondayAdvanceGroupModal bind:show={showAdvanceModal} bind:advanceGroupBooking onSave={loadAdvanceGroupBookings} />
<MondayGroupGoLiveModal bind:show={showGoLiveModal} {getMondayDisplay} {currentMonday} {getMondayDate} />
