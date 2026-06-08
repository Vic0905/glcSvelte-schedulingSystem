<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import CombineModal from './combineModal.svelte'

  // ─────────────────────────────────────────────
  // SECTION 1: Non-reactive module-level state
  // ─────────────────────────────────────────────
  let gridInstance = null
  let refreshTimer = null

  let cachedTimeslots = []
  let cachedRooms = []
  let cachedHolidays = []

  // ─────────────────────────────────────────────
  // SECTION 2: Reactive state (template reads these)
  // ─────────────────────────────────────────────
  let combineModal = $state()
  let selectedDate = $state(getInitialDate())
  let todayHoliday = $state(null)
  let isLoading = $state(false)

  // ─────────────────────────────────────────────
  // SECTION 3: Pure helper functions
  // ─────────────────────────────────────────────

  function getInitialDate() {
    const hash = window.location.hash
    const queryString = hash.includes('?') ? hash.split('?')[1] : ''
    const params = new URLSearchParams(queryString)
    return params.get('date') || getTodayDate()
  }

  function getTodayDate() {
    return new Date().toISOString().split('T')[0]
  }

  function formatDateDisplay(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  function offsetDate(dateStr, days) {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  function saveScroll() {
    const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
    return {
      top: wrapper?.scrollTop || 0,
      left: wrapper?.scrollLeft || 0,
    }
  }

  function restoreScroll(scroll) {
    if (!scroll) return
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scroll.top
        wrapper.scrollLeft = scroll.left
      }
    })
  }

  // ─────────────────────────────────────────────
  // SECTION 4: Grid cell formatters
  // GRP has no room color banding, so no bgClass needed.
  // ─────────────────────────────────────────────

  function formatTeacherCell(value) {
    return h('div', { class: 'w-full h-full p-2 flex items-center justify-center text-center' }, value)
  }

  function formatRoomCell(value) {
    return h('div', { class: 'w-full h-full p-2 flex items-center justify-center font-semibold text-center' }, value)
  }

  function formatScheduleCell(cell) {
    if (!cell?.schedules?.length) {
      return h('div', { class: 'w-full h-full min-h-[55px] flex items-center justify-center text-gray-400' }, '—')
    }

    const { schedules } = cell
    const first = schedules[0]
    const subjectName = first.subject?.name || 'No Subject'
    const teacherName = first.teacher?.name || 'No Teacher'
    const allStudents = schedules.flatMap((s) => s.students.map((std) => std.name))

    return h('div', { class: 'flex flex-col gap-1 p-2 items-center text-center w-full h-full' }, [
      h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-300 mb-1 pb-1 w-full' }, [
        h('div', {}, subjectName),
        h('div', { class: 'text-[10px] uppercase mt-1 text-neutral-500' }, teacherName),
      ]),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-1' },
        allStudents.map((name) => h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, name))
      ),
    ])
  }

  // ─────────────────────────────────────────────
  // SECTION 5: Data transformation
  // ─────────────────────────────────────────────

  function normalizeSchedules(rawSchedules, date, holiday) {
    return rawSchedules
      .filter((s) => {
        if (!holiday) return true
        return s.start?.split(' ')[0] === date && s.end?.split(' ')[0] === date
      })
      .map((s) => ({
        roomId: s.expand?.room?.id,
        timeslotId: s.expand?.timeslot?.id,
        students: s.expand?.student ? [{ id: s.expand.student.id, name: s.expand.student.englishName }] : [],
        subject: s.expand?.subject,
        teacher: s.expand?.teacher,
        start: s.start?.split(' ')[0],
        end: s.end?.split(' ')[0],
      }))
  }

  function buildScheduleMap(normalizedSchedules) {
    const map = new Map()
    for (const s of normalizedSchedules) {
      const key = `${s.roomId}-${s.timeslotId}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    return map
  }

  function buildEmptyCountMap(timeslots, rooms, scheduleMap) {
    const map = new Map()
    for (const ts of timeslots) {
      let count = 0
      for (const room of rooms) {
        if (!(scheduleMap.get(`${room.id}-${ts.id}`) || []).length) count++
      }
      map.set(ts.id, count)
    }
    return map
  }

  // ─────────────────────────────────────────────
  // SECTION 6: Grid config builder
  // ─────────────────────────────────────────────

  function buildGridConfig(rooms, timeslots, scheduleMap, emptyCountMap) {
    const columns = [
      {
        name: 'Teacher',
        width: '120px',
        formatter: (c) => formatTeacherCell(c.value),
      },
      {
        name: 'Room',
        width: '120px',
        formatter: (c) => formatRoomCell(c.value),
      },
      ...timeslots.map((t) => ({
        id: t.id,
        width: '180px',
        name: h('div', { class: 'flex flex-col items-center gap-0.5' }, [
          h('span', null, `${t.start} - ${t.end}`),
          h(
            'span',
            { class: 'text-[10px] font-bold badge badge-success badge-xs' },
            `${emptyCountMap.get(t.id) || 0} Available`
          ),
        ]),
        formatter: formatScheduleCell,
      })),
    ]

    const data = rooms.map((room) => {
      const teacher = room.expand?.teacher

      const row = [
        { value: teacher?.name || '-', disabled: true },
        { value: room.name, disabled: true },
      ]

      for (const ts of timeslots) {
        const schedules = scheduleMap.get(`${room.id}-${ts.id}`) || []
        row.push({
          label: schedules.length ? 'Schedule' : 'Empty',
          schedules,
          room,
          timeslot: ts,
        })
      }

      return row
    })

    return { columns, data }
  }

  // ─────────────────────────────────────────────
  // SECTION 7: Grid renderer
  // cellClick registered ONCE on init, never re-registered.
  // ─────────────────────────────────────────────

  async function renderGrid(columns, data, scroll) {
    await tick()

    if (gridInstance) {
      gridInstance.updateConfig({ columns, data }).forceRender()
      restoreScroll(scroll)
    } else {
      gridInstance = new Grid({
        columns,
        data,
        height: '600px',
        className: {
          table: 'w-full border text-xs !border-collapse',
          th: 'text-center',
          td: 'text-center',
        },
        style: { table: { 'table-layout': 'fixed' } },
      }).render(document.getElementById('daily-grid'))

      gridInstance.on('cellClick', (_e, cell) => {
        const data = cell.data
        if (data.disabled) return

        const isCreate = data.label === 'Empty'
        const firstSched = data.schedules?.[0]

        combineModal.open({
          room: data.room,
          timeslot: data.timeslot,
          teacher: isCreate ? data.room?.expand?.teacher : firstSched?.teacher,
          startDate: isCreate ? selectedDate : firstSched?.start || selectedDate,
          endDate: isCreate ? selectedDate : firstSched?.end || selectedDate,
          mode: isCreate ? 'create' : 'edit',
          schedules: data.schedules,
        })
      })
    }
  }

  // ─────────────────────────────────────────────
  // SECTION 8: Data fetching
  // ─────────────────────────────────────────────

  async function fetchHolidays() {
    if (cachedHolidays.length) return
    cachedHolidays = await pb.collection('holiday').getFullList({ fields: 'id,name,date' })
  }

  async function fetchCoreData(date) {
    const startDateStr = `${date} 00:00:00`
    const endDateStr = `${date} 23:59:59`

    const [timeslots, rooms, schedules] = await Promise.all([
      cachedTimeslots.length
        ? Promise.resolve(cachedTimeslots)
        : pb.collection('timeslot').getFullList({ sort: 'start' }),
      cachedRooms.length
        ? Promise.resolve(cachedRooms)
        : pb.collection('roomType').getFullList({
            sort: 'name',
            expand: 'teacher',
            filter: 'roomType = "grp"', // ← GRP filter
          }),
      pb.collection('schedule').getFullList({
        filter: `start <= "${endDateStr}" && end >= "${startDateStr}"`,
        expand: 'teacher,student,subject,room,timeslot',
      }),
    ])

    if (!cachedTimeslots.length) cachedTimeslots = timeslots
    if (!cachedRooms.length) cachedRooms = rooms

    return { timeslots, rooms, schedules }
  }

  // ─────────────────────────────────────────────
  // SECTION 9: Main load orchestrator
  // ─────────────────────────────────────────────

  async function loadSchedules(scroll = null) {
    if (isLoading) {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => loadSchedules(scroll), 300)
      return
    }

    isLoading = true
    try {
      const { timeslots, rooms, schedules } = await fetchCoreData(selectedDate)

      const holiday = cachedHolidays.find((h) => h.date?.split(' ')[0] === selectedDate) || null
      todayHoliday = holiday

      const normalized = normalizeSchedules(schedules, selectedDate, holiday)
      const scheduleMap = buildScheduleMap(normalized)
      const emptyCountMap = buildEmptyCountMap(timeslots, rooms, scheduleMap)
      const { columns, data } = buildGridConfig(rooms, timeslots, scheduleMap, emptyCountMap)

      await renderGrid(columns, data, scroll)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedules')
    } finally {
      isLoading = false
    }
  }

  // ─────────────────────────────────────────────
  // SECTION 10: User action handlers
  // ─────────────────────────────────────────────

  async function changeDay(days) {
    const scroll = saveScroll()
    selectedDate = offsetDate(selectedDate, days)
    await loadSchedules(scroll)
  }

  async function onDateChange(e) {
    const scroll = saveScroll()
    selectedDate = e.target.value
    await loadSchedules(scroll)
  }

  async function goToToday() {
    const scroll = saveScroll()
    selectedDate = getTodayDate()
    await loadSchedules(scroll)
  }

  async function refreshWithScroll() {
    await loadSchedules(saveScroll())
  }

  // ─────────────────────────────────────────────
  // SECTION 11: Realtime subscription
  // ─────────────────────────────────────────────

  function handleRealtimeEvent(e) {
    const recStart = e.record?.start?.split(' ')[0]
    const recEnd = e.record?.end?.split(' ')[0]
    if (!recStart || !recEnd) return
    if (recStart > selectedDate || recEnd < selectedDate) return

    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => loadSchedules(saveScroll()), 500)
  }

  // ─────────────────────────────────────────────
  // SECTION 12: Lifecycle
  // ─────────────────────────────────────────────

  onMount(() => {
    let unsub = null

    fetchHolidays().catch((err) => console.warn('Failed to load holidays:', err))
    loadSchedules()

    // pb.collection('schedule')
    //   .subscribe('*', handleRealtimeEvent)
    //   .then((fn) => {
    //     unsub = fn
    //   })

    return () => {
      gridInstance?.destroy()
      gridInstance = null
      clearTimeout(refreshTimer)
      // unsub?.()
    }
  })
</script>

<!-- ─────────────────────────────────────────── -->
<!-- TEMPLATE                                    -->
<!-- ─────────────────────────────────────────── -->

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Daily GRP Schedule</h2>
    {#if isLoading}
      <div class="loading loading-spinner loading-sm"></div>
    {/if}
  </div>

  <!-- Date bar -->
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

    <!-- Center: formatted date -->
    <h3 class="text-xl font-semibold text-center">
      {formatDateDisplay(selectedDate)}
    </h3>

    <!-- Right: navigation controls -->
    <div class="flex items-center gap-2 justify-end">
      <button
        class="btn btn-outline btn-sm"
        onclick={goToToday}
        disabled={isLoading || selectedDate === getTodayDate()}
      >
        Today
      </button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(-1)} disabled={isLoading}> &larr; </button>
      <input
        type="date"
        class="input input-bordered input-sm w-auto"
        value={selectedDate}
        onchange={onDateChange}
        disabled={isLoading}
      />
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(1)} disabled={isLoading}> &rarr; </button>
    </div>
  </div>

  <!-- Grid container -->
  <div id="daily-grid" class="border rounded-lg"></div>
</div>

<CombineModal bind:this={combineModal} onrefresh={refreshWithScroll} />

<!-- ─────────────────────────────────────────── -->
<!-- STYLES                                      -->
<!-- ─────────────────────────────────────────── -->

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  #daily-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }

  #daily-grid :global(.gridjs-wrapper) {
    max-height: 650px;
    overflow: auto;
    contain: strict;
  }

  #daily-grid :global(td) {
    padding: 0 !important;
    vertical-align: stretch;
  }

  #daily-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  #daily-grid :global(th:nth-child(1)),
  #daily-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #daily-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #daily-grid :global(th:nth-child(2)),
  #daily-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #daily-grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
