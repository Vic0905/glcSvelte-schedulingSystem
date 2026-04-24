<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  // import { booking, grid } from './schedule.svelte' // Ensure this store exists
  //   import GroupModal from './GroupModal.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import GrpModal from './GrpModal.svelte'

  const stickyStyles = `
    #group-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #group-grid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(1), #group-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(1) { z-index: 25; }
    #group-grid th:nth-child(2), #group-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #group-grid th:nth-child(2) { z-index: 25; }
  `

  // Anchors to Tuesday (2)
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
        pb.collection('GrpSchedule').getFullList({
          filter: `start >= "${weekStart} 00:00:00" && start <= "${weekStart} 23:59:59"`,
          expand: 'teacher,student,grouproom,timeslot',
        }),
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `date = "${nextWeekStr}"`,
          })
          .catch(() => []),
      ])

      if (!schedules.length) {
        toast.info('No group schedules found for this date')
        return
      }

      const existingSet = new Set(existingBookings.map((b) => `${b.timeslot}-${b.grouproom}-${b.teacher}`))
      const schedulesToCopy = schedules.filter((s) => !existingSet.has(`${s.timeslot}-${s.grouproom}-${s.teacher}`))

      if (!schedulesToCopy.length) {
        toast.info('All schedules already copied!')
        return
      }

      if (!confirm(`Copy ${schedulesToCopy.length} schedules to next week?`)) return

      isCopying = true
      for (const s of schedulesToCopy) {
        await pb.collection('groupAdvanceBooking').create({
          date: nextWeekStr,
          timeslot: s.timeslot,
          teacher: s.teacher,
          student: s.student,
          grouproom: s.grouproom,
          status: 'pending',
        })
      }

      toast.success('Successfully copied')
    } catch (error) {
      console.error(error)
      toast.error('Failed to copy')
    } finally {
      isCopying = false
    }
  }

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')

    const elements = [
      h('div', { class: 'badge badge-ghost badge-xs p-3 font-semibold' }, cell.subject.name || 'No Subject'),
      h('div', { class: 'badge badge-ghost badge-xs font-semibold' }, cell.teacher.name || 'No Teacher'),
    ]

    if (cell.students?.length > 0) {
      const studentNames = cell.students
        .filter((s) => s.status !== 'graduated')
        .map((s) => h('span', { class: 'badge badge-ghost badge-xs font-semibold' }, s.englishName))

      elements.push(h('div', { class: 'flex flex-wrap gap-1 justify-center' }, studentNames))
    }

    return h('div', { class: 'flex flex-col gap-1 items-center text-xs' }, elements)
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
        const promises = [
          pb.collection('timeslot').getFullList({ sort: 'start' }),
          pb.collection('groupRoom').getFullList({ sort: 'name', expand: 'teacher' }),
          pb.collection('GrpSchedule').getFullList({
            filter: `start = "${weekStart}"`,
            expand: 'teacher,student,grouproom,timeslot,subject',
            $autoCancel: false,
          }),
        ]

        const [tsList, rooms, scheds] = await Promise.all(promises)
        timeslots = tsList
        allGroupRooms = rooms
        schedules = scheds

        cache.groupSchedules = schedules
        cache.lastFetch = Date.now()
      }

      const scheduleMap = new Map()
      for (const s of schedules) {
        scheduleMap.set(`${s.grouproom}-${s.timeslot}`, s)
      }

      const data = allGroupRooms.map((gr) => {
        const defaultTeacher = gr.expand?.teacher
        const row = [
          { label: 'Teacher', value: defaultTeacher?.name || '-', disabled: true },
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
              groupRoom: { name: gr.name, id: gr.id },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: defaultTeacher,
            })
          } else {
            row.push({
              label: 'Schedule',
              id: s.id,
              date: weekStart,
              startDate: s.start || weekStart,
              endDate: s.end || weekStart,
              subject: {
                name: s.expand?.subject?.name || '',
                id: s.expand?.subject?.id || '',
              },
              teacher: {
                name: s.expand?.teacher?.name || '',
                id: s.expand?.teacher?.id || '',
              },
              students: (s.expand?.student || []).map((std) => ({
                englishName: std.englishName,
                id: std.id,
              })),
              groupRoom: { name: gr.name, id: gr.id },
              timeslot: { id: ts.id, start: ts.start, end: ts.end },
              assignedTeacher: defaultTeacher,
            })
          }
        }
        return row
      })

      if (grid.groupSchedule) {
        grid.groupSchedule.updateConfig({ data }).forceRender()
        restoreScrollPosition()
      } else {
        grid.groupSchedule = new Grid({
          columns: [
            { name: 'Teacher', width: '120px', formatter: (cell) => cell.value },
            { name: 'Group Room', width: '120px', formatter: (cell) => cell.value },
            ...timeslots.map((t) => ({
              name: `${t.start} - ${t.end}`,
              id: t.id,
              width: '180px',
              formatter: formatCell,
            })),
          ],
          data,
          className: { table: 'w-full border text-xs !border-collapse' },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('group-grid'))

        grid.groupSchedule.on('cellClick', (...args) => {
          const cellData = args[1].data
          if (cellData.disabled) return
          booking.data = { ...cellData, mode: cellData.label === 'Empty' ? 'create' : 'edit' }
          groupModal?.showModal()
        })
      }
    } catch (error) {
      console.error('Fetch Error:', error)
    } finally {
      isLoading = false
    }
  }

  onMount(() => {
    loadGroupSchedules()
    pb.collection('GrpSchedule').subscribe('*', () => {
      cache.invalidate()
      loadGroupSchedules(true)
    })
  })

  onDestroy(() => {
    abortController?.abort()
    grid.groupSchedule?.destroy()
    grid.groupSchedule = null
    pb.collection('GrpSchedule').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-4 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Group Schedule</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <button class="btn btn-ghost btn-sm gap-2" onclick={copyToAdvanceBooking} disabled={isCopying}>
      {isCopying ? 'Copying...' : 'Copy to Next Week'}
    </button>

    <h3 class="text-xl font-bold">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="join">
      <button class="btn btn-outline btn-sm join-item" onclick={() => changeWeek(-1)} disabled={isLoading}>«</button>
      <button class="btn btn-outline btn-sm join-item" onclick={() => changeWeek(1)} disabled={isLoading}>»</button>
    </div>
  </div>

  <div id="group-grid" class="border rounded-lg"></div>
</div>

<!-- <GroupModal on:refresh={() => loadGroupSchedules(true)} bind:this={groupModal} /> -->

<GrpModal on:refresh={() => loadGroupSchedules(true)} bind:this={groupModal} />
