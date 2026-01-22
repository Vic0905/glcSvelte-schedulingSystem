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
  let scrollPositions = $state({ top: 0, left: 0 })

  // Cache for frequently accessed data
  const cache = {
    bookings: null,
    lastFetch: 0,
    cacheDuration: 30000, // 30 seconds
    isValid: () => cache.bookings && Date.now() - cache.lastFetch < cache.cacheDuration,
  }

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

  const getMondayDate = () => {
    return currentMonday
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

  // Save scroll position before any updates
  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#advance-group-grid .gridjs-wrapper')
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
      const wrapper = document.querySelector('#advance-group-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
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
      h('div', { class: 'badge badge-error badge-xs' }, cell.teacher.name || 'No Teacher'),
      // h('div', { class: 'badge badge-error badge-xs' }, cell.groupRoom.name || 'No Room'),
    ]

    if (studentCount > 0) {
      elements.push(h('div', { class: 'badge badge-neutral badge-xs' }, `${studentCount} student(s)`))
    }

    if (additionalCount > 0) {
      elements.push(h('div', { class: 'badge badge-warning badge-xs' }, `+${additionalCount}`))
    }

    return h('div', { class: 'flex flex-col gap-1 items-center text-xs' }, elements)
  }

  async function loadAdvanceGroupBookings(forceRefresh = false) {
    if (isLoading) return

    // Save scroll position before loading
    saveScrollPosition()

    isLoading = true

    try {
      // Use cache if available and not forcing refresh
      let records
      if (!forceRefresh && cache.isValid()) {
        records = cache.bookings
      } else {
        // Parallel fetching with caching
        const [timeslotsData, groupRoomsData, bookingsData] = await Promise.all([
          timeslots.length
            ? timeslots
            : pb.collection('timeslot').getFullList({
                sort: 'start',
                fields: 'id,start,end',
              }),
          allGroupRooms.length
            ? allGroupRooms
            : pb.collection('groupRoom').getFullList({
                sort: 'name',
                expand: 'teacher',
                fields: 'id,name,maxstudents,expand',
              }),
          pb.collection('mondayAdvanceGroupBooking').getFullList({
            expand: 'teacher,student,subject,grouproom,timeslot',
            fields: 'id,grouproom,timeslot,teacher,student,subject,hiddenDetails,expand',
            $autoCancel: false,
          }),
        ])

        timeslots = timeslotsData
        allGroupRooms = groupRoomsData
        records = bookingsData

        // Update cache
        cache.bookings = records
        cache.lastFetch = Date.now()
      }

      // Build schedule map using Map for better performance
      const scheduledGroupRooms = new Map()
      for (const r of records) {
        const groupRoomId = r.expand?.grouproom?.id || r.grouproom
        const slotId = r.expand?.timeslot?.id || r.timeslot

        if (!scheduledGroupRooms.has(groupRoomId)) {
          scheduledGroupRooms.set(groupRoomId, new Map())
        }
        scheduledGroupRooms.get(groupRoomId).set(slotId, r)
      }

      // Build table data more efficiently
      const data = allGroupRooms.map((groupRoom) => {
        const slotMap = scheduledGroupRooms.get(groupRoom.id) || new Map()
        const assignedTeacher = groupRoom.expand?.teacher
        const row = [
          { value: assignedTeacher?.name || '-', disabled: true },
          { value: groupRoom.name, disabled: true },
        ]

        // Use for loop for better performance
        for (let i = 0; i < timeslots.length; i++) {
          const t = timeslots[i]
          const item = slotMap.get(t.id)

          if (!item) {
            row.push({
              label: 'Empty',
              id: '',
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              students: [],
              groupRoom: {
                name: groupRoom.name,
                id: groupRoom.id,
                maxstudents: groupRoom.maxstudents || 0,
              },
              timeslot: { id: t.id, start: t.start, end: t.end },
              assignedTeacher,
              hiddenDetails: false,
            })
          } else {
            let studentsData = []
            if (item.expand?.student && Array.isArray(item.expand.student)) {
              // Use for loop for better performance
              for (const student of item.expand.student) {
                studentsData.push({
                  englishName: student.englishName || '',
                  id: student.id || '',
                })
              }
            } else if (item.student && Array.isArray(item.student)) {
              // Use for loop for better performance
              for (const studentId of item.student) {
                studentsData.push({
                  englishName: `Student ${studentId}`,
                  id: studentId,
                })
              }
            }

            row.push({
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
              students: studentsData,
              groupRoom: {
                name: groupRoom.name,
                id: groupRoom.id,
                maxstudents: groupRoom.maxstudents || 0,
              },
              timeslot: { id: t.id, start: t.start, end: t.end },
              assignedTeacher,
              hiddenDetails: item.hiddenDetails || false,
            })
          }
        }

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
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: '160px',
          formatter: formatCell,
        })),
      ]

      if (advanceGroupGrid) {
        advanceGroupGrid.updateConfig({ columns, data }).forceRender()

        // Restore scroll position after DOM update
        restoreScrollPosition()
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
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed', // Prevents layout shifts
            },
          },
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

      // Save scroll position before deletion
      saveScrollPosition()

      // Batch delete for better performance
      const batchSize = 10
      for (let i = 0; i < allBookings.length; i += batchSize) {
        const batch = allBookings.slice(i, i + batchSize)
        await Promise.all(batch.map((b) => pb.collection('mondayAdvanceGroupBooking').delete(b.id)))
      }

      // Invalidate cache
      cache.bookings = null

      alert(`✅ Successfully deleted ${allBookings.length} Monday advance group bookings.`)
      loadAdvanceGroupBookings(true) // Force refresh
    } catch (error) {
      console.error('Error deleting Monday advance group bookings:', error)
      alert('❌ Failed to delete Monday advance group bookings. Check console for details.')
    }
  }

  async function copyFromAdvanceBooking() {
    if (isLoading) return
    if (!confirm('⚡ Copy all records from Advance Group Booking to Monday Advance Group Booking?')) return

    isLoading = true
    try {
      // Fetch all advance bookings
      const advanceBookings = await pb.collection('groupAdvanceBooking').getFullList({
        expand: 'teacher,student,subject,grouproom,timeslot',
        $autoCancel: false,
      })

      if (!advanceBookings.length) {
        alert('No records found in Group Advance Booking.')
        return
      }

      // Save scroll position before copying
      saveScrollPosition()

      // Optional: delete existing Monday bookings before copying
      const existing = await pb.collection('mondayAdvanceGroupBooking').getFullList()
      if (existing.length > 0) {
        const confirmDelete = confirm(
          `There are already ${existing.length} Monday advance group bookings.\nDo you want to delete them before copying?`
        )
        if (confirmDelete) {
          // Batch delete for better performance
          const batchSize = 10
          for (let i = 0; i < existing.length; i += batchSize) {
            const batch = existing.slice(i, i + batchSize)
            await Promise.all(batch.map((b) => pb.collection('mondayAdvanceGroupBooking').delete(b.id)))
          }
        }
      }

      // Batch create for better performance
      const batchSize = 10
      for (let i = 0; i < advanceBookings.length; i += batchSize) {
        const batch = advanceBookings.slice(i, i + batchSize)
        const createPromises = batch.map((booking) =>
          pb.collection('mondayAdvanceGroupBooking').create({
            grouproom: booking.grouproom,
            timeslot: booking.timeslot,
            teacher: booking.teacher,
            student: booking.student,
            subject: booking.subject,
            hiddenDetails: true,
          })
        )
        await Promise.all(createPromises)
      }

      // Invalidate cache
      cache.bookings = null

      alert(`✅ Successfully copied ${advanceBookings.length} records from Group Advance Booking!`)
      loadAdvanceGroupBookings(true) // Force refresh
    } catch (error) {
      console.error('Error copying from Group Advance Booking:', error)
      alert('❌ Failed to copy from Group Advance Booking. Check console for details.')
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(() => {
      cache.bookings = null // Invalidate cache on updates
      loadAdvanceGroupBookings(true)
    }, 150)
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
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Monday GRP Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-2">
      <button class="btn btn-ghost btn-sm" onclick={copyFromAdvanceBooking} disabled={isLoading}>
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
      <button class="btn btn-ghost btn-sm" onclick={deleteAllAdvanceGroupBookings} disabled={isLoading}>
        Delete All
      </button>
    </div>

    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {getMondayDisplay(currentMonday)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeMonday(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeMonday(1)} disabled={isLoading}>&rarr;</button>
      <button class="btn btn-ghoat btn-sm" onclick={() => (showGoLiveModal = true)} disabled={isLoading}>
        Go Live
      </button>
    </div>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Students</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
        <span>Scheduled</span>
      </div>
    </div>
  </div>

  <div id="advance-group-grid" class="border rounded-lg"></div>
</div>

<MondayAdvanceGroupModal
  bind:show={showAdvanceModal}
  bind:advanceGroupBooking
  onSave={() => {
    saveScrollPosition()
    cache.bookings = null // Invalidate cache
    loadAdvanceGroupBookings(true)
  }}
/>
<MondayGroupGoLiveModal bind:show={showGoLiveModal} {getMondayDisplay} {currentMonday} {getMondayDate} />
