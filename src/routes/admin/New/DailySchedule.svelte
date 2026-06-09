<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import CombineModal from './combineModal.svelte'
  import CopyModal from './copyModal.svelte'

  // ─────────────────────────────────────────────
  // SECTION 1: Non-reactive module-level state
  // Only gridjs controls rendering, not Svelte reactivity,
  // so these do NOT need $state.
  // ─────────────────────────────────────────────
  let gridInstance = null
  let refreshTimer = null

  // Caches — fetched once, never re-fetched unless explicitly cleared
  let cachedTimeslots = []
  let cachedRooms = []
  let cachedHolidays = []

  // ─────────────────────────────────────────────
  // SECTION 2: Reactive state (template reads these)
  // ─────────────────────────────────────────────
  let combineModal = $state()
  let copyModal = $state()
  let selectedDate = $state(getInitialDate())
  let todayHoliday = $state(null)
  let isLoading = $state(false)

  // ─────────────────────────────────────────────
  // SECTION 3: Pure helper functions
  // No side effects, no external dependencies.
  // Easy to unit test in isolation.
  // ─────────────────────────────────────────────

  /** Reads ?date= from the hash query string, falls back to today */
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

  /**
   * Returns a Tailwind bg+text class pair based on room name.
   * G rooms → always white. A rooms → alternating gray bands.
   */
  function getBgClass(roomName) {
    if (!roomName) return ''
    const upper = roomName.toUpperCase()

    if (upper.startsWith('G')) return 'bg-white text-neutral-800'

    const num = parseInt(upper.replace(/\D/g, ''), 10)
    if (isNaN(num)) return ''

    // Gray bands represent rooms on the same floor/wing as their teacher.
    // Update these ranges when room assignments change.
    const GRAY_ROOM_RANGES = [
      [1, 5],
      [19, 33],
      [50, 64],
      [74, 83],
      [93, 101],
      [110, 125],
      [142, 157],
    ]

    const isGray = GRAY_ROOM_RANGES.some(([min, max]) => num >= min && num <= max)

    return isGray ? 'bg-neutral-200/90 text-neutral-800' : 'bg-white text-neutral-800'
  }

  /** Saves the current scroll position of the grid wrapper */
  function saveScroll() {
    const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
    return {
      top: wrapper?.scrollTop || 0,
      left: wrapper?.scrollLeft || 0,
    }
  }

  /** Restores scroll position on the next animation frame */
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
  // Kept separate so formatCell doesn't bloat buildGridConfig.
  // ─────────────────────────────────────────────

  function formatTeacherCell(value, bgClass) {
    return h('div', { class: `w-full h-full p-2 flex items-center justify-center text-center ${bgClass}` }, value)
  }

  function formatRoomCell(value, bgClass) {
    return h(
      'div',
      { class: `w-full h-full p-2 flex items-center justify-center font-semibold text-center ${bgClass}` },
      value
    )
  }

  function formatScheduleCell(cell) {
    const bgClass = cell?.bgClass || ''

    if (!cell?.schedules?.length) {
      return h(
        'div',
        { class: `w-full h-full min-h-[55px] flex items-center justify-center text-gray-400 ${bgClass}` },
        '—'
      )
    }

    const { schedules } = cell
    const first = schedules[0]
    const subjectName = first.subject?.name || 'No Subject'
    const teacherName = first.teacher?.name || 'No Teacher'
    const allStudents = schedules.flatMap((s) => s.students.map((std) => std.name))

    return h('div', { class: `flex flex-col gap-1 p-2 items-center text-center w-full h-full ${bgClass}` }, [
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
  // Pure functions: input → output, no side effects.
  // ─────────────────────────────────────────────

  /**
   * Normalizes raw PocketBase schedule records into a flat shape,
   * optionally filtering to single-day records on holidays.
   */
  function normalizeSchedules(rawSchedules, date, holiday) {
    return rawSchedules
      .filter((s) => {
        if (!holiday) return true
        // On holidays, only show schedules that are exactly this one day
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

  /**
   * Groups normalized schedules into a Map keyed by "roomId-timeslotId"
   * for O(1) lookup when building grid rows.
   */
  function buildScheduleMap(normalizedSchedules) {
    const map = new Map()
    for (const s of normalizedSchedules) {
      const key = `${s.roomId}-${s.timeslotId}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    return map
  }

  /**
   * Counts empty rooms per timeslot for the "N Available" header badge.
   */
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
  // Constructs the columns + data arrays that gridjs needs.
  // Separated from rendering so it can be called without touching the DOM.
  // ─────────────────────────────────────────────

  function buildGridConfig(rooms, timeslots, scheduleMap, emptyCountMap) {
    const columns = [
      {
        name: 'Teacher',
        width: '120px',
        formatter: (c, row) => formatTeacherCell(c.value, row.cells[0].data.bgClass),
      },
      {
        name: 'Room',
        width: '120px',
        formatter: (c, row) => formatRoomCell(c.value, row.cells[1].data.bgClass),
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
      const bgClass = getBgClass(room.name)
      const teacher = room.expand?.teacher

      const row = [
        { value: teacher?.name || '-', disabled: true, bgClass },
        { value: room.name, disabled: true, bgClass },
      ]

      for (const ts of timeslots) {
        const schedules = scheduleMap.get(`${room.id}-${ts.id}`) || []
        row.push({
          label: schedules.length ? 'Schedule' : 'Empty',
          schedules,
          room,
          timeslot: ts,
          bgClass,
        })
      }

      return row
    })

    return { columns, data }
  }

  // ─────────────────────────────────────────────
  // SECTION 7: Grid renderer
  // Handles first-time init vs subsequent updates.
  // cellClick is registered once on init and never re-registered.
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

      // cellClick registered ONCE here — never re-registered on updates
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
  // All PocketBase calls in one place.
  // Uses caches for timeslots, rooms, and holidays.
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
            filter: 'roomType = "mtm"',
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
  // Ties fetching → transforming → rendering together.
  // All other actions call this.
  // ─────────────────────────────────────────────

  async function loadSchedules(scroll = null) {
    // If already loading, debounce instead of silently dropping
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
  // All thin wrappers — they just update selectedDate
  // and delegate to loadSchedules.
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
  // Debounced so rapid back-to-back saves = 1 reload.
  // Only triggers if the changed record overlaps the viewed date.
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
    let unsub = null // holds the unsubscribe fn once resolved

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
      // unsub?.() // now synchronously calls it if resolved, safely skips if not
    }
  })
</script>

<!-- ─────────────────────────────────────────── -->
<!-- TEMPLATE                                    -->
<!-- ─────────────────────────────────────────── -->

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Daily MTM Schedule</h2>
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
      <button class="btn btn-outline btn-sm" onclick={() => copyModal.open()} disabled={isLoading}>
        Copy Schedule
      </button>
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

  <!-- Grid container — gridjs renders into this div -->
  <div id="daily-grid" class="border rounded-lg"></div>
</div>

<CombineModal bind:this={combineModal} onrefresh={refreshWithScroll} />
<CopyModal bind:this={copyModal} sourceDate={selectedDate} onrefresh={refreshWithScroll} />

<!-- ─────────────────────────────────────────── -->
<!-- STYLES                                      -->
<!-- ─────────────────────────────────────────── -->

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  /* Hover highlight on schedule cells */
  #daily-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }

  /* Scrollable grid wrapper */
  #daily-grid :global(.gridjs-wrapper) {
    max-height: 650px;
    overflow: auto;
    contain: strict;
  }

  /* Let cell background divs fill the full td area */
  #daily-grid :global(td) {
    padding: 0 !important;
    vertical-align: stretch;
  }

  /* Sticky header row */
  #daily-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  /* Sticky "Teacher" column */
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

  /* Sticky "Room" column */
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
