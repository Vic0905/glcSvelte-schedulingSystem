<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let teacherGrid = null
  let isLoading = $state(false)
  let cachedTimeslots = []
  let cachedTeachers = []

  // --- Formatting Helpers ---
  function getCurrentDateDisplay() {
    const today = new Date()
    const day = today.getDay()
    const tuesday = new Date(today)
    tuesday.setDate(today.getDate() + (day === 0 ? 2 : 2 - day))
    const friday = new Date(tuesday)
    friday.setDate(tuesday.getDate() + 3)

    const format = (date, year = true) =>
      date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(year && { year: 'numeric' }) })

    return tuesday.getMonth() === friday.getMonth()
      ? `${format(tuesday, false)} - ${friday.getDate()}, ${friday.getFullYear()}`
      : `${format(tuesday)} - ${format(friday)}`
  }

  // --- Toast Handler ---
  function handleToast(e, label = 'Schedule') {
    const messages = { create: `${label} created`, update: `${label} updated`, delete: `${label} deleted` }
    const types = { create: toast.success, update: toast.info, delete: toast.error }
    if (types[e.action]) types[e.action](messages[e.action])
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')
    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) =>
        h('div', { class: 'flex flex-col gap-1 p-1 items-center text-center' }, [
          h(
            'div',
            { class: 'font-bold text-neutral-700 border-b border-base-500 mb-1 pb-1 w-full' },
            item.subject?.name ?? 'No Subject'
          ),
          h(
            'span',
            { class: 'badge badge-ghost badge-xs' },
            item.isGroup ? 'Group Class' : item.student?.englishName || 'Unknown'
          ),
          h('span', { class: 'badge badge-ghost badge-xs' }, item.room?.name ?? 'No Room'),
        ])
      )
    )
  }

  // --- Core Data Loader ---
  async function loadAdvanceSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslots, allTeachers, individualBookings, groupBookings, roomList, groupRoomList] = await Promise.all([
        cachedTimeslots.length ? cachedTimeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        cachedTeachers.length ? cachedTeachers : pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('advanceBooking').getFullList({
          expand: 'teacher,student,subject,room,timeslot',
          // Filter out graduated students at the database level if possible,
          // or handle via expand filters
        }),
        pb.collection('groupAdvanceBooking').getFullList({
          expand: 'teacher,subject,grouproom,timeslot',
        }),
        pb.collection('room').getFullList({ expand: 'teacher' }),
        pb.collection('grouproom').getFullList({ expand: 'teacher' }),
      ])

      cachedTimeslots = timeslots
      cachedTeachers = allTeachers

      // Map Room Assignments
      const teacherAssignmentMap = {}
      roomList.forEach((r) => {
        if (r.teacher) teacherAssignmentMap[r.teacher] = { type: 'room', name: r.name }
      })
      groupRoomList.forEach((gr) => {
        if (gr.teacher && !teacherAssignmentMap[gr.teacher])
          teacherAssignmentMap[gr.teacher] = { type: 'grouproom', name: gr.name }
      })

      // Identify active teachers (not disabled OR has bookings)
      const bookedIds = new Set([
        ...individualBookings.map((b) => b.expand?.teacher?.id),
        ...groupBookings.map((b) => b.expand?.teacher?.id),
      ])

      const filteredTeachers = allTeachers
        .filter((t) => t.status !== 'disabled' || bookedIds.has(t.id))
        .sort((a, b) => {
          const aAssign = teacherAssignmentMap[a.id],
            bAssign = teacherAssignmentMap[b.id]
          const getWeight = (as) => (!as ? 3 : as.type === 'room' ? 1 : 2)
          if (getWeight(aAssign) !== getWeight(bAssign)) return getWeight(aAssign) - getWeight(bAssign)
          return (aAssign?.name || a.name).localeCompare(bAssign?.name || b.name)
        })

      // Build Schedule Map
      const scheduleMap = {}
      const process = (b, isGroup) => {
        const tId = b.expand?.teacher?.id,
          tsId = b.expand?.timeslot?.id
        if (!tId || !tsId) return
        // Advanced Logic: Filter graduated students who HAVE NO bookings
        if (!isGroup && b.expand?.student?.status === 'graduated') {
          // PocketBase won't return them if we filter correctly, but as a fallback:
          if (!bookedIds.has(tId)) return
        }

        scheduleMap[tId] ??= {}
        scheduleMap[tId][tsId] ??= []
        scheduleMap[tId][tsId].push({
          subject: b.expand?.subject,
          student: b.expand?.student,
          room: isGroup ? b.expand?.grouproom : b.expand?.room,
          isGroup,
        })
      }

      individualBookings.forEach((b) => process(b, false))
      groupBookings.forEach((b) => process(b, true))

      const data = filteredTeachers.map((t) => [
        { rawName: t.name, status: t.status },
        { room: teacherAssignmentMap[t.id]?.name || '—' },
        ...timeslots.map((ts) => scheduleMap[t.id]?.[ts.id] || []),
      ])

      const columns = [
        {
          name: 'Teacher',
          width: '150px',
          formatter: (cell) => h('div', { class: 'font-bold text-center' }, cell.rawName),
        },
        { name: 'Room', width: '120px', formatter: (cell) => h('div', { class: 'text-center font-bold' }, cell.room) },
        ...timeslots.map((ts) => ({ name: `${ts.start} - ${ts.end}`, width: '180px', formatter: formatCell })),
      ]

      renderGrid(data, columns)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load Advance Template')
    } finally {
      isLoading = false
    }
  }

  function renderGrid(data, columns) {
    if (teacherGrid) {
      const wrapper = document.querySelector('#teacherGrid .gridjs-wrapper')
      const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }
      teacherGrid.updateConfig({ data, columns }).forceRender()
      requestAnimationFrame(() => {
        const w = document.querySelector('#teacherGrid .gridjs-wrapper')
        if (w) {
          w.scrollTop = scroll.top
          w.scrollLeft = scroll.left
        }
      })
    } else {
      teacherGrid = new Grid({
        columns,
        data,
        className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
      }).render(document.getElementById('teacherGrid'))
    }
  }

  onMount(() => {
    loadAdvanceSchedule()
    // const subs = [
    //   pb.collection('advanceBooking').subscribe('*', () => loadAdvanceSchedule()),
    //   pb.collection('groupAdvanceBooking').subscribe('*', () => loadAdvanceSchedule()),
    // ]

    const sub1 = pb.collection('advanceBooking').subscribe('*', (e) => {
      handleToast(e, 'Individual Booking')
      loadAdvanceSchedule()
    })

    const sub2 = pb.collection('groupAdvanceBooking').subscribe('*', (e) => {
      handleToast(e, 'Group Booking')
      loadAdvanceSchedule()
    })
    return () => {
      // subs.forEach((s) => s.then((u) => u()))
      sub1.then((u) => u())
      sub2.then((u) => u())
      teacherGrid?.destroy()
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="mb-4 text-2xl font-bold">
    <h2 class="text-center">Teacher View Table (Advance Template)</h2>
  </div>

  <div class="mb-6">
    <h3 class="text-xl font-semibold text-center">{getCurrentDateDisplay()}</h3>
  </div>

  <div id="teacherGrid" class="border rounded-lg"></div>
</div>

<style>
  #teacherGrid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }
  #teacherGrid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    background-color: #484b4f;
    color: white;
    box-shadow: inset -1px 0 0 #ddd;
  }
  #teacherGrid :global(td:nth-child(1)),
  #teacherGrid :global(th:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    background: white;
    width: 150px;
  }
  #teacherGrid :global(td:nth-child(2)),
  #teacherGrid :global(th:nth-child(2)) {
    position: sticky;
    left: 150px;
    z-index: 15;
    background: white;
    width: 120px;
  }
  #teacherGrid :global(th:nth-child(1)),
  #teacherGrid :global(th:nth-child(2)) {
    z-index: 25;
    background-color: #484b4f;
  }
</style>
