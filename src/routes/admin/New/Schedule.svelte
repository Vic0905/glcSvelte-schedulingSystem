<script>
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

  const stickyStyles = `
    #unified-grid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #unified-grid th { 
      position: sticky; 
      top: 0; 
      z-index: 20; 
      background-color: #484b4f;
      color: #fff;
    }
    #unified-grid th:nth-child(1), #unified-grid td:nth-child(1) { position: sticky; left: 0; z-index: 15; background-color: #f9fafb; }
    #unified-grid th:nth-child(1) { z-index: 25; background-color: #484b4f; }
    #unified-grid th:nth-child(2), #unified-grid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; background-color: #f9fafb; }
    #unified-grid th:nth-child(2) { z-index: 25; background-color: #484b4f; }
  `

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
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
    await loadSchedules()
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
      h('div', { class: 'font-bold text-neutral-700 border-b border-base-300 mb-1 pb-1 w-full' }, [
        h('div', { class: '' }, subjectName),
        h('div', { class: 'text-[10px] uppercase' }, teacherName),
      ]),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-1' },
        allStudents.map((name) => h('span', { class: 'badge badge-ghost badge-xs whitespace-nowrap' }, name))
      ),
    ])
  }

  async function loadSchedules() {
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
        // --- SCROLL RESTORATION LOGIC ---
        // 1. Capture current scroll position
        const wrapper = document.querySelector('#unified-grid .gridjs-wrapper')
        const scrollTop = wrapper ? wrapper.scrollTop : 0
        const scrollLeft = wrapper ? wrapper.scrollLeft : 0

        // 2. Update and re-render
        gridInstance.updateConfig({ data }).forceRender()

        // 3. Restore scroll position after the DOM has updated
        requestAnimationFrame(() => {
          const newWrapper = document.querySelector('#unified-grid .gridjs-wrapper')
          if (newWrapper) {
            newWrapper.scrollTop = scrollTop
            newWrapper.scrollLeft = scrollLeft
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
          className: { table: 'w-full border text-xs !border-collapse' },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('unified-grid'))

        gridInstance.on('cellClick', (...args) => {
          const cell = args[1].data
          if (cell.disabled) return

          const endDate = new Date(weekStart)
          endDate.setDate(endDate.getDate() + 3)

          combineModal.open({
            room: cell.room,
            timeslot: cell.timeslot,
            startDate: weekStart,
            endDate: endDate.toISOString().split('T')[0],
            mode: cell.label === 'Empty' ? 'create' : 'edit',
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

  $effect(() => {
    loadSchedules()
    return () => {
      gridInstance?.destroy()
    }
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-2 sm:p-4 md:p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Current Schedule (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between relative">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="ml-auto flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}>&rarr;</button>
    </div>
  </div>

  <div id="unified-grid" class="border rounded-lg"></div>
</div>

<CombineModal bind:this={combineModal} onrefresh={loadSchedules} />
