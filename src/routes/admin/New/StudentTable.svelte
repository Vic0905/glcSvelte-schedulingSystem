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
  let students = $state([])

  // Cached data (load once)
  let cachedTimeslots = $state([])
  let cachedStudents = $state([])
  let cachedHolidays = $state([])
  let isStaticDataLoaded = $state(false)

  // Real-time subscriptions
  let unsubSchedule = null
  let refreshTimeout = null

  // Debounce helper
  let navigationInProgress = false

  let profileRowEl
  let syncingScroll = false

  const TIMESLOT_COL_WIDTH = 160
  const STUDENT_COL_WIDTH = 160

  // --- Helper Functions ---
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

  // Get avatar URL
  function getStudentAvatarUrl(student) {
    if (!student._userData?.avatar) return null
    return pb.files.getURL(student._userData, student._userData.avatar)
  }

  // Get student initials for avatar fallback
  function getStudentInitials(student) {
    if (student.englishName) return student.englishName.slice(0, 2).toUpperCase()
    if (student.name) return student.name.slice(0, 2).toUpperCase()
    return 'ST'
  }

  const changeDay = async (days) => {
    if (isLoading || navigationInProgress) return

    navigationInProgress = true

    const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    selectedDate = d.toISOString().split('T')[0]

    await loadStudentSchedule(savedScrollTop, savedScrollLeft)
    navigationInProgress = false
  }

  const onDateChange = async (e) => {
    if (isLoading || navigationInProgress) return

    navigationInProgress = true

    const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    selectedDate = e.target.value
    await loadStudentSchedule(savedScrollTop, savedScrollLeft)
    navigationInProgress = false
  }

  const goToToday = async () => {
    if (isLoading || navigationInProgress || selectedDate === getTodayDate()) return

    navigationInProgress = true

    const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    selectedDate = getTodayDate()
    await loadStudentSchedule(savedScrollTop, savedScrollLeft)
    navigationInProgress = false
  }

  const formatScheduleCell = (cell) => {
    const items = cell
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

  async function loadStaticData() {
    if (isStaticDataLoaded) return

    try {
      const [timeslots, holidays] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('holiday').getFullList({ fields: 'id,name,date' }),
      ])

      cachedTimeslots = timeslots
      cachedHolidays = holidays
      isStaticDataLoaded = true
    } catch (err) {
      console.error('Failed to load static data:', err)
      toast.error('Failed to load student data')
    }
  }

  async function loadStudentSchedule(savedScrollTop = null, savedScrollLeft = null) {
    if (isLoading) return

    isLoading = true
    try {
      const foundHoliday = cachedHolidays.find((h) => h.date?.split(' ')[0] === selectedDate)
      todayHoliday = foundHoliday || null

      const startDateStr = `${selectedDate} 00:00:00`
      const endDateStr = `${selectedDate} 23:59:59`

      const isAdmin = pb.authStore.model?.role === 'admin'

      // Fetch students active on selected date
      let studentFilter = `status != "graduated" && start <= "${endDateStr}" && end >= "${startDateStr}"`
      if (!isAdmin) {
        studentFilter += ` && user = "${pb.authStore.model?.id}"`
      }

      // Fetch students
      cachedStudents = await pb.collection('student').getFullList({
        filter: studentFilter,
      })

      // Get unique user IDs and fetch user data
      const userIds = [...new Set(cachedStudents.map((s) => s.user).filter(Boolean))]
      const userMap = new Map()

      for (const userId of userIds) {
        try {
          const user = await pb.collection('users').getOne(userId)
          userMap.set(userId, user)
        } catch (err) {
          // Try alternative collection name
          try {
            const user = await pb.collection('_pb_users_auth_').getOne(userId)
            userMap.set(userId, user)
          } catch (err2) {
            // If it's the current user, use auth store
            if (userId === pb.authStore.model?.id) {
              userMap.set(userId, pb.authStore.model)
            }
          }
        }
      }

      // Attach user data to students
      cachedStudents = cachedStudents.map((student) => ({
        ...student,
        _userData: userMap.get(student.user) || null,
      }))

      let scheduleFilter = `start <= "${endDateStr}" && end >= "${startDateStr}"`
      if (!isAdmin) {
        scheduleFilter += ` && student.user = "${pb.authStore.model?.id}"`
      }

      let schedules = await pb.collection('schedule').getFullList({
        filter: scheduleFilter,
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (todayHoliday) {
        schedules = schedules.filter((s) => {
          const recStart = s.start?.split(' ')[0]
          const recEnd = s.end?.split(' ')[0]
          return recStart === selectedDate && recEnd === selectedDate
        })
      }

      const scheduleMap = new Map()
      const scheduledStudentMap = new Map()

      for (const s of schedules) {
        const timeslotId = s.expand?.timeslot?.id
        if (!timeslotId) continue

        const entry = {
          subject: s.expand?.subject,
          teacher: s.expand?.teacher,
          room: s.expand?.room,
        }

        const studentList = Array.isArray(s.expand?.student)
          ? s.expand.student
          : s.expand?.student
            ? [s.expand.student]
            : []

        for (const student of studentList) {
          if (!scheduledStudentMap.has(student.id)) {
            const cachedStudent = cachedStudents.find((cs) => cs.id === student.id)
            scheduledStudentMap.set(student.id, cachedStudent || student)
          }

          if (!scheduleMap.has(student.id)) {
            scheduleMap.set(student.id, new Map())
          }
          const studentSlots = scheduleMap.get(student.id)
          if (!studentSlots.has(timeslotId)) {
            studentSlots.set(timeslotId, [])
          }
          studentSlots.get(timeslotId).push(entry)
        }
      }

      const seenNames = new Set()
      const resolvedStudents = []

      for (const [, student] of scheduledStudentMap) {
        const key = student.englishName?.toLowerCase()
        if (!key || seenNames.has(key)) continue
        seenNames.add(key)
        resolvedStudents.push(student)
      }

      const latestByName = new Map()
      for (const s of cachedStudents) {
        const key = s.englishName?.toLowerCase()
        if (!key) continue
        if (!latestByName.has(key) || new Date(s.created) > new Date(latestByName.get(key).created)) {
          latestByName.set(key, s)
        }
      }

      for (const [key, student] of latestByName) {
        if (seenNames.has(key)) continue
        seenNames.add(key)
        resolvedStudents.push(student)
      }

      students = resolvedStudents.sort((a, b) => {
        const aIsNew = a.status === 'new' ? 1 : 0
        const bIsNew = b.status === 'new' ? 1 : 0
        if (aIsNew !== bIsNew) return aIsNew - bIsNew
        return new Date(a.created) - new Date(b.created)
      })

      // --- Build columns ---
      const columns = [
        {
          name: 'Timeslot',
          width: `${TIMESLOT_COL_WIDTH}px`,
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
          width: `${STUDENT_COL_WIDTH}px`,
          name: h('div', { class: 'flex items-center justify-center' }, 'Class'),
          formatter: (cell) => formatScheduleCell(cell),
        })),
      ]

      const data = cachedTimeslots.map((ts) => {
        const row = [{ value: `${ts.start} - ${ts.end}` }]
        for (const student of students) {
          const studentSlots = scheduleMap.get(student.id) || new Map()
          row.push(studentSlots.get(ts.id) || [])
        }
        return row
      })

      await tick()

      if (gridInstance && document.getElementById('student-grid')) {
        gridInstance.updateConfig({ columns, data }).forceRender()

        if (savedScrollTop !== null) {
          requestAnimationFrame(() => {
            const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
            if (wrapper) {
              wrapper.scrollTop = savedScrollTop
              wrapper.scrollLeft = savedScrollLeft || 0
              if (profileRowEl) profileRowEl.scrollLeft = savedScrollLeft || 0
            }
          })
        }
      } else {
        gridInstance = new Grid({
          columns,
          data,
          height: 'calc(100vh - 320px)',
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'text-center',
            td: 'text-center',
          },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('student-grid'))

        await tick()
        attachScrollSync()
      }
    } catch (err) {
      console.error('Failed to load student schedule:', err)
      toast.error('Failed to load student schedule')
    } finally {
      isLoading = false
    }
  }

  function attachScrollSync() {
    const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
    if (!wrapper || !profileRowEl) return

    wrapper.addEventListener('scroll', () => {
      if (syncingScroll) return
      syncingScroll = true
      profileRowEl.scrollLeft = wrapper.scrollLeft
      syncingScroll = false
    })

    profileRowEl.addEventListener('scroll', () => {
      if (syncingScroll) return
      syncingScroll = true
      wrapper.scrollLeft = profileRowEl.scrollLeft
      syncingScroll = false
    })
  }

  async function refreshWithScroll() {
    if (refreshTimeout) clearTimeout(refreshTimeout)

    refreshTimeout = setTimeout(async () => {
      const wrapper = document.querySelector('#student-grid .gridjs-wrapper')
      const savedScrollTop = wrapper?.scrollTop || 0
      const savedScrollLeft = wrapper?.scrollLeft || 0
      await loadStudentSchedule(savedScrollTop, savedScrollLeft)
      refreshTimeout = null
    }, 100)
  }

  onMount(async () => {
    await loadStaticData()
    await loadStudentSchedule()

    unsubSchedule = await pb.collection('schedule').subscribe('*', () => {
      refreshWithScroll()
    })
  })

  onDestroy(() => {
    if (refreshTimeout) clearTimeout(refreshTimeout)
    unsubSchedule?.()
    if (gridInstance) {
      gridInstance.destroy()
      gridInstance = null
    }
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100 min-h-screen">
  <div class="flex items-center justify-between mb-4">
    <div class="flex-1"></div>
    <div class="flex-1"></div>
  </div>

  <!-- SINGLE ROW HEADER -->
  <div class="mb-3 bg-base-200/60 rounded-xl p-3 shadow-sm">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <!-- LEFT: PROFILE -->
      <div
        bind:this={profileRowEl}
        class="profile-row flex overflow-x-auto items-stretch border border-base-300 rounded-lg bg-base-100"
      >
        <!-- FIXED FIRST COLUMN (just Profile text, no avatar) -->
        <div
          class="shrink-0 flex items-center justify-center bg-base-200 border-r border-base-300 px-3"
          style="min-width: 140px;"
        >
          <div class="font-bold text-sm text-center">Profile</div>
        </div>

        <!-- STUDENTS -->
        {#each students as student (student.id)}
          <div
            class="shrink-0 flex flex-row items-center justify-start text-left px-2 py-2 gap-3"
            style="min-width: 140px;"
          >
            <!-- AVATAR -->
            <div class="avatar shrink-0">
              <div class="w-20 h-20 rounded-full ring ring-base-300 overflow-hidden">
                {#if getStudentAvatarUrl(student)}
                  <img src={getStudentAvatarUrl(student)} alt={student.name} loading="lazy" />
                {:else}
                  <div class="w-full h-full flex items-center justify-center bg-neutral text-neutral-content">
                    <span class="text-xs">{getStudentInitials(student)}</span>
                  </div>
                {/if}
              </div>
            </div>

            <!-- INFO -->
            <div class="flex flex-col min-w-0">
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
          </div>
        {/each}
      </div>

      <!-- CENTER: DATE -->
      <h3 class="text-lg md:text-xl font-bold text-center text-neutral-700 flex-1">
        {formatDateDisplay(selectedDate)}
      </h3>

      <!-- RIGHT: CONTROLS -->
      <div class="flex items-center gap-2 justify-end flex-wrap">
        <button
          class="btn btn-sm btn-primary btn-outline rounded-full px-4"
          onclick={goToToday}
          disabled={isLoading || selectedDate === getTodayDate()}
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
            disabled={isLoading}
          >
            &larr;
          </button>

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
            disabled={isLoading}
          >
            &rarr;
          </button>
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

  .profile-row {
    overflow-y: hidden;
  }

  /* Hide scrollbar visually on profile row, table wrapper drives the scroll */
  .profile-row::-webkit-scrollbar {
    height: 0;
  }

  #student-grid :global(.gridjs-wrapper) {
    max-height: calc(100vh - 320px);
    overflow: auto;
    contain: strict;
  }

  /* Custom scrollbars */
  #student-grid :global(.gridjs-wrapper)::-webkit-scrollbar,
  .profile-row::-webkit-scrollbar {
    height: 8px;
    width: 8px;
  }

  #student-grid :global(.gridjs-wrapper)::-webkit-scrollbar-track {
    background: #f1f1f1;
  }

  #student-grid :global(.gridjs-wrapper)::-webkit-scrollbar-thumb {
    background: #c4c8cc;
    border-radius: 4px;
  }

  #student-grid :global(.gridjs-wrapper)::-webkit-scrollbar-thumb:hover {
    background: #a3a8ad;
  }

  /* Fix padding and alignment */
  #student-grid :global(td) {
    padding: 0 !important;
    vertical-align: middle !important;
    border-color: #e5e7eb !important;
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
    background-color: #353a40;
    color: #ffffff;
    text-align: center;
    vertical-align: middle;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 10px 8px !important;
  }

  /* Sticky first column (Timeslot) */
  #student-grid :global(th:nth-child(1)),
  #student-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: white;
  }

  #student-grid :global(th:nth-child(1)) {
    z-index: 25;
    background-color: #353a40;
  }

  /* Zebra striping */
  #student-grid :global(tr:nth-child(even) td) {
    background-color: #fafafa;
  }

  #student-grid :global(tr:nth-child(even) td:first-child) {
    background-color: #f3f4f6;
  }

  /* Hover effect for cells */
  #student-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.15s ease;
    cursor: pointer;
  }

  #student-grid :global(.gridjs-table tr:hover td) {
    background-color: #f0fdf4;
  }

  /* Sticky profile cell to match Timeslot column */
  .profile-row > div:first-child {
    position: sticky;
    left: 0;
    z-index: 5;
  }
</style>
