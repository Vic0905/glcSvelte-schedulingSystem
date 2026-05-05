<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import GroupModal from './GroupModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // const stickyStyles = `
  //   #group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
  //   #group-grid th {
  //   position: sticky;
  //   top: 0;
  //   z-index: 20;
  //   box-shadow: inset -1px 0 0 #ddd;
  //   background-color: #484b4f; /* dark (Tailwind gray-800) */
  //      color: #ffffff; /* white text */
  //   }
  //   #group-grid th:nth-child(1), #group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
  //   #group-grid th:nth-child(1) { z-index: 25; }
  //   #group-grid th:nth-child(2), #group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
  //   #group-grid th:nth-child(2) { z-index: 25; }
  // `

  // Anchors to Tuesday (2) of the current week
  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay() // Sun=0, Mon=1, Tue=2, Wed=3...

    // Adjust Sunday (0) to be treated as 7 so the week is Mon-Sun
    const dayAdjusted = day === 0 ? 7 : day

    // Calculate how many days to move to get to Tuesday (2)
    // If today is Monday (1), diff is -1 (1-2), so it adds 1 day to reach Tuesday.
    // If today is Wednesday (3), diff is 1 (3-2), so it subtracts 1 day to reach Tuesday.
    const diff = dayAdjusted - 2

    d.setDate(d.getDate() - diff)

    return d.toISOString().split('T')[0]
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3) // Tuesday to Friday
    const opts = { month: 'long', day: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }

  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = []
  let allGroupRooms = []
  let groupModal
  let isCopying = $state(false)
  let isLoading = $state(false)
  let abortController = null
  let scrollPositions = $state({ top: 0, left: 0 })

  const cache = {
    groupSchedules: null,
    lastFetch: 0,
    cacheDuration: 30000,
    isValid: () => cache.groupSchedules && Date.now() - cache.lastFetch < cache.cacheDuration,
    invalidate: () => {
      cache.groupSchedules = null
      cache.lastFetch = 0
    },
  }

  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#group-grid .gridjs-wrapper')
    if (wrapper) {
      scrollPositions = { top: wrapper.scrollTop, left: wrapper.scrollLeft }
    }
  }

  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#group-grid .gridjs-wrapper')
      if (wrapper) {
        wrapper.scrollTop = scrollPositions.top
        wrapper.scrollLeft = scrollPositions.left
      }
    })
  }

  const changeWeek = async (weeks) => {
    if (isLoading) return
    abortController?.abort()
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    cache.invalidate()
    await loadGroupSchedules(true)
  }

  const copyToAdvanceBooking = async () => {
    try {
      const nextWeekDate = new Date(weekStart)
      nextWeekDate.setDate(nextWeekDate.getDate() + 7)
      const nextWeekStr = nextWeekDate.toISOString().split('T')[0]

      const [schedules, existingBookings] = await Promise.all([
        pb.collection('groupLessonSchedule').getFullList({
          filter: `date = "${weekStart}"`,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `date = "${nextWeekStr}"`,
          })
          .catch(() => []),
      ])

      if (!schedules.length) {
        toast.info('No group schedules found for this Tuesday')
        return
      }

      const existingSet = new Set(existingBookings.map((b) => `${b.timeslot}-${b.grouproom}-${b.teacher}`))
      const schedulesToCopy = schedules.filter((s) => !existingSet.has(`${s.timeslot}-${s.grouproom}-${s.teacher}`))

      if (!schedulesToCopy.length) {
        toast.info('All schedules already copied to next week!')
        return
      }

      if (!confirm(`Copy ${schedulesToCopy.length} group schedules to next week?`)) return

      isCopying = true
      const batchSize = 10
      for (let i = 0; i < schedulesToCopy.length; i += batchSize) {
        const batch = schedulesToCopy.slice(i, i + batchSize)
        await Promise.all(
          batch.map((s) =>
            pb.collection('groupAdvanceBooking').create({
              date: nextWeekStr,
              timeslot: s.timeslot,
              teacher: s.teacher,
              student: s.student, // Array of student IDs
              subject: s.subject,
              grouproom: s.grouproom,
              status: 'pending',
            })
          )
        )
      }

      toast.success('Successfully copied to Group Advance Booking')
    } catch (error) {
      console.error(error)
      toast.error('Failed to copy group schedules')
    } finally {
      isCopying = false
    }
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

  async function loadGroupSchedules(forceRefresh = false) {
    if (isLoading) return
    abortController?.abort()
    abortController = new AbortController()
    saveScrollPosition()
    isLoading = true

    try {
      let schedules
      if (!forceRefresh && cache.isValid()) {
        schedules = cache.groupSchedules
      } else {
        const promises = []
        if (!timeslots.length) promises.push(pb.collection('timeslot').getFullList({ sort: 'start' }))
        promises.push(pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }))

        // Single date anchor filter
        promises.push(
          pb.collection('groupLessonSchedule').getFullList({
            filter: `date = "${weekStart}"`,
            expand: 'teacher,student,subject,grouproom,timeslot',
            $autoCancel: false,
          })
        )

        const results = await Promise.all(promises)
        let idx = 0
        if (!timeslots.length) timeslots = results[idx++]
        let groupRooms = results[idx++]
        schedules = results[idx]

        // Filter Rooms: Only show if teacher is active or has schedules
        const teacherIdsWithSchedules = new Set(schedules.map((s) => s.teacher))
        allGroupRooms = groupRooms.filter((gr) => {
          const teacher = gr.expand?.teacher
          return !teacher || teacher.status !== 'disabled' || teacherIdsWithSchedules.has(teacher.id)
        })

        cache.groupSchedules = schedules
        cache.lastFetch = Date.now()
      }

      // Simplified Map: Keyed by RoomID + TimeslotID
      const scheduleMap = new Map()
      for (const s of schedules) {
        const key = `${s.grouproom}-${s.timeslot}`
        scheduleMap.set(key, s)
      }

      const data = allGroupRooms.map((gr) => {
        const teacher = gr.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Group Room', value: gr.name, disabled: true },
        ]

        for (const ts of timeslots) {
          const s = scheduleMap.get(`${gr.id}-${ts.id}`)

          if (!s) {
            row.push({
              label: 'Empty',
              date: weekStart,
              subject: { name: '', id: '' },
              teacher: { name: '', id: '' },
              students: [],
              groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          } else {
            row.push({
              label: 'Schedule',
              id: s.id,
              date: weekStart,
              subject: { name: s.expand?.subject?.name || '', id: s.expand?.subject?.id || '' },
              teacher: {
                name: s.expand?.teacher?.name || '',
                id: s.expand?.teacher?.id || '',
                status: s.expand?.teacher?.status || 'active',
              },
              students: (s.expand?.student || []).map((std) => ({
                englishName: std.englishName,
                id: std.id,
                status: std.status,
              })),
              groupRoom: { name: gr.name, id: gr.id, maxstudents: gr.maxstudents || 0 },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: teacher,
            })
          }
        }
        return row
      })

      if (grid.groupSchedule) {
        grid.groupSchedule.updateConfig({ data }).forceRender()
        restoreScrollPosition()
      } else {
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

        grid.groupSchedule = new Grid({
          columns,
          data,
          className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('group-grid'))

        grid.groupSchedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          booking.data = {
            ...cellData,
            startDate: weekStart,
            endDate: endDate.toISOString().split('T')[0],
            mode: cellData.label === 'Empty' ? 'create' : 'edit',
          }

          groupModal?.showModal()
        })
      }
    } catch (error) {
      console.error(error)
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    if (!grid.groupSchedule) loadGroupSchedules()
    pb.collection('groupLessonSchedule').subscribe('*', () => {
      cache.invalidate()
      loadGroupSchedules(true)
    })
  })

  onDestroy(() => {
    abortController?.abort()
    grid.groupSchedule?.destroy()
    grid.groupSchedule = null
    pb.collection('groupLessonSchedule').unsubscribe()
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">GRP Schedule Table (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-ghost btn-sm gap-2" onclick={copyToAdvanceBooking} disabled={isCopying}>
      {#if isCopying}<span class="loading loading-spinner"></span>{:else}Copy to Next Week{/if}
    </button>

    <h3 class="text-xl font-semibold text-center mr-20">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="group-grid" class="border rounded-lg"></div>
</div>

<GroupModal on:refresh={() => loadGroupSchedules(true)} bind:this={groupModal} />

<style>
  #group-grid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  #group-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: #484b4f; /* dark (Tailwind gray-800) */
    color: #ffffff; /* white text */
  }

  #group-grid :global(th:nth-child(1)),
  #group-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #group-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #group-grid :global(th:nth-child(2)),
  #group-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #group-grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
