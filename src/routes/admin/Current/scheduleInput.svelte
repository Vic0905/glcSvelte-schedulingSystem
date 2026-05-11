<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

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
  let rooms = []
  let isCopying = $state(false)
  let isLoading = $state(false)
  let abortController = null
  let scrollPositions = $state({ top: 0, left: 0 })

  const cache = {
    schedules: null,
    lastFetch: 0,
    cacheDuration: 30000,
    isValid: () => cache.schedules && Date.now() - cache.lastFetch < cache.cacheDuration,
  }

  const saveScrollPosition = () => {
    const wrapper = document.querySelector('#grid .gridjs-wrapper')
    if (wrapper) {
      scrollPositions = { top: wrapper.scrollTop, left: wrapper.scrollLeft }
    }
  }

  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector('#grid .gridjs-wrapper')
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
    cache.schedules = null
    await loadSchedules(true)
  }

  const copyToAdvanceBooking = async () => {
    try {
      const nextWeekDate = new Date(weekStart)
      nextWeekDate.setDate(nextWeekDate.getDate() + 7)
      const nextWeekStr = nextWeekDate.toISOString().split('T')[0]

      // We only need to fetch the Tuesday records
      const [schedules, existingBookings] = await Promise.all([
        pb.collection('lessonSchedule').getFullList({
          filter: `date = "${weekStart}"`,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb
          .collection('advanceBooking')
          .getFullList({
            filter: `date = "${nextWeekStr}"`,
          })
          .catch(() => []),
      ])

      if (!schedules.length) {
        toast.info('No schedules found for this week')
        return
      }

      // Check for already copied records based on Tuesday anchor
      const existingSet = new Set(existingBookings.map((b) => `${b.timeslot}-${b.student}-${b.room}`))
      const schedulesToCopy = schedules.filter((s) => !existingSet.has(`${s.timeslot}-${s.student}-${s.room}`))

      if (!schedulesToCopy.length) {
        toast.info('All schedules already copied to next week!')
        return
      }

      if (!confirm(`Copy ${schedulesToCopy.length} schedules to next week (${getWeekRangeDisplay(nextWeekStr)})?`))
        return

      isCopying = true
      const batchSize = 10
      for (let i = 0; i < schedulesToCopy.length; i += batchSize) {
        const batch = schedulesToCopy.slice(i, i + batchSize)
        await Promise.all(
          batch.map((s) =>
            pb.collection('advanceBooking').create({
              date: nextWeekStr,
              timeslot: s.timeslot,
              teacher: s.teacher,
              student: s.student,
              subject: s.subject,
              room: s.room,
              status: 'pending',
            })
          )
        )
      }

      toast.success('Successfully copied to Advance Booking')
    } catch (error) {
      console.error(error)
      toast.error('Failed to copy schedules')
    } finally {
      isCopying = false
    }
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'flex flex-col gap-1 p-1 items-center text-center text-xs' }, [
      // 🔹 Header (Subject + Teacher)
      h(
        'div',
        {
          class: 'font-bold text-neutral-700 border-b border-base-500 mb-1 pb-1 w-full',
        },
        [h('div', {}, cell.subject.name), h('div', { class: 'text-[10px] uppercase mt-1' }, cell.teacher.name)]
      ),

      // 🔹 Student (separate section)
      h('div', { class: 'badge badge-ghost badge-xs px-2 py-2' }, cell.student.englishName),
    ])
  }

  function buildCellData(schedule, room, timeslot, teacher) {
    const base = {
      room: { name: room.name, id: room.id },
      timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
      assignedTeacher: teacher,
      weekStart: weekStart, // Anchor date
    }

    if (!schedule) {
      return {
        ...base,
        label: 'Empty',
        subject: { name: '', id: '' },
        teacher: {
          name: teacher?.name || '',
          id: teacher?.id || '',
        },
        student: { englishName: '', id: '' },
      }
    }

    return {
      ...base,
      label: 'Schedule',
      id: schedule.id,
      subject: { name: schedule.expand?.subject?.name || '', id: schedule.expand?.subject?.id || '' },
      teacher: { name: schedule.expand?.teacher?.name || '', id: schedule.expand?.teacher?.id || '' },
      student: { englishName: schedule.expand?.student?.englishName || '', id: schedule.expand?.student?.id || '' },
    }
  }

  async function loadSchedules(forceRefresh = false) {
    if (isLoading) return
    abortController?.abort()
    abortController = new AbortController()
    saveScrollPosition()
    isLoading = true

    try {
      let schedules
      if (!forceRefresh && cache.isValid()) {
        schedules = cache.schedules
      } else {
        const promises = []
        if (!timeslots.length) promises.push(pb.collection('timeSlot').getFullList({ sort: 'start' }))
        if (!rooms.length) promises.push(pb.collection('room').getFullList({ sort: 'name', expand: 'teacher' }))

        // Fetch only the anchor date (Tuesday)
        promises.push(
          pb.collection('lessonSchedule').getFullList({
            filter: `date = "${weekStart}"`,
            expand: 'teacher,student,subject,room,timeslot',
            $autoCancel: false,
          })
        )

        const results = await Promise.all(promises)
        let idx = 0
        if (!timeslots.length) timeslots = results[idx++]
        if (!rooms.length) rooms = results[idx++]
        schedules = results[idx]

        // Logic to handle disabled teachers while showing active schedules
        const teacherIdsWithSchedules = new Set(schedules.map((s) => s.teacher))

        rooms = rooms.filter((room) => {
          const teacher = room.expand?.teacher
          if (!teacher) return true
          return teacher.status !== 'disabled' || teacherIdsWithSchedules.has(teacher.id)
        })

        cache.schedules = schedules
        cache.lastFetch = Date.now()
      }

      // Map creation is direct—no deduplication needed because date is unique per week
      const scheduleMap = new Map()
      for (const s of schedules) {
        const key = `${s.room}-${s.timeslot}`
        scheduleMap.set(key, s)
      }

      const data = rooms.map((room) => {
        const teacher = room.expand?.teacher
        const row = [
          { label: 'Teacher', value: teacher?.name || '-', disabled: true },
          { label: 'Room', value: room.name, disabled: true },
        ]

        for (const ts of timeslots) {
          const schedule = scheduleMap.get(`${room.id}-${ts.id}`)
          row.push(buildCellData(schedule, room, ts, teacher))
        }
        return row
      })

      if (grid.schedule) {
        grid.schedule.updateConfig({ data }).forceRender()
        restoreScrollPosition()
      } else {
        const columns = [
          {
            name: 'Teacher',
            width: '120px',
            formatter: (cell) =>
              h(
                'div',
                {
                  className: 'text-center text-neutral-700 font-bold',
                },
                cell.value
              ),
          },
          {
            name: 'Room',
            width: '120px',
            formatter: (cell) =>
              h(
                'div',
                {
                  className: 'text-center text-neutral-700 font-bold',
                },
                cell.value
              ),
          },
          ...timeslots.map((t) => ({
            name: `${t.start} - ${t.end}`,
            id: t.id,
            width: '180px',
            formatter: formatCell,
          })),
        ]

        grid.schedule = new Grid({
          columns,
          data,
          className: { table: 'w-full border text-xs !border-collapse' },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('grid'))

        grid.schedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          booking.data = {
            ...cellData,
            startDate: weekStart,
            endDate: endDate.toISOString().split('T')[0],
            mode: cellData.label === 'Empty' ? 'create' : 'edit',

            originalStudentId: cellData.student?.id,
            originalTeacherId: cellData.teacher?.id,
            originalRoomId: cellData.room?.id,
            originalTimeslotId: cellData.timeslot?.id,
          }
        })
      }
    } catch (error) {
      console.error(error)
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    booking.data = null
    if (!grid.schedule) loadSchedules()
    pb.collection('lessonSchedule').subscribe('*', () => loadSchedules(true))
  })

  onDestroy(() => {
    grid.schedule?.destroy()
    grid.schedule = null
    pb.collection('lessonSchedule').unsubscribe()
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">MTM Schedule (Current)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-ghost btn-sm gap-2" onclick={copyToAdvanceBooking} disabled={isCopying}>
      {#if isCopying}<span class="loading loading-spinner"></span>{:else}Copy to Advance{/if}
    </button>

    <h3 class="text-xl font-semibold text-center mr-20">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="grid" class="border rounded-lg"></div>
</div>

<ScheduleModal on:refresh={() => loadSchedules(true)} />

<style>
  #grid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  #grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f; /* dark (Tailwind gray-800) */
    color: #ffffff; /* white text */
  }

  #grid :global(th:nth-child(1)),
  #grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #grid :global(th:nth-child(2)),
  #grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
