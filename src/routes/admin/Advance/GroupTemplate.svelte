<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #groupGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #groupGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #groupGrid th:nth-child(1), #groupGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #groupGrid th:nth-child(1) { z-index: 25; }
    #groupGrid th:nth-child(2), #groupGrid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #groupGrid th:nth-child(2) { z-index: 25; }
  `

  let weekStart = $state(getWeekStart(new Date()))
  let groupGrid = null
  let timeslots = []
  let groupRooms = []
  let isLoading = $state(false)

  function getWeekStart(date) {
    const d = new Date(date)
    const diff = d.getDay() === 0 ? -5 : d.getDay() === 1 ? 1 : 2 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekDays(startDate) {
    const start = new Date(startDate)
    return Array.from({ length: 4 }, (_, i) => {
      const day = new Date(start)
      day.setDate(start.getDate() + i)
      return day.toISOString().split('T')[0]
    })
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)
    return `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const changeWeek = (weeks) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)
  }

  const formatCell = (cellData) => {
    if (!cellData?.schedule) return h('span', {}, '—')
    const { schedule, studentName } = cellData
    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, schedule.subject?.name ?? 'No Subject'),
      h('span', { class: 'badge badge-info badge-xs' }, schedule.teacher?.name ?? 'No Teacher'),
      h('span', { class: 'badge badge-neutral badge-xs' }, studentName),
    ])
  }

  async function loadGroupSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const weekDays = getWeekDays(weekStart)
      const dateFilter = weekDays.map((d) => `date = "${d}"`).join(' || ')

      const [timeslotsData, groupRoomsData, bookings] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        groupRooms.length ? groupRooms : pb.collection('grouproom').getFullList({ sort: 'name' }),
        pb.collection('groupAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      groupRooms = groupRoomsData

      // Build schedule map
      const scheduleMap = {}
      for (const b of bookings.items) {
        const roomId = b.expand?.grouproom?.id
        const timeslotId = b.expand?.timeslot?.id
        if (!roomId || !timeslotId) continue

        scheduleMap[roomId] ??= {}
        const students = Array.isArray(b.expand?.student) ? b.expand.student : []
        scheduleMap[roomId][timeslotId] = {
          subject: b.expand?.subject,
          teacher: b.expand?.teacher,
          students,
        }
      }

      // Build table data
      const data = groupRooms.flatMap((room, roomIndex) => {
        const maxSlots = Math.min(room.maxstudents || 30, 50)
        const roomSchedule = scheduleMap[room.id] || {}

        const rows = Array.from({ length: maxSlots }, (_, i) => {
          const slot = i + 1
          return [
            room.name,
            `Slot ${slot}`,
            ...timeslots.map((ts) => {
              const schedule = roomSchedule[ts.id]
              const student = schedule?.students?.[i]
              return student ? { schedule, studentName: student.englishName || student.name || 'Unknown' } : null
            }),
          ]
        })

        // 🟩 Add a colored separator after each room except the last
        if (roomIndex < groupRooms.length - 1) {
          // You can switch bg-primary → bg-secondary or bg-neutral if you prefer
          rows.push([
            '', // Group Room column
            '', // Slot column
            ...timeslots.map(() =>
              h('div', {
                class: 'h-[4px] w-full rounded-full opacity-70 my-1', // <-- Change color here
              })
            ),
          ])
        }

        return rows
      })

      const columns = [
        { name: 'Group Room', width: '120px' },
        { name: 'S-Slot', width: '120px' },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (groupGrid) {
        const wrapper = document.querySelector('#groupGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        groupGrid.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#groupGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        groupGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: { enabled: true, limit: 100, summary: false },
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 text-center align-middle',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('groupGrid'))
      }
    } catch (error) {
      console.error('Error loading group schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadGroupSchedule, 150)
  }

  onMount(() => {
    loadGroupSchedule()
    pb.collection('groupAdvanceBooking').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', () => {
      groupRooms = []
      debouncedReload()
    })
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    groupGrid?.destroy()
    groupGrid = null
    pb.collection('groupAdvanceBooking').unsubscribe()
    pb.collection('grouproom').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">GRP Room Slot Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Week Starting:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={weekStart}
        class="input input-bordered input-sm w-40"
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">{getWeekRangeDisplay(weekStart)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-info badge-xs"></div>
        <span>Teacher</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student Names</span>
      </div>
    </div>
  </div>

  <div id="groupGrid" class="border rounded-lg"></div>
</div>
