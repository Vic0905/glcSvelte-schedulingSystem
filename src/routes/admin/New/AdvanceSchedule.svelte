<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import AdvanceModal from './advanceModal.svelte'

  // --- State Runes ---
  let advanceModal = $state()
  let gridInstance = $state(null)
  let timeslots = $state([])
  let rooms = $state([])
  let isLoading = $state(false)
  let isDeleting = $state(false)
  let isCopying = $state(false)

  // ─── Copy to Live: week picker modal state ───
  let showWeekPicker = $state(false)
  let selectedWeekStart = $state(getWeekStart(new Date()))

  // --- Helper Functions ---
  // Calculates the date of the most recent Tuesday
  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay() // Sun = 0, Mon = 1, Tue = 2, Wed = 3, Thu = 4, Fri = 5, Sat = 6

    // Calculate how many days to subtract to get back to Tuesday
    // If today is Sunday (0) or Monday (1), it correctly rolls back to last week's Tuesday.
    const diff = day >= 2 ? day - 2 : day + 5

    d.setDate(d.getDate() - diff)
    return d.toISOString().split('T')[0]
  }

  // Spans 3 additional days (Tuesday + 3 days = Friday)
  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3) // Adds 3 days to land exactly on Friday

    const opts = { month: 'long', day: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }

  function changePickerWeek(weeks) {
    const d = new Date(selectedWeekStart)
    d.setDate(d.getDate() + weeks * 7)
    selectedWeekStart = getWeekStart(d)
  }

  // ─── Delete All ───────────────────────────────────────────────────────────
  const deleteAll = async () => {
    const confirmed = confirm('Delete ALL records in the Advance Schedule? This cannot be undone.')
    if (!confirmed) return

    isDeleting = true
    try {
      const all = await pb.collection('advanceSchedule').getFullList({ fields: 'id' })

      if (all.length === 0) {
        toast.info('Advance Schedule is already empty.')
        return
      }

      // Delete in chunks of 10 sequentially
      const chunkSize = 50
      let succeeded = 0
      let failed = 0

      for (let i = 0; i < all.length; i += chunkSize) {
        const chunk = all.slice(i, i + chunkSize)
        const results = await Promise.allSettled(chunk.map((rec) => pb.collection('advanceSchedule').delete(rec.id)))
        succeeded += results.filter((r) => r.status === 'fulfilled').length
        failed += results.filter((r) => r.status === 'rejected').length
      }

      if (failed === 0) {
        toast.success(`Deleted ${succeeded} advance record(s).`)
      } else {
        toast.warning(`Deleted ${succeeded}, but ${failed} failed.`)
      }

      await refreshWithScroll()
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete all advance schedules.')
    } finally {
      isDeleting = false
    }
  }

  // ─── Copy to Live ─────────────────────────────────────────────────────────
  const copyToLive = async () => {
    if (isCopying) return
    showWeekPicker = false
    isCopying = true

    try {
      const weekEndDate = new Date(selectedWeekStart)
      weekEndDate.setDate(weekEndDate.getDate() + 3)
      const endDateStr = weekEndDate.toISOString().split('T')[0]

      const startDateStr = `${selectedWeekStart} 00:00:00`
      const endDateFilter = `${endDateStr} 23:59:59`

      // Fetch advance records AND existing live schedules for that week in parallel
      const [all, existing] = await Promise.all([
        pb.collection('advanceSchedule').getFullList({
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('schedule').getFullList({
          filter: `start <= "${endDateFilter}" && end >= "${startDateStr}"`,
          fields: 'timeslot,room,teacher,student,subject',
        }),
      ])

      if (all.length === 0) {
        toast.info('No advance schedules to copy.')
        return
      }

      // Build a set of existing keys to detect duplicates
      const existingKeys = new Set(
        existing.map((e) => `${e.timeslot}-${e.room}-${e.teacher}-${e.student}-${e.subject}`)
      )

      const toCreate = all.filter((s) => {
        const key = `${s.timeslot}-${s.room}-${s.teacher}-${s.student}-${s.subject}`
        return !existingKeys.has(key)
      })

      const skipped = all.length - toCreate.length

      if (toCreate.length === 0) {
        toast.info(
          `All ${all.length} schedule(s) already exist for ${getWeekRangeDisplay(selectedWeekStart)} — nothing to copy.`
        )
        return
      }

      const results = await Promise.allSettled(
        toCreate.map((s) =>
          pb.collection('schedule').create({
            timeslot: s.timeslot,
            room: s.room,
            teacher: s.teacher,
            student: s.student,
            subject: s.subject,
            start: `${selectedWeekStart} 00:00:00.000Z`,
            end: `${endDateStr} 00:00:00.000Z`,
          })
        )
      )

      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (failed === 0) {
        const skipMsg = skipped > 0 ? ` (${skipped} duplicate(s) skipped)` : ''
        toast.success(
          `✓ Copied ${succeeded} record(s) to live schedule for ${getWeekRangeDisplay(selectedWeekStart)}.${skipMsg}`
        )
      } else {
        toast.warning(`Copied ${succeeded}, skipped ${skipped} duplicate(s), but ${failed} failed. Check console.`)
        results.filter((r) => r.status === 'rejected').forEach((r) => console.error('schedule create error:', r.reason))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to copy to live schedule.')
    } finally {
      isCopying = false
    }
  }

  // ─── Grid ─────────────────────────────────────────────────────────────────
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
        h('div', {}, subjectName),
        h('div', { class: 'text-[10px] uppercase mt-1' }, teacherName),
      ]),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-1' },
        allStudents.map((name) => h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, name))
      ),
    ])
  }

  async function loadSchedules(savedScrollTop = null, savedScrollLeft = null) {
    if (isLoading) return
    isLoading = true

    try {
      const [ts, roomList, sched] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('roomType').getFullList({ sort: 'name', expand: 'teacher' }),
        pb.collection('advanceSchedule').getFullList({
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
          const wrapper = document.querySelector('#advance-grid .gridjs-wrapper')
          savedScrollTop = wrapper?.scrollTop || 0
          savedScrollLeft = wrapper?.scrollLeft || 0
        }

        gridInstance.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const wrapper = document.querySelector('#advance-grid .gridjs-wrapper')
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
        }).render(document.getElementById('advance-grid'))

        gridInstance.on('cellClick', (...args) => {
          const cell = args[1].data
          if (cell.disabled) return

          const isCreateMode = cell.label === 'Empty'
          const firstSched = cell.schedules?.[0]
          const activeTeacher = isCreateMode ? cell.room?.expand?.teacher : firstSched?.teacher

          advanceModal.open({
            room: cell.room,
            timeslot: cell.timeslot,
            teacher: activeTeacher,
            mode: isCreateMode ? 'create' : 'edit',
            schedules: cell.schedules,
          })
        })
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load advance schedules')
    } finally {
      isLoading = false
    }
  }

  const refreshWithScroll = async () => {
    const wrapper = document.querySelector('#advance-grid .gridjs-wrapper')
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
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Advance Schedule (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <!-- Toolbar -->
  <div class="mb-3 flex items-center gap-2">
    <!-- Delete All — upper LEFT -->
    <button
      class="btn btn-outline btn-error btn-sm gap-1"
      onclick={deleteAll}
      disabled={isDeleting || isLoading}
      title="Delete all records in Advance Schedule"
    >
      {#if isDeleting}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}{/if}
      Delete All
    </button>

    <!-- Copy to Live — opens week-picker modal -->
    <button
      class="btn btn-outline btn-success btn-sm gap-1"
      onclick={() => (showWeekPicker = true)}
      disabled={isCopying || isLoading}
      title="Copy advance schedules to live schedule for a chosen week"
    >
      {#if isCopying}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}{/if}
      Copy to Live
    </button>
  </div>

  <div id="advance-grid" class="border rounded-lg"></div>
</div>

<!-- Week Picker Modal -->
{#if showWeekPicker}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-sm border border-base-300 shadow-2xl">
      <h3 class="text-lg font-bold mb-1">Select Target Week</h3>
      <p class="text-xs opacity-60 mb-6">All advance records will be copied to this week in the live schedule.</p>

      <!-- Week navigator -->
      <div class="flex items-center justify-between gap-3 mb-6">
        <button class="btn btn-outline btn-sm" onclick={() => changePickerWeek(-1)}>&larr;</button>
        <div class="text-center">
          <p class="font-semibold text-sm">{getWeekRangeDisplay(selectedWeekStart)}</p>
          <p class="text-xs opacity-50">(Tue – Fri)</p>
        </div>
        <button class="btn btn-outline btn-sm" onclick={() => changePickerWeek(1)}>&rarr;</button>
      </div>

      <div class="modal-action mt-0">
        <button class="btn btn-outline btn-ghost btn-sm" onclick={() => (showWeekPicker = false)} disabled={isCopying}>
          Cancel
        </button>
        <button class="btn btn-outline btn-info btn-sm min-w-[120px]" onclick={copyToLive} disabled={isCopying}>
          {#if isCopying}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            Confirm Copy
          {/if}
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-black/40" role="presentation" onclick={() => (showWeekPicker = false)}></div>
  </dialog>
{/if}

<AdvanceModal bind:this={advanceModal} onrefresh={refreshWithScroll} />

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  #advance-grid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
    contain: strict;
  }

  #advance-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  #advance-grid :global(th:nth-child(1)),
  #advance-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #advance-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #advance-grid :global(th:nth-child(2)),
  #advance-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #advance-grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
