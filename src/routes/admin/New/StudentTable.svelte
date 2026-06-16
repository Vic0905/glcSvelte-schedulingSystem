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
  let students = $state([])

  let gridInstance = null
  let profileRowEl
  let unsubSchedule = null
  let debounceTimer = null

  // Static data (loaded once)
  let cachedTimeslots = []
  let cachedStudents = []
  let cachedHolidays = []

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
        h(
          'div',
          { class: 'flex flex-col gap-1 w-full' },
          [
            h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-300 mb-1 pb-1 w-full text-center' }, [
              h('div', {}, item.subject?.name || 'No Subject'),
              h(
                'div',
                { class: 'text-[10px] uppercase mt-1 text-neutral-500 tracking-wide' },
                item.teacher?.name || 'No Teacher'
              ),
            ]),
            item.room &&
              h(
                'div',
                { class: 'flex justify-center' },
                h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, item.room.name)
              ),
          ].filter(Boolean)
        )
      )
    )
  }

  // --- Data Loading ---
  async function loadStaticData() {
    try {
      const [timeslots, holidays] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('holiday').getFullList({ fields: 'id,name,date' }),
      ])
      cachedTimeslots = timeslots
      cachedHolidays = holidays
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedule data')
    }
  }

  async function loadStudentSchedule() {
    if (isLoading) return
    isLoading = true
    try {
      const isAdmin = pb.authStore.model?.role === 'admin'
      const startStr = `${selectedDate} 00:00:00`
      const endStr = `${selectedDate} 23:59:59`

      todayHoliday = cachedHolidays.find((h) => h.date?.split(' ')[0] === selectedDate) ?? null

      // Load students
      let studentFilter = `status != "graduated" && start <= "${endStr}" && end >= "${startStr}"`
      if (!isAdmin) studentFilter += ` && user = "${pb.authStore.model?.id}"`
      cachedStudents = await pb.collection('student').getFullList({ filter: studentFilter })

      // Load schedules
      let scheduleFilter = `start <= "${endStr}" && end >= "${startStr}" && status = "show"`
      if (!isAdmin) scheduleFilter += ` && student.user = "${pb.authStore.model?.id}"`
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

      // Build schedule map: studentId → timeslotId → entries[]
      const scheduleMap = new Map()

      for (const s of schedules) {
        const timeslotId = s.expand?.timeslot?.id
        if (!timeslotId) continue
        const entry = { subject: s.expand?.subject, teacher: s.expand?.teacher, room: s.expand?.room }
        const studentList = Array.isArray(s.expand?.student)
          ? s.expand.student
          : s.expand?.student
            ? [s.expand.student]
            : []

        for (const student of studentList) {
          if (!scheduleMap.has(student.id)) scheduleMap.set(student.id, new Map())
          const slots = scheduleMap.get(student.id)
          if (!slots.has(timeslotId)) slots.set(timeslotId, [])
          slots.get(timeslotId).push(entry)
        }
      }

      // Always show all active students for the date, deduplicated by englishName (latest record wins)
      const latestByName = new Map()
      for (const s of cachedStudents) {
        const key = s.englishName?.toLowerCase()
        if (!key) continue
        if (!latestByName.has(key) || new Date(s.created) > new Date(latestByName.get(key).created)) {
          latestByName.set(key, s)
        }
      }

      students = [...latestByName.values()].sort((a, b) => {
        const aIsNew = a.status === 'new' ? 1 : 0
        const bIsNew = b.status === 'new' ? 1 : 0
        return aIsNew !== bIsNew ? aIsNew - bIsNew : new Date(a.created) - new Date(b.created)
      })

      // --- Grid columns & data ---
      const columns = [
        {
          name: 'Timeslot',
          width: '160px',
          formatter: (cell) =>
            h(
              'div',
              {
                class:
                  'w-full h-full p-2 flex items-center justify-center font-bold text-neutral-700 text-center bg-base-200',
              },
              cell.value
            ),
        },
        ...students.map((student) => ({
          id: student.id,
          width: '160px',
          name: h('div', { class: 'flex items-center justify-center' }, 'Class'),
          formatter: (cell) => formatScheduleCell(cell),
        })),
      ]

      const data = cachedTimeslots.map((ts) => [
        { value: `${ts.start} - ${ts.end}` },
        ...students.map((student) => scheduleMap.get(student.id)?.get(ts.id) || []),
      ])

      await tick()

      if (gridInstance && document.getElementById('student-grid')) {
        gridInstance.updateConfig({ columns, data }).forceRender()
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
        }).render(document.getElementById('student-grid'))

        await tick()
        attachScrollSync()
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load student schedule')
    } finally {
      isLoading = false
    }
  }

  function attachScrollSync() {
    const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
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
    debounceTimer = setTimeout(loadStudentSchedule, 500)
  }

  // --- Navigation ---
  const changeDay = async (days) => {
    if (isLoading) return
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    selectedDate = d.toISOString().split('T')[0]
    await loadStudentSchedule()
  }

  const onDateChange = async (e) => {
    if (isLoading) return
    selectedDate = e.target.value
    await loadStudentSchedule()
  }

  const goToToday = async () => {
    if (isLoading || selectedDate === today()) return
    selectedDate = today()
    await loadStudentSchedule()
  }

  // --- Lifecycle ---
  onMount(async () => {
    await loadStaticData()
    await loadStudentSchedule()
    unsubSchedule = await pb.collection('schedule').subscribe('*', debounceRefresh)
  })

  onDestroy(() => {
    clearTimeout(debounceTimer)
    unsubSchedule?.()
    gridInstance?.destroy()
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100 min-h-screen">
  <!-- HEADER -->
  <div class="mb-3 bg-base-200/60 rounded-xl p-3 shadow-sm">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <!-- PROFILE ROW -->
      <div
        bind:this={profileRowEl}
        class="profile-row flex overflow-x-auto items-stretch border border-base-300 rounded-lg bg-base-100"
      >
        <div
          class="shrink-0 flex items-center justify-center bg-base-200 border-r border-base-300 px-3"
          style="min-width: 140px;"
        >
          <div class="font-bold text-sm text-center">Profile</div>
        </div>
        {#each students as student (student.id)}
          <div
            class="shrink-0 flex flex-col items-start justify-center text-left px-3 py-2 gap-0.5"
            style="min-width: 140px;"
          >
            <div class="font-bold text-xs">{student.name}</div>
            <div class="text-[11px]">{student.englishName || ''}</div>
            <div class="text-[11px]">{student.course || ''}</div>
            <div class="text-[11px]">{student.level || ''}</div>
            <div class="text-[11px] italic">{student.groupName || ''}</div>
            {#if student.status === 'new'}
              <span class="badge badge-success badge-xs mt-1">New</span>
            {:else if student.status === 'extended'}
              <span class="badge badge-secondary badge-xs mt-1">Extended</span>
            {:else if student.status === 'changed'}
              <span class="badge badge-error badge-xs mt-1">Changed</span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- DATE DISPLAY -->
      <h3 class="text-lg md:text-xl font-bold text-center text-neutral-700 flex-1">
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
      </div>
    </div>
  </div>

  <!-- GRID -->
  <div id="student-grid" class="border rounded-xl shadow-sm overflow-hidden"></div>
</div>

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  #student-grid :global(.gridjs-wrapper) {
    max-height: calc(100vh - 220px);
    overflow: auto;
    contain: strict;
  }

  /* Fix padding and alignment */
  #student-grid :global(td) {
    padding: 0 !important;
    vertical-align: middle !important;
  }

  #student-grid :global(.gridjs-table td > div) {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 65px;
  }

  #student-grid :global(th) {
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
  #student-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }
</style>
