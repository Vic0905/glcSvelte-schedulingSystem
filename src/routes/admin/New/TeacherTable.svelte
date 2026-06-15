<script>
  import { onDestroy, onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // --- State ---
  let selectedDate = $state(new Date().toISOString().split('T')[0])
  let todayHoliday = $state(null)
  let isLoading = $state(false)
  let teachers = $state([])

  let gridInstance = null
  let profileRowEl
  let unsubSchedule = null
  let unsubRoomType = null
  let unsubTeacher = null
  let debounceTimer = null

  // Static data (loaded once)
  let cachedTimeslots = []
  let cachedTeachers = []
  let cachedHolidays = []
  let cachedRoomTypes = []
  let teacherRoomMap = new Map()

  // --- Helpers ---
  const today = () => new Date().toISOString().split('T')[0]

  function formatDateDisplay(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  function getRoomNumber(roomName) {
    if (!roomName) return Infinity
    const num = parseInt(roomName.replace(/\D/g, ''), 10)
    return isNaN(num) ? Infinity : num
  }

  function formatScheduleCell(items) {
    if (!items?.length) {
      return h(
        'div',
        { class: 'w-full h-full min-h-[55px] flex items-center justify-center text-gray-300 text-lg' },
        '—'
      )
    }
    return h(
      'div',
      { class: 'flex flex-col gap-1 p-2 items-center justify-center text-center w-full h-full' },
      items.map((item) =>
        h('div', { class: 'flex flex-col gap-1 w-full' }, [
          h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-300 mb-1 pb-1 w-full text-center' }, [
            h('div', {}, item.subject?.name || 'No Subject'),
            h('div', { class: 'text-[10px] uppercase mt-1  tracking-wide' }, item.room?.name || 'No Room'),
          ]),
          h(
            'div',
            { class: 'flex flex-wrap justify-center gap-1' },
            (item.students || []).map((s) =>
              h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, s.name)
            )
          ),
        ])
      )
    )
  }

  // --- Data Loading ---
  async function loadStaticData() {
    try {
      const [timeslots, roomTypes, allTeachers, holidays] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('roomType').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status,user' }),
        pb.collection('holiday').getFullList({ fields: 'id,name,date' }),
      ])
      cachedTimeslots = timeslots
      cachedRoomTypes = roomTypes
      cachedTeachers = allTeachers
      cachedHolidays = holidays
      teacherRoomMap = new Map(
        roomTypes.filter((rt) => rt.expand?.teacher).map((rt) => [rt.expand.teacher.id, rt.name])
      )
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedule data')
    }
  }

  async function loadTeacherSchedule() {
    if (isLoading) return
    isLoading = true
    try {
      const isAdmin = pb.authStore.model?.role === 'admin'
      const startStr = `${selectedDate} 00:00:00`
      const endStr = `${selectedDate} 23:59:59`

      todayHoliday = cachedHolidays.find((h) => h.date?.split(' ')[0] === selectedDate) ?? null

      // Determine visible teachers
      let visibleTeachers
      if (isAdmin) {
        visibleTeachers = cachedTeachers.filter((t) => t.status !== 'disabled')
      } else {
        visibleTeachers = cachedTeachers.filter((t) => t.user === pb.authStore.model?.id)
      }

      // Load schedules
      let scheduleFilter = `start <= "${endStr}" && end >= "${startStr}"`
      if (!isAdmin) scheduleFilter += ` && teacher.user = "${pb.authStore.model?.id}"`

      let schedules = await pb.collection('schedule').getFullList({
        filter: scheduleFilter,
        expand: 'teacher,student,subject,room,timeslot',
      })

      // On holidays, only show same-day records
      if (todayHoliday) {
        schedules = schedules.filter(
          (s) => s.start?.split(' ')[0] === selectedDate && s.end?.split(' ')[0] === selectedDate
        )
      }

      // Build schedule map: teacherId → timeslotId → entries[]
      const scheduleMap = new Map()
      const bookedTeacherIds = new Set()

      for (const s of schedules) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!teacherId || !timeslotId) continue

        bookedTeacherIds.add(teacherId)
        if (!scheduleMap.has(teacherId)) scheduleMap.set(teacherId, new Map())
        const slots = scheduleMap.get(teacherId)
        if (!slots.has(timeslotId)) slots.set(timeslotId, [])
        slots.get(timeslotId).push({
          subject: s.expand?.subject,
          room: s.expand?.room,
          students: s.expand?.student ? [{ id: s.expand.student.id, name: s.expand.student.englishName }] : [],
        })
      }

      // For admin: also include disabled teachers that have bookings today
      if (isAdmin) {
        const disabledWithBookings = cachedTeachers.filter((t) => t.status === 'disabled' && bookedTeacherIds.has(t.id))
        visibleTeachers = [...visibleTeachers, ...disabledWithBookings]
      }

      // Sort: teachers with rooms first (by room number), then rest alphabetically
      teachers = visibleTeachers.sort((a, b) => {
        const aRoom = teacherRoomMap.get(a.id)
        const bRoom = teacherRoomMap.get(b.id)
        if (aRoom && bRoom) return getRoomNumber(aRoom) - getRoomNumber(bRoom)
        if (aRoom && !bRoom) return -1
        if (!aRoom && bRoom) return 1
        return a.name.localeCompare(b.name)
      })

      // --- Grid: timeslots as rows, teachers as columns ---
      const columns = [
        {
          name: 'Timeslot',
          width: '160px',
          formatter: (cell) =>
            h(
              'div',
              {
                class: 'w-full h-full p-2 flex items-center justify-center ',
              },
              cell.value
            ),
        },
        ...teachers.map((teacher) => ({
          id: teacher.id,
          width: '180px',
          name: h('div', { class: 'flex items-center justify-center' }, 'Class'),
          formatter: (cell) => formatScheduleCell(cell),
        })),
      ]

      const data = cachedTimeslots.map((ts) => [
        { value: `${ts.start} - ${ts.end}` },
        ...teachers.map((teacher) => scheduleMap.get(teacher.id)?.get(ts.id) || []),
      ])

      await tick()

      if (gridInstance && document.getElementById('teacher-grid')) {
        const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
        const savedScrollTop = wrapper?.scrollTop || 0
        const savedScrollLeft = wrapper?.scrollLeft || 0

        gridInstance.updateConfig({ columns, data }).forceRender()

        await tick()
        attachScrollSync()

        requestAnimationFrame(() => {
          const w = document.querySelector('#teacher-grid .gridjs-wrapper')
          if (w) {
            w.scrollTop = savedScrollTop
            w.scrollLeft = savedScrollLeft
          }
        })
      } else {
        gridInstance = new Grid({
          columns,
          data,
          height: 'calc(100vh - 220px)',
          search: false,
          sort: false,
          pagination: false,
          className: { table: 'w-full border text-xs !border-collapse', th: 'text-center', td: 'text-center' },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('teacher-grid'))

        await tick()
        attachScrollSync()
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load teacher schedule')
    } finally {
      isLoading = false
    }
  }

  function attachScrollSync() {
    const wrapper = document.querySelector('#teacher-grid .gridjs-wrapper')
    if (!wrapper || !profileRowEl) return
    let syncing = false
    wrapper.addEventListener('scroll', () => {
      if (syncing) return
      syncing = true
      profileRowEl.scrollLeft = wrapper.scrollLeft
      syncing = false
    })
    profileRowEl.addEventListener('scroll', () => {
      if (syncing) return
      syncing = true
      wrapper.scrollLeft = profileRowEl.scrollLeft
      syncing = false
    })
  }

  function debounceRefresh() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(loadTeacherSchedule, 500)
  }

  // --- Navigation ---
  const changeDay = async (days) => {
    if (isLoading) return
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    selectedDate = d.toISOString().split('T')[0]
    await loadTeacherSchedule()
  }

  const onDateChange = async (e) => {
    if (isLoading) return
    selectedDate = e.target.value
    await loadTeacherSchedule()
  }

  const goToToday = async () => {
    if (isLoading || selectedDate === today()) return
    selectedDate = today()
    await loadTeacherSchedule()
  }

  // --- Lifecycle ---
  onMount(async () => {
    await loadStaticData()
    await loadTeacherSchedule()
    unsubSchedule = await pb.collection('schedule').subscribe('*', debounceRefresh)
    unsubRoomType = await pb.collection('roomType').subscribe('*', async () => {
      await loadStaticData()
      debounceRefresh()
    })
    unsubTeacher = await pb.collection('teacher').subscribe('*', async () => {
      await loadStaticData()
      debounceRefresh()
    })
  })

  onDestroy(() => {
    clearTimeout(debounceTimer)
    unsubSchedule?.()
    unsubRoomType?.()
    unsubTeacher?.()
    gridInstance?.destroy()
    gridInstance = null
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100 min-h-screen">
  <!-- HEADER -->
  <div class="mb-3 bg-base-200/60 rounded-xl p-3 shadow-sm">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <!-- PROFILE ROW (scroll-synced with grid) -->
      <div
        bind:this={profileRowEl}
        class="profile-row flex overflow-x-auto items-stretch border border-base-300 rounded-lg bg-base-100"
      >
        <!-- Fixed label cell -->
        <div
          class="shrink-0 flex items-center justify-center bg-base-200 border-r border-base-300 px-3"
          style="min-width: 140px;"
        >
          <div class="font-bold text-sm text-center">Profile</div>
        </div>
        <!-- One card per teacher -->
        {#each teachers as teacher (teacher.id)}
          <div
            class="shrink-0 flex flex-col items-start justify-center text-left px-3 py-2 gap-0.5"
            style="min-width: 160px;"
          >
            <div class="font-bold text-xs">{teacher.name}</div>
            <div class="font-bold text-xs">
              Room: {teacherRoomMap.get(teacher.id) || 'Not assigned'}
            </div>
            {#if teacher.status === 'disabled'}
              <span class="badge badge-error badge-xs mt-1">Disabled</span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- DATE DISPLAY -->
      <h3 class="text-lg md:text-xl font-bold text-center flex-1">
        {formatDateDisplay(selectedDate)}
      </h3>

      <!-- CONTROLS -->
      <div class="flex items-center gap-2 justify-end flex-wrap">
        <button
          class="btn btn-sm btn-primary btn-outline rounded-full px-4"
          onclick={goToToday}
          disabled={isLoading || selectedDate === today()}
        >
          Today
        </button>
        {#if todayHoliday}
          <span
            class="flex items-center gap-2 text-yellow-800 border border-yellow-300 bg-yellow-50 rounded-full px-3 py-1 shadow-sm"
          >
            <span>🎉</span>
            <span class="text-xs font-semibold">{todayHoliday.name}</span>
          </span>
        {/if}
        <div class="join">
          <button
            class="join-item btn btn-sm btn-ghost border border-base-300"
            onclick={() => changeDay(-1)}
            disabled={isLoading}>&larr;</button
          >
          <input
            type="date"
            class="join-item input input-bordered input-sm w-auto"
            value={selectedDate}
            onchange={onDateChange}
            disabled={isLoading}
          />
          <button
            class="join-item btn btn-sm btn-ghost border border-base-300"
            onclick={() => changeDay(1)}
            disabled={isLoading}>&rarr;</button
          >
        </div>
        {#if isLoading}
          <div class="loading loading-spinner loading-sm"></div>
        {/if}
      </div>
    </div>
  </div>

  <!-- GRID -->
  <div id="teacher-grid" class="border rounded-xl shadow-sm overflow-hidden"></div>
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

  #teacher-grid :global(td) {
    padding: 0 !important;
    vertical-align: middle !important;
  }

  #teacher-grid :global(.gridjs-table td > div) {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 65px;
  }

  #teacher-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
    text-align: center;
    vertical-align: middle;
  }

  /* Hover effect for cells */
  #teacher-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }

  .profile-row {
    scrollbar-width: none;
  }
  .profile-row::-webkit-scrollbar {
    display: none;
  }
</style>
