<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import CombineModal from './combineModal.svelte'

  // --- State Runes ---
  let combineModal = $state()
  let gridInstance = $state(null)
  let weekStart = $state(getWeekStart(new Date()))
  let timeslots = $state([])
  let rooms = $state([])
  let isLoading = $state(false)
  let isCopying = $state(false) // ← NEW

  // --- Helper Functions ---
  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day < 2 ? day + 5 : day - 2
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

  const changeWeek = async (weeks) => {
    const wrapper = document.querySelector('#unified-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)

    await loadSchedules(savedScrollTop, savedScrollLeft)
  }

  const formatCell = (cell) => {
    if (!cell || !cell.schedules || cell.schedules.length === 0) {
      return h('span', { class: 'text-gray-400' }, '—')
    }

    const { schedules } = cell
    const firstSched = schedules[0]
    const subjectName = firstSched.subject?.name || 'No Subject'
    const teacherName = firstSched.teacher?.name || 'No Teacher'
    const allStudents = schedules.flatMap((s) => s.students.map((std) => std.name))

    return h('div', { class: 'flex flex-col gap-1 p-1 items-center text-center' }, [
      h('div', { class: 'font-bold text-neutral-700 border-b border-base-700 mb-1 pb-1 w-full' }, [
        h('div', { class: '' }, subjectName),
        h('div', { class: 'text-[10px] uppercase mt-1' }, teacherName),
      ]),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-1' },
        allStudents.map((name) => h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, name))
      ),
    ])
  }

  // ─── NEW: Copy to Advance ────────────────────────────────────────────────
  const copyToAdvance = async () => {
    if (isCopying) return

    const confirmed = confirm(`Copy all schedules for ${getWeekRangeDisplay(weekStart)} to Advance Booking?`)
    if (!confirmed) return

    isCopying = true
    try {
      const startD = new Date(weekStart)
      const endD = new Date(startD)
      endD.setDate(startD.getDate() + 3)

      const startDateStr = `${weekStart} 00:00:00`
      const endDateStr = `${endD.toISOString().split('T')[0]} 23:59:59`

      // Fetch this week's schedules AND existing advance schedules in parallel
      const [schedules, existing] = await Promise.all([
        pb.collection('schedule').getFullList({
          filter: `start <= "${endDateStr}" && end >= "${startDateStr}"`,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('advanceSchedule').getFullList({
          fields: 'timeslot,room,teacher,student,subject',
        }),
      ])

      if (schedules.length === 0) {
        toast.info('No schedules found for this week to copy.')
        return
      }

      // Build a set of existing keys to detect duplicates
      const existingKeys = new Set(
        existing.map((e) => `${e.timeslot}-${e.room}-${e.teacher}-${e.student}-${e.subject}`)
      )

      const toCreate = schedules.filter((s) => {
        const key = `${s.timeslot}-${s.room}-${s.teacher}-${s.student}-${s.subject}`
        return !existingKeys.has(key)
      })

      const skipped = schedules.length - toCreate.length

      if (toCreate.length === 0) {
        toast.info(`All ${schedules.length} schedule(s) already exist in Advance Booking — nothing to copy.`)
        return
      }

      // Create only the non-duplicate records in parallel
      const results = await Promise.allSettled(
        toCreate.map((s) =>
          pb.collection('advanceSchedule').create({
            timeslot: s.timeslot,
            room: s.room,
            teacher: s.teacher,
            student: s.student,
            subject: s.subject,
          })
        )
      )

      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (failed === 0) {
        const skipMsg = skipped > 0 ? ` (${skipped} duplicate(s) skipped)` : ''
        toast.success(`✓ Copied ${succeeded} schedule(s) to Advance Booking.${skipMsg}`)
      } else {
        toast.warning(`Copied ${succeeded}, skipped ${skipped} duplicate(s), but ${failed} failed. Check console.`)
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) => console.error('advanceSchedule create error:', r.reason))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to copy schedules to Advance Booking.')
    } finally {
      isCopying = false
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  async function loadSchedules(savedScrollTop = null, savedScrollLeft = null) {
    if (isLoading) return

    isLoading = true
    try {
      const startD = new Date(weekStart)
      const endD = new Date(startD)
      endD.setDate(startD.getDate() + 3)

      const startDateStr = `${weekStart} 00:00:00`
      const endDateStr = `${endD.toISOString().split('T')[0]} 23:59:59`

      const [ts, roomList, sched] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('roomType').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('schedule').getFullList({
          filter: `start <= "${endDateStr}" && end >= "${startDateStr}"`,
          expand: 'teacher,student,subject,room,timeslot',
        }),
      ])

      timeslots = ts
      rooms = roomList

      const unified = sched.map((s) => ({
        roomId: s.expand?.room?.id,
        timeslotId: s.expand?.timeslot?.id,
        students: s.expand?.student ? [{ id: s.expand.student.id, name: s.expand.student.englishName }] : [],
        subject: s.expand?.subject,
        teacher: s.expand?.teacher,
        start: s.start?.split(' ')[0],
        end: s.end?.split(' ')[0],
      }))

      const scheduleMap = new Map()
      for (const s of unified) {
        const key = `${s.roomId}-${s.timeslotId}`
        if (!scheduleMap.has(key)) scheduleMap.set(key, [])
        scheduleMap.get(key).push(s)
      }

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

      if (gridInstance) {
        if (savedScrollTop === null) {
          const wrapper = document.querySelector('#unified-grid .gridjs-wrapper')
          savedScrollTop = wrapper?.scrollTop || 0
          savedScrollLeft = wrapper?.scrollLeft || 0
        }

        gridInstance.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const wrapper = document.querySelector('#unified-grid .gridjs-wrapper')
          if (wrapper) {
            wrapper.scrollTop = savedScrollTop
            wrapper.scrollLeft = savedScrollLeft || 0
          }
        })
      } else {
        const columns = [
          { name: 'Teacher', width: '120px', formatter: (c) => c.value },
          { name: 'Room', width: '120px', formatter: (c) => c.value },
          ...timeslots.map((t) => ({
            name: `${t.start} - ${t.end}`,
            id: t.id,
            width: '180px',
            formatter: formatCell,
          })),
        ]

        gridInstance = new Grid({
          columns,
          data,
          height: '700px',
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'text-center',
            td: 'text-center',
          },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('unified-grid'))

        gridInstance.on('cellClick', (...args) => {
          const cell = args[1].data
          if (cell.disabled) return

          const isCreateMode = cell.label === 'Empty'
          const firstSched = cell.schedules?.[0]

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          const activeTeacher = isCreateMode ? cell.room?.expand?.teacher : firstSched?.teacher

          const modalStartDate = !isCreateMode ? firstSched?.start || weekStart : weekStart
          const modalEndDate = !isCreateMode
            ? firstSched?.end || endDate.toISOString().split('T')[0]
            : endDate.toISOString().split('T')[0]

          combineModal.open({
            room: cell.room,
            timeslot: cell.timeslot,
            teacher: activeTeacher,
            startDate: modalStartDate,
            endDate: modalEndDate,
            mode: isCreateMode ? 'create' : 'edit',
            schedules: cell.schedules,
          })
        })
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedules')
    } finally {
      isLoading = false
    }
  }

  const refreshWithScroll = async () => {
    const wrapper = document.querySelector('#unified-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0
    await loadSchedules(savedScrollTop, savedScrollLeft)
  }

  onMount(() => {
    loadSchedules()

    return () => {
      if (gridInstance) {
        gridInstance.destroy()
        gridInstance = null
      }
    }
  })
</script>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Weekly Schedule (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between relative">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="ml-auto flex items-center gap-2">
      <!-- ← NEW button -->
      <!-- <button
        class="btn btn-outline btn-info btn-sm gap-1"
        onclick={copyToAdvance}
        disabled={isCopying || isLoading}
        title="Copy all schedules this week to Advance Booking"
      >
        {#if isCopying}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}{/if}
        Copy to Advance
      </button> -->

      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
    </div>
  </div>

  <div id="unified-grid" class="border rounded-lg"></div>
</div>

<CombineModal bind:this={combineModal} onrefresh={refreshWithScroll} />

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  #unified-grid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
    contain: strict;
  }

  #unified-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  #unified-grid :global(th:nth-child(1)),
  #unified-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #unified-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #unified-grid :global(th:nth-child(2)),
  #unified-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #unified-grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
