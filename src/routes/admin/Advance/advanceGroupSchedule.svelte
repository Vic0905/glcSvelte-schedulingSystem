<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import GroupAdvanceBookingModal from './GroupAdvanceBookingModal.svelte'
  import GroupGoLiveModal from './GroupGoLiveModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #advance-group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #advance-group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #advance-group-grid th:nth-child(1), #advance-group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #advance-group-grid th:nth-child(1) { z-index: 25; }
    #advance-group-grid th:nth-child(2), #advance-group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #advance-group-grid th:nth-child(2) { z-index: 25; }
  `

  let currentWeekStart = $state('')
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

  const initializeWeek = () => {
    const today = new Date()
    const dow = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    currentWeekStart = monday.toISOString().split('T')[0]
  }

  const getWeekDates = (startDate) => {
    const monday = new Date(startDate)
    return Array.from({ length: 4 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i + 1)
      return d.toISOString().split('T')[0]
    })
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

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
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
        pb.collection('groupAdvanceBooking').getList(1, 500, {
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
    if (!confirm('⚠️ Are you sure you want to delete ALL advance group bookings? This action cannot be undone.')) return

    try {
      const allBookings = await pb.collection('groupAdvanceBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No advance group bookings found to delete.')
        return
      }

      await Promise.all(allBookings.map((b) => pb.collection('groupAdvanceBooking').delete(b.id)))
      alert(`✅ Successfully deleted ${allBookings.length} advance group bookings.`)
      loadAdvanceGroupBookings()
    } catch (error) {
      console.error('Error deleting advance group bookings:', error)
      alert('❌ Failed to delete advance group bookings. Check console for details.')
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadAdvanceGroupBookings, 150)
  }

  onMount(() => {
    initializeWeek()
    loadAdvanceGroupBookings()
    pb.collection('groupAdvanceBooking').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    advanceGroupGrid?.destroy()
    advanceGroupGrid = null
    pb.collection('groupAdvanceBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">GRP Schedule Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-error btn-sm" onclick={deleteAllAdvanceGroupBookings}>Delete All</button>
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-primary">
      {getWeekRange(currentWeekStart)}
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

<GroupAdvanceBookingModal bind:show={showAdvanceModal} bind:advanceGroupBooking onSave={loadAdvanceGroupBookings} />
<GroupGoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} {getWeekDates} />
