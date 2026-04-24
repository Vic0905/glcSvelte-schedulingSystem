<!-- <script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  //   import ScheduleModal from './scheduleModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import MtmModal from './MtmModal.svelte'

  const stickyStyles = `
    #grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #grid th:nth-child(1), #grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #grid th:nth-child(1) { z-index: 25; }
    #grid th:nth-child(2), #grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #grid th:nth-child(2) { z-index: 25; }
  `

  // Anchors to Tuesday
  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()

    // Tuesday = 2
    const diff = day - 2

    d.setDate(d.getDate() - diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
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
    if (wrapper) scrollPositions = { top: wrapper.scrollTop, left: wrapper.scrollLeft }
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

      // Filter MtmSchedule where 'start' date matches the current viewed week
      const [schedules, existingBookings] = await Promise.all([
        pb.collection('MtmSchedule').getFullList({
          filter: `start >= "${weekStart} 00:00:00" && start <= "${weekStart} 23:59:59"`,
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
        toast.info('No schedules found to copy')
        return
      }

      const existingSet = new Set(existingBookings.map((b) => `${b.timeslot}-${b.student}-${b.room}`))
      const schedulesToCopy = schedules.filter((s) => !existingSet.has(`${s.timeslot}-${s.student}-${s.room}`))

      if (!schedulesToCopy.length) {
        toast.info('All schedules already exist in Advance Booking')
        return
      }

      if (!confirm(`Copy ${schedulesToCopy.length} schedules to next week?`)) return

      isCopying = true
      for (const s of schedulesToCopy) {
        await pb.collection('advanceBooking').create({
          date: nextWeekStr, // Advance booking still uses a single date anchor usually
          timeslot: s.timeslot,
          teacher: s.teacher,
          student: s.student,
          subject: s.subject,
          room: s.room,
          status: 'pending',
        })
      }

      toast.success('Copied to Advance Booking')
    } catch (error) {
      console.error(error)
      toast.error('Failed to copy')
    } finally {
      isCopying = false
    }
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h('div', { class: 'flex flex-col gap-1 items-center font-semibold' }, [
      h('span', { class: 'badge badge-ghost badge-xs p-3' }, cell.subject.name),
      h('span', { class: 'badge badge-ghost badge-xs' }, cell.student.englishName),
      h('span', { class: 'badge badge-ghost badge-xs' }, cell.teacher.name),
    ])
  }

  function buildCellData(schedule, room, timeslot, teacher) {
    const base = {
      room: { name: room.name, id: room.id },
      timeslot: { id: timeslot.id, start: timeslot.start, end: timeslot.end },
      assignedTeacher: teacher,
      weekStart: weekStart,
    }

    if (!schedule) {
      return {
        ...base,
        label: 'Empty',
        // Ensure these exist as objects so modal doesn't crash
        // when calling cellData.subject.id
        subject: { name: '', id: '' },
        teacher: { name: teacher?.name || '', id: teacher?.id || '' },
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
      startDate: schedule.start,
      endDate: schedule.end,
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

        // Fetch using the 'start' field range
        promises.push(
          pb.collection('MtmSchedule').getFullList({
            // Use the '~' (like) operator or exact string match
            filter: `start = "${weekStart}"`,
            expand: 'teacher,student,subject,room,timeslot',
            $autoCancel: false,
          })
        )

        const results = await Promise.all(promises)
        let idx = 0
        if (!timeslots.length) timeslots = results[idx++]
        if (!rooms.length) rooms = results[idx++]
        schedules = results[idx]

        const teacherIdsWithSchedules = new Set(schedules.map((s) => s.teacher))
        rooms = rooms.filter((room) => {
          const teacher = room.expand?.teacher
          return !teacher || teacher.status !== 'disabled' || teacherIdsWithSchedules.has(teacher.id)
        })

        cache.schedules = schedules
        cache.lastFetch = Date.now()
      }

      const scheduleMap = new Map()
      for (const s of schedules) {
        scheduleMap.set(`${s.room}-${s.timeslot}`, s)
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
          { name: 'Teacher', width: '120px', formatter: (c) => c.value },
          { name: 'Room', width: '120px', formatter: (c) => c.value },
          ...timeslots.map((t) => ({
            name: `${t.start} - ${t.end}`,
            id: t.id,
            width: '160px',
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
          booking.data = { ...cellData, mode: cellData.label === 'Empty' ? 'create' : 'edit' }
          document.getElementById('editModal')?.showModal()
        })
      }
    } catch (error) {
      console.error(error)
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    loadSchedules()
    pb.collection('MtmSchedule').subscribe('*', () => loadSchedules(true))
  })

  onDestroy(() => {
    grid.schedule?.destroy()
    grid.schedule = null
    pb.collection('MtmSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-4 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">MTM Schedule</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-ghost btn-sm gap-2" onclick={copyToAdvanceBooking} disabled={isCopying}>
      {#if isCopying}<span class="loading loading-spinner"></span>{:else}Copy to Next Week{/if}
    </button>

    <h3 class="text-xl font-semibold">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
    </div>
  </div>

  <div id="grid" class="border rounded-lg"></div>
</div>
<!-- 
<ScheduleModal on:refresh={() => loadSchedules(true)} /> -->

<MtmModal on:refresh={() => loadSchedules(true)} /> -->
