<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import MondayBookingModal from './MondayBookingModal.svelte'
  import MondayGoLiveModal from './MondayGoLiveModal.svelte'

  const stickyStyles = `
    #monday-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #monday-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #monday-grid th:nth-child(1), #monday-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #monday-grid th:nth-child(1) { z-index: 25; }
    #monday-grid th:nth-child(2), #monday-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #monday-grid th:nth-child(2) { z-index: 25; }
  `

  let currentMonday = $state('')
  let timeslots = []
  let rooms = []
  let mondayGrid = null
  let showMondayModal = $state(false)
  let showGoLiveModal = $state(false)
  let isLoading = $state(false)

  let mondayBooking = $state({
    id: '',
    room: { id: '', name: '' },
    timeslot: { id: '', start: '', end: '' },
    teacher: { id: '', name: '' },
    student: { id: '', name: '' },
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

  const getMondayDate = () => {
    return currentMonday
  }

  const getMondayDisplay = (mondayDate) => {
    const monday = new Date(mondayDate)
    return monday.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const changeWeek = (weeks) => {
    const monday = new Date(currentMonday)
    monday.setDate(monday.getDate() + weeks * 7)
    currentMonday = monday.toISOString().split('T')[0]
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    if (cell.hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }
    return h('div', { class: 'flex flex-col gap-1 text-xs items-center' }, [
      h('div', { class: 'badge badge-primary badge-xs p-3' }, cell.subject.name),
      h('div', { class: 'badge badge-info badge-xs' }, cell.teacher.name),
      h('div', { class: 'badge badge-neutral badge-xs' }, cell.student.englishName),
      h('div', { class: 'badge badge-error badge-xs' }, cell.room.name),
    ])
  }

  async function loadMondayBookings() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, roomsData, bookings] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        rooms.length ? rooms : pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('mondayAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
      ])

      timeslots = timeslotsData
      rooms = roomsData

      // Build schedule map
      const scheduledRooms = {}
      for (const booking of bookings.items) {
        const roomId = booking.expand?.room?.id || booking.room
        const slotId = booking.expand?.timeslot?.id || booking.timeslot
        scheduledRooms[roomId] ??= {}
        scheduledRooms[roomId][slotId] = booking
      }

      // Build table data
      const data = rooms.map((room) => {
        const slotMap = scheduledRooms[room.id] || {}
        const assignedTeacher = room.expand?.teacher
        const row = [
          { value: assignedTeacher?.name || '-', disabled: true },
          { value: room.name, disabled: true },
        ]

        timeslots.forEach((timeslot) => {
          const item = slotMap[timeslot.id]
          row.push({
            label: item ? 'Schedule' : 'Empty',
            id: item?.id || '',
            subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
            teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
            student: { englishName: item?.expand?.student?.englishName || '', id: item?.expand?.student?.id || '' },
            room: { name: room.name, id: room.id },
            timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
            assignedTeacher,
            hiddenDetails: item?.hiddenDetails || false,
          })
        })

        return row
      })

      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value),
        },
        { name: 'Room', width: '120px', formatter: (cell) => h('span', { class: 'cursor-not-allowed' }, cell.value) },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, id: t.id, width: '160px', formatter: formatCell })),
      ]

      if (mondayGrid) {
        const wrapper = document.querySelector('#monday-grid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        mondayGrid.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#monday-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        mondayGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-1 border text-center',
            td: 'border p-2 align-middle text-center',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('monday-grid'))

        mondayGrid.on('cellClick', (_, cell) => {
          const cellData = cell.data
          if (cellData.disabled) return

          Object.assign(mondayBooking, cellData)
          mondayBooking.mode = cellData.label === 'Empty' ? 'create' : 'edit'

          if (cellData.label === 'Empty' && cellData.assignedTeacher) {
            mondayBooking.teacher = { ...cellData.assignedTeacher }
          }

          showMondayModal = true
        })
      }
    } catch (error) {
      console.error('Error loading Monday bookings:', error)
    } finally {
      isLoading = false
    }
  }

  const deleteAllMondayBookings = async () => {
    if (!confirm('⚠️ Are you sure you want to delete ALL Monday advance bookings? This action cannot be undone.'))
      return

    try {
      const allBookings = await pb.collection('mondayAdvanceBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No Monday advance bookings found to delete.')
        return
      }

      await Promise.all(allBookings.map((b) => pb.collection('mondayAdvanceBooking').delete(b.id)))
      alert(`✅ Successfully deleted ${allBookings.length} Monday advance bookings.`)
      loadMondayBookings()
    } catch (error) {
      console.error('Error deleting Monday bookings:', error)
      alert('❌ Failed to delete Monday bookings. Check console for details.')
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadMondayBookings, 100)
  }

  async function copyFromAdvanceBooking() {
    if (isLoading) return
    if (!confirm('⚡ Copy all records from Advance Booking to Monday Advance Booking?')) return

    isLoading = true
    try {
      // Fetch all advance bookings
      const advanceBookings = await pb.collection('advanceBooking').getFullList({
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (!advanceBookings.length) {
        alert('No records found in Advance Booking.')
        return
      }

      // Optional: delete existing Monday bookings before copying
      const existing = await pb.collection('mondayAdvanceBooking').getFullList()
      if (existing.length > 0) {
        const confirmDelete = confirm(
          `There are already ${existing.length} Monday advance bookings.\nDo you want to delete them before copying?`
        )
        if (confirmDelete) {
          await Promise.all(existing.map((b) => pb.collection('mondayAdvanceBooking').delete(b.id)))
        }
      }

      // Copy each advance booking to mondayAdvanceBooking
      for (const booking of advanceBookings) {
        await pb.collection('mondayAdvanceBooking').create({
          room: booking.room,
          timeslot: booking.timeslot,
          teacher: booking.teacher,
          student: booking.student,
          subject: booking.subject,
          hiddenDetails: true,
        })
      }

      alert(`✅ Successfully copied ${advanceBookings.length} records from Advance Booking!`)
      loadMondayBookings()
    } catch (error) {
      console.error('Error copying from Advance Booking:', error)
      alert('❌ Failed to copy from Advance Booking. Check console for details.')
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    initializeMonday()
    loadMondayBookings()
    pb.collection('mondayAdvanceBooking').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    mondayGrid?.destroy()
    mondayGrid = null
    pb.collection('mondayAdvanceBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday MTM Table (Advance Template)</h2>
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
      <button class="btn btn-error btn-sm" onclick={deleteAllMondayBookings}>Delete All</button>
    </div>
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getMondayDisplay(currentMonday)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
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
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
    </div>
  </div>

  <div id="monday-grid" class="border rounded-lg"></div>
</div>

<MondayBookingModal bind:show={showMondayModal} bind:mondayBooking onSave={loadMondayBookings} />
<MondayGoLiveModal bind:show={showGoLiveModal} {getMondayDisplay} {currentMonday} {getMondayDate} />
