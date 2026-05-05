<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import GroupAdvanceBookingModal from './GroupAdvanceBookingModal.svelte'
  import GroupGoLiveModal from './GroupGoLiveModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let currentWeekStart = $state('')
  let timeslots = []
  let allGroupRooms = []
  let advanceGroupGrid = null
  let showAdvanceModal = $state(false)
  let showGoLiveModal = $state(false)
  let isLoading = $state(false)

  // Cache for scroll position
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
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    // 🔹 Header (Subject + Teacher)
    const header = h(
      'div',
      {
        class: 'font-bold text-neutral-700 border-b border-base-500 mb-1 pb-1 w-full text-center',
      },
      [
        h('div', {}, cell.subject?.name || 'No Subject'),
        h('div', { class: 'text-[10px] uppercase mt-1' }, cell.teacher?.name || 'No Teacher'),
      ]
    )

    // 🔹 Students
    let studentsSection = null

    if (cell.students?.length > 0) {
      const studentNames = cell.students
        .filter((s) => s.status !== 'graduated')
        .map((s) => h('span', { class: 'badge badge-ghost badge-xs font-semibold' }, s.englishName))

      studentsSection = h('div', { class: 'flex flex-wrap gap-1 justify-center mt-1' }, studentNames)
    }

    return h(
      'div',
      { class: 'flex flex-col gap-1 p-1 items-center text-xs w-full' },
      [header, studentsSection].filter(Boolean) // 👈 removes null
    )
  }

  // Save scroll position
  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#advance-group-grid .gridjs-wrapper')
    if (wrapper) {
      scrollPositions = {
        top: wrapper.scrollTop,
        left: wrapper.scrollLeft,
      }
    }
  }

  // Restore scroll position
  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#advance-group-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  async function loadAdvanceGroupBookings(forceRefresh = false) {
    if (isLoading) return

    // Save scroll position before loading
    saveScrollPosition()

    isLoading = true

    try {
      // Use cache if available
      let records
      if (!forceRefresh && cache.isValid()) {
        records = cache.bookings
      } else {
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
          pb.collection('groupAdvanceBooking').getFullList({
            expand: 'teacher,student,subject,grouproom,timeslot',
            fields: 'id,grouproom,timeslot,teacher,student,subject,expand',
          }),
        ])

        timeslots = timeslotsData
        allGroupRooms = groupRoomsData
        records = bookingsData

        // ========== FILTERING LOGIC START ==========
        // Create maps for counting bookings
        const studentBookingCount = new Map()
        const teacherBookingCount = new Map()

        // Count bookings per user
        records.forEach((booking) => {
          const teacherId = booking.expand?.teacher?.id || booking.teacher

          // Count teacher bookings
          if (teacherId) {
            teacherBookingCount.set(teacherId, (teacherBookingCount.get(teacherId) || 0) + 1)
          }

          // Count student bookings - students are an array in group bookings
          const studentIds = booking.expand?.student || booking.student || []
          if (Array.isArray(studentIds)) {
            studentIds.forEach((studentId) => {
              if (studentId && typeof studentId === 'string') {
                studentBookingCount.set(studentId, (studentBookingCount.get(studentId) || 0) + 1)
              } else if (studentId && typeof studentId === 'object' && studentId.id) {
                studentBookingCount.set(studentId.id, (studentBookingCount.get(studentId.id) || 0) + 1)
              }
            })
          }
        })

        // Filter bookings - show graduated students and disabled teachers if they have ANY bookings
        const activeBookings = records.filter((booking) => {
          const teacher = booking.expand?.teacher

          // Check teacher: if disabled, only show if they have at least 1 booking
          if (teacher && teacher.status === 'disabled') {
            const hasAnyBookings = (teacherBookingCount.get(teacher.id) || 0) >= 1
            return hasAnyBookings
          }

          return true
        })

        // Filter group rooms based on assigned teacher status
        const activeGroupRooms = groupRoomsData.filter((groupRoom) => {
          const assignedTeacher = groupRoom.expand?.teacher
          if (!assignedTeacher) return true

          // Check if teacher is disabled
          if (assignedTeacher.status === 'disabled') {
            // Check if teacher has any bookings
            const hasBookings = teacherBookingCount.has(assignedTeacher.id)
            return hasBookings
          }

          return true
        })

        // Update cache with filtered data
        cache.bookings = activeBookings
        cache.lastFetch = Date.now()

        // Update group rooms with filtered list
        allGroupRooms = activeGroupRooms

        // Use filtered bookings for building the schedule
        records = activeBookings
        // ========== FILTERING LOGIC END ==========
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
            })
          } else {
            let studentsData = []
            if (item.expand?.student && Array.isArray(item.expand.student)) {
              // Use for loop for better performance
              for (const student of item.expand.student) {
                studentsData.push({
                  englishName: student.englishName || '',
                  id: student.id || '',
                  status: student.status || 'active',
                })
              }
            } else if (item.student && Array.isArray(item.student)) {
              // Use for loop for better performance
              for (const studentId of item.student) {
                studentsData.push({
                  englishName: `Student ${studentId}`,
                  id: studentId,
                  status: 'unknown',
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
                status: item.expand?.teacher?.status || 'active',
              },
              students: studentsData,
              groupRoom: {
                name: groupRoom.name,
                id: groupRoom.id,
                maxstudents: groupRoom.maxstudents || 0,
              },
              timeslot: { id: t.id, start: t.start, end: t.end },
              assignedTeacher,
            })
          }
        }

        return row
      })

      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) =>
            h(
              'div',
              { class: 'flex flex-col items-center text-neutral-700 font-bold' },
              [
                h('span', { class: 'font-semibold' }, cell.value),
                // Including the badge logic in case you need it for consistency
                cell.status === 'new' && h('span', { class: 'badge badge-success badge-xs' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'Room',
          width: '150px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value || '—'),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: '180px',
          formatter: formatCell,
        })),
      ]

      if (advanceGroupGrid) {
        advanceGroupGrid.updateConfig({ columns, data }).forceRender()
        restoreScrollPosition()
      } else {
        advanceGroupGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'text-center',
            // th: 'bg-base-200 p-2 border-t border-d !border-x-0 text-center',
            // td: 'border-t border-d !border-x-0 p-2 align-middle text-center',
          },
          style: {
            table: {
              'border-collapse': 'collapse',
              'table-layout': 'fixed',
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
    if (!confirm('⚠️ Are you sure you want to delete ALL advance group bookings? This action cannot be undone.')) return

    try {
      const allBookings = await pb.collection('groupAdvanceBooking').getFullList()
      if (allBookings.length === 0) {
        alert('No advance group bookings found to delete.')
        return
      }

      // Save scroll position before deletion
      saveScrollPosition()

      // Batch delete for better performance
      const batchSize = 10
      for (let i = 0; i < allBookings.length; i += batchSize) {
        const batch = allBookings.slice(i, i + batchSize)
        await Promise.all(batch.map((b) => pb.collection('groupAdvanceBooking').delete(b.id)))
      }

      // Invalidate cache
      cache.bookings = null

      alert(`✅ Successfully deleted ${allBookings.length} advance group bookings.`)
      loadAdvanceGroupBookings(true)
    } catch (error) {
      console.error('Error deleting advance group bookings:', error)
      alert('❌ Failed to delete advance group bookings.')
    }
  }

  // Instant refresh (0ms) for rapid scheduling
  const immediateReload = () => {
    cache.bookings = null
    loadAdvanceGroupBookings(true)
  }

  onMount(() => {
    initializeWeek()
    loadAdvanceGroupBookings()
    pb.collection('groupAdvanceBooking').subscribe('*', immediateReload)
  })

  onDestroy(() => {
    advanceGroupGrid?.destroy()
    advanceGroupGrid = null
    pb.collection('groupAdvanceBooking').unsubscribe()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">GRP Schedule Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="relative mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-ghost btn-sm" onclick={deleteAllAdvanceGroupBookings} disabled={isLoading}>
      Delete All
    </button>
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {getWeekRange(currentWeekStart)}
    </h3>

    <div class="flex items-center gap-2 ml-auto">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
      <button class="btn btn-ghost btn-sm" onclick={() => (showGoLiveModal = true)} disabled={isLoading}>
        Go Live
      </button>
    </div>
  </div>

  <div id="advance-group-grid" class="border rounded-lg"></div>
</div>

<GroupAdvanceBookingModal
  bind:show={showAdvanceModal}
  bind:advanceGroupBooking
  onSave={() => {
    saveScrollPosition()
    cache.bookings = null
  }}
/>
<GroupGoLiveModal bind:show={showGoLiveModal} {getWeekRange} {currentWeekStart} />

<style>
  #advance-group-grid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  #advance-group-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: #484b4f; /* dark (Tailwind gray-800) */
    color: #ffffff; /* white text */
  }

  #advance-group-grid :global(th:nth-child(1)),
  #advance-group-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #advance-group-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #advance-group-grid :global(th:nth-child(2)),
  #advance-group-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #advance-group-grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
