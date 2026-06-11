<script>
  import { onDestroy, onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // --- State Runes ---
  let selectedDate = $state(getTodayDate())
  let todayHoliday = $state(null)
  let isLoading = $state(false)
  let gridInstance = $state(null)

  // Cached data
  let cachedTimeslots = $state([])
  let cachedTeachers = $state([])
  let cachedRooms = $state([])
  let cachedHolidays = $state([])
  let teacherRoomMap = $state(new Map())

  // Real-time subscriptions
  let unsubSchedule = null
  let unsubRoomType = null
  let unsubTeacher = null

  // --- Helper Functions ---
  function getTodayDate() {
    return new Date().toISOString().split('T')[0]
  }

  function formatDateDisplay(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  // Function to extract numeric value from room name for sorting (A005 -> 5, A1033 -> 1033)
  function getRoomNumber(roomName) {
    if (!roomName) return Infinity
    const num = parseInt(roomName.replace(/\D/g, ''), 10)
    return isNaN(num) ? Infinity : num
  }

  const changeDay = async (days) => {
    const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    selectedDate = d.toISOString().split('T')[0]

    await loadTeacherSchedule(savedScrollTop, savedScrollLeft)
  }

  const onDateChange = async (e) => {
    const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    selectedDate = e.target.value
    await loadTeacherSchedule(savedScrollTop, savedScrollLeft)
  }

  const goToToday = async () => {
    const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    selectedDate = getTodayDate()
    await loadTeacherSchedule(savedScrollTop, savedScrollLeft)
  }

  // Format cell for teacher view - shows students and room
  const formatCell = (cell) => {
    const bgClass = cell?.bgClass || 'bg-white'

    if (!cell || !cell.schedules || cell.schedules.length === 0) {
      return h(
        'div',
        { class: `w-full h-full min-h-[55px] flex items-center justify-center text-gray-400 ${bgClass}` },
        '—'
      )
    }

    const { schedules } = cell
    const firstSched = schedules[0]
    const subjectName = firstSched.subject?.name || 'No Subject'
    const roomName = firstSched.roomName || 'No Room'
    const allStudents = schedules.flatMap((s) => s.students.map((std) => std.name))

    return h('div', { class: `flex flex-col gap-1 p-2 items-center text-center w-full h-full ${bgClass}` }, [
      h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-300 mb-1 pb-1 w-full' }, [
        h('div', {}, subjectName),
        h('div', { class: 'text-[10px] uppercase mt-1 text-neutral-500' }, roomName),
      ]),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-1' },
        allStudents.map((name) => h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, name))
      ),
    ])
  }

  async function loadStaticData() {
    try {
      const [timeslots, roomTypes, teachers, holidays] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('roomType').getFullList({ sort: 'name', expand: 'teacher', filter: 'roomType = "mtm"' }),
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('holiday').getFullList({ fields: 'id,name,date' }),
      ])

      cachedTimeslots = timeslots
      cachedTeachers = teachers
      cachedRooms = roomTypes
      cachedHolidays = holidays

      // Create map of teacher ID to room name
      teacherRoomMap = new Map(
        roomTypes.filter((rt) => rt.expand?.teacher).map((rt) => [rt.expand.teacher.id, rt.name])
      )
    } catch (err) {
      console.error('Failed to load static data:', err)
      toast.error('Failed to load teacher/room data')
    }
  }

  async function loadTeacherSchedule(savedScrollTop = null, savedScrollLeft = null) {
    if (isLoading) return

    isLoading = true
    try {
      // Check if selected date is a holiday
      const foundHoliday = cachedHolidays.find((h) => h.date?.split(' ')[0] === selectedDate)
      todayHoliday = foundHoliday || null

      const startDateStr = `${selectedDate} 00:00:00`
      const endDateStr = `${selectedDate} 23:59:59`

      // Fetch schedules for the selected day
      let schedules = await pb.collection('schedule').getFullList({
        filter: `start <= "${endDateStr}" && end >= "${startDateStr}"`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      // Filter schedules based on holiday logic (same as DailySchedule)
      if (todayHoliday) {
        schedules = schedules.filter((s) => {
          const recStart = s.start?.split(' ')[0]
          const recEnd = s.end?.split(' ')[0]
          return recStart === selectedDate && recEnd === selectedDate
        })
      }

      // Build schedule map: teacherId-timeslotId -> array of schedules
      const scheduleMap = new Map()
      const bookedTeacherIds = new Set()

      for (const s of schedules) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!teacherId || !timeslotId) continue

        bookedTeacherIds.add(teacherId)
        const key = `${teacherId}-${timeslotId}`

        if (!scheduleMap.has(key)) scheduleMap.set(key, [])
        scheduleMap.get(key).push({
          subject: s.expand?.subject,
          students: s.expand?.student ? [{ id: s.expand.student.id, name: s.expand.student.englishName }] : [],
          roomName: s.expand?.room?.name || null,
        })
      }

      // Filter and sort teachers with the original logic:
      // 1. Teachers with rooms (A001, A002, etc.) come first, sorted by room number
      // 2. Teachers without rooms come after, sorted alphabetically by name
      // 3. Include disabled teachers only if they have bookings
      const teachers = cachedTeachers
        .filter((t) => t.status !== 'disabled' || bookedTeacherIds.has(t.id))
        .sort((a, b) => {
          const aRoom = teacherRoomMap.get(a.id)
          const bRoom = teacherRoomMap.get(b.id)

          // Both have rooms - sort by room number (A001, A002, etc.)
          if (aRoom && bRoom) {
            return getRoomNumber(aRoom) - getRoomNumber(bRoom)
          }

          // One has room, one doesn't - rooms come first
          if (aRoom && !bRoom) return -1
          if (!aRoom && bRoom) return 1

          // Neither has room - sort alphabetically by name
          return a.name.localeCompare(b.name)
        })

      // Build grid data: rows = teachers, columns = teacher name, room, then timeslots
      const data = teachers.map((teacher) => {
        const bgClass = 'bg-white text-neutral-800'

        const row = [
          { value: teacher.name, status: teacher.status, bgClass },
          { value: teacherRoomMap.get(teacher.id) || '—', bgClass },
        ]

        for (const ts of cachedTimeslots) {
          const schedules = scheduleMap.get(`${teacher.id}-${ts.id}`) || []
          row.push({
            label: schedules.length ? 'Schedule' : 'Empty',
            schedules,
            teacher,
            timeslot: ts,
            bgClass,
          })
        }
        return row
      })

      const columns = [
        {
          name: 'Teacher',
          width: '150px',
          formatter: (cell, row) => {
            const hasNewBadge = cell.status === 'new'
            return h(
              'div',
              { class: `w-full h-full p-2 flex items-center justify-center text-center ${row.cells[0].data.bgClass}` },
              [
                h('span', { class: 'font-bold text-neutral-700' }, cell.value),
                hasNewBadge && h('span', { class: 'badge badge-success badge-xs ml-1' }, 'New'),
              ].filter(Boolean)
            )
          },
        },
        {
          name: 'Room',
          width: '120px',
          formatter: (cell, row) =>
            h(
              'div',
              {
                class: `w-full h-full p-2 flex items-center justify-center font-semibold text-center ${row.cells[1].data.bgClass}`,
              },
              cell.value
            ),
        },
        ...cachedTimeslots.map((ts) => ({
          id: ts.id,
          width: '180px',
          name: h('div', { class: 'flex flex-col items-center gap-0.5' }, [h('span', null, `${ts.start} - ${ts.end}`)]),
          formatter: formatCell,
        })),
      ]

      await tick()

      if (gridInstance) {
        if (savedScrollTop === null) {
          const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
          savedScrollTop = wrapper?.scrollTop || 0
          savedScrollLeft = wrapper?.scrollLeft || 0
        }

        gridInstance.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
          if (wrapper) {
            wrapper.scrollTop = savedScrollTop
            wrapper.scrollLeft = savedScrollLeft || 0
          }
        })
      } else {
        gridInstance = new Grid({
          columns,
          data,
          height: 'calc(100vh - 220px)',
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'text-center',
            td: 'text-center',
          },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('teacher-grid'))
      }
    } catch (err) {
      console.error('Failed to load teacher schedule:', err)
      toast.error('Failed to load teacher schedule')
    } finally {
      isLoading = false
    }
  }

  async function refreshWithScroll() {
    const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0
    await loadTeacherSchedule(savedScrollTop, savedScrollLeft)
  }

  async function setupSubscriptions() {
    unsubSchedule = await pb.collection('schedule').subscribe('*', () => {
      refreshWithScroll()
    })

    unsubRoomType = await pb.collection('roomType').subscribe('*', async () => {
      await loadStaticData()
      refreshWithScroll()
    })

    unsubTeacher = await pb.collection('teacher').subscribe('*', async () => {
      await loadStaticData()
      refreshWithScroll()
    })
  }

  onMount(async () => {
    await loadStaticData()
    await loadTeacherSchedule()
    await setupSubscriptions()
  })

  onDestroy(() => {
    unsubSchedule?.()
    unsubRoomType?.()
    unsubTeacher?.()

    if (gridInstance) {
      gridInstance.destroy()
      gridInstance = null
    }
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Teacher Daily View</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 grid grid-cols-3 items-center">
    <!-- Left: holiday badge -->
    <div class="flex items-center">
      {#if todayHoliday}
        <span
          class="flex items-center gap-2 text-yellow-700 border border-yellow-300 bg-yellow-50 rounded-lg px-3 py-1"
        >
          <span class="text-lg">🎉</span>
          <span class="text-sm font-semibold">{todayHoliday.name}</span>
        </span>
      {/if}
    </div>

    <!-- Center: date -->
    <h3 class="text-xl font-semibold text-center">
      {formatDateDisplay(selectedDate)}
    </h3>

    <!-- Right: nav buttons -->
    <div class="flex items-center gap-2 justify-end">
      <button
        class="btn btn-outline btn-sm"
        onclick={goToToday}
        disabled={isLoading || selectedDate === getTodayDate()}
      >
        Today
      </button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(-1)} disabled={isLoading}>&larr;</button>
      <input
        type="date"
        class="input input-bordered input-sm w-auto"
        value={selectedDate}
        onchange={onDateChange}
        disabled={isLoading}
      />
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="teacher-grid" class="border rounded-lg"></div>
</div>

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  #teacher-grid :global(.gridjs-wrapper) {
    max-height: calc(100vh - 220px);
    overflow: auto;
    contain: strict;
  }

  /* Zero out padding on td to let background divs fill full width/height completely */
  #teacher-grid :global(td) {
    padding: 0 !important;
    vertical-align: stretch;
  }

  #teacher-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  /* Sticky first column (Teacher) */
  #teacher-grid :global(th:nth-child(1)),
  #teacher-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #teacher-grid :global(td:nth-child(1)) {
    background-color: white;
  }

  #teacher-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  /* Sticky second column (Room) */
  #teacher-grid :global(th:nth-child(2)),
  #teacher-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 150px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #teacher-grid :global(td:nth-child(2)) {
    background-color: white;
  }

  #teacher-grid :global(th:nth-child(2)) {
    z-index: 25;
  }

  /* Hover effect for cells */
  #teacher-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }
</style>
