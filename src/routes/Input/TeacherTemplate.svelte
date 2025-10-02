<script>
  import { onMount, onDestroy } from 'svelte'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'

  // Initialize to current Monday
  const getMonday = (date = new Date()) => {
    const d = new Date(date)
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    return d.toISOString().split('T')[0]
  }

  let currentWeekStart = $state(getMonday())
  let timeslots = []
  let teacherGrid = null

  const getWeekRange = () => {
    const monday = new Date(currentWeekStart)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)

    const opts = { month: 'long', day: 'numeric' }
    if (monday.getMonth() !== friday.getMonth()) opts.year = 'numeric'

    return monday.getMonth() === friday.getMonth()
      ? `${monday.toLocaleDateString('en-US', opts)} - ${friday.getDate()}, ${friday.getFullYear()}`
      : `${monday.toLocaleDateString('en-US', opts)} - ${friday.toLocaleDateString('en-US', opts)}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(currentWeekStart)
    d.setDate(d.getDate() + weeks * 7)
    currentWeekStart = d.toISOString().split('T')[0]
    loadTeacherSchedule()
  }

  const badge = (text, color) => h('span', { class: `badge ${color} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    // Handle multiple bookings in same timeslot
    if (Array.isArray(cell)) {
      return h(
        'div',
        { class: 'flex flex-col gap-2 text-xs' },
        cell.map((booking) =>
          h(
            'div',
            { class: 'flex flex-col gap-1 items-center p-1 border-b last:border-b-0' },
            [
              badge(booking.subject?.name || '', 'badge-primary'),
              booking.isGroup && badge('Group', 'badge-secondary'),
              booking.isGroup
                ? badge('Multiple Students', 'badge-neutral')
                : badge(booking.student?.englishName || '', 'badge-neutral'),
              badge(booking.room?.name || '', 'badge-error'),
            ].filter(Boolean)
          )
        )
      )
    }

    // Single booking
    return h(
      'div',
      { class: 'flex flex-col gap-1 items-center text-xs' },
      [
        badge(cell.subject?.name || '', 'badge-primary'),
        cell.isGroup && badge('Group', 'badge-secondary'),
        cell.isGroup
          ? badge('Multiple Students', 'badge-neutral')
          : badge(cell.student?.englishName || '', 'badge-neutral'),
        badge(cell.room?.name || '', 'badge-error'),
      ].filter(Boolean)
    )
  }

  const buildColumns = () => [
    { name: 'Teacher', formatter: (cell) => h('div', { class: 'text-xs font-medium' }, cell) },
    ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, formatter: formatCell })),
  ]

  async function loadTeacherSchedule() {
    try {
      // Fetch timeslots only once
      if (!timeslots.length) {
        timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
      }

      // Parallel fetch (now including groupAdvanceBooking)
      const [teachers, individualBookings, groupBookings] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('advanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('groupAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      // Build lookup map for O(1) access
      const teacherMap = {}
      teachers.forEach((t) => {
        teacherMap[t.id] = {
          name: t.name,
          slots: {},
        }
      })

      // Process individual bookings
      individualBookings.items.forEach((b) => {
        const tid = b.expand?.teacher?.id
        const slotId = b.expand?.timeslot?.id
        if (tid && slotId && teacherMap[tid]) {
          if (!teacherMap[tid].slots[slotId]) {
            teacherMap[tid].slots[slotId] = []
          }
          teacherMap[tid].slots[slotId].push({
            subject: b.expand.subject,
            student: b.expand.student,
            room: b.expand.room,
            isGroup: false,
          })
        }
      })

      // Process group bookings
      groupBookings.items.forEach((b) => {
        const tid = b.expand?.teacher?.id
        const slotId = b.expand?.timeslot?.id
        if (tid && slotId && teacherMap[tid]) {
          if (!teacherMap[tid].slots[slotId]) {
            teacherMap[tid].slots[slotId] = []
          }
          teacherMap[tid].slots[slotId].push({
            subject: b.expand.subject,
            student: null, // Group classes don't show individual student names
            room: b.expand.grouproom, // Note: grouproom not room
            isGroup: true,
          })
        }
      })

      // Build table data
      const data = Object.values(teacherMap)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((t) => [
          t.name,
          ...timeslots.map((slot) => {
            const bookings = t.slots[slot.id]
            if (!bookings || bookings.length === 0) return { label: 'Empty' }
            return bookings.length === 1 ? bookings[0] : bookings
          }),
        ])

      // Render grid
      const config = {
        columns: buildColumns(),
        data,
        search: false,
        sort: false,
        pagination: false,
        className: {
          table: 'w-full border text-sm',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 whitespace-nowrap align-middle text-center',
        },
      }

      if (teacherGrid) {
        requestAnimationFrame(() => teacherGrid.updateConfig({ data }).forceRender())
      } else {
        teacherGrid = new Grid(config).render(document.getElementById('teacherGrid'))
      }
    } catch (error) {
      console.error('Error loading schedule:', error)
    }
  }

  let unsubAdvance, unsubGroup

  onMount(async () => {
    await loadTeacherSchedule()
    unsubAdvance = await pb.collection('advanceBooking').subscribe('*', loadTeacherSchedule)
    unsubGroup = await pb.collection('groupAdvanceBooking').subscribe('*', loadTeacherSchedule)
  })

  onDestroy(() => {
    teacherGrid?.destroy()
    unsubAdvance?.() // removes only THIS subscription
    unsubGroup?.()
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold text-primary">Teacher</h2>
    <h2 class="text-2xl font-bold text-primary text-center flex-1">Advance Schedule (Weekly Template)</h2>
  </div>

  <div class="mb-6 flex items-center justify-between gap-4">
    <h3 class="text-xl font-semibold text-primary flex-1 text-center">{getWeekRange()}</h3>
    <div class="flex gap-2">
      <button class="btn btn-outline btn-sm" on:click={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" on:click={() => changeWeek(1)}>&rarr;</button>
    </div>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4 flex gap-4 text-xs">
    <div class="flex items-center gap-1">
      <div class="badge badge-primary badge-xs"></div>
      <span>Subject</span>
    </div>
    <div class="flex items-center gap-1">
      <div class="badge badge-secondary badge-xs"></div>
      <span>Group Class</span>
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

  <div id="teacherGrid" class="max-h-[700px] overflow-auto border rounded-lg"></div>
</div>
