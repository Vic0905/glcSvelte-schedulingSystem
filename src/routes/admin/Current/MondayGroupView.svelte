<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #mondayGroupGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #mondayGroupGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #mondayGroupGrid th:nth-child(1), #mondayGroupGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15; box-shadow: inset -1px 0 0 #ddd; }
    #mondayGroupGrid th:nth-child(1) { z-index: 25; }
    #mondayGroupGrid th:nth-child(2), #mondayGroupGrid td:nth-child(2) { position: sticky; left: 120px; z-index: 10; box-shadow: inset -1px 0 0 #ddd; }
    #mondayGroupGrid th:nth-child(2) { z-index: 25; }
  `

  let selectedMonday = $state(getNextMonday(new Date()))
  let groupGrid = null
  let timeslots = []
  let groupRooms = []
  let isLoading = $state(false)

  function getNextMonday(date) {
    const d = new Date(date)
    const day = d.getDay()
    // If today is Monday (1), use today. Otherwise go back to most recent Monday
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getMondayDisplay(mondayDate) {
    const date = new Date(mondayDate)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const changeWeek = (weeks) => {
    const d = new Date(selectedMonday)
    d.setDate(d.getDate() + weeks * 7)
    selectedMonday = d.toISOString().split('T')[0]
    loadMondayGroupSchedule()
  }

  const formatCell = (cellData) => {
    if (!cellData?.schedule) return h('span', {}, '—')

    const { schedule, studentName, hiddenDetails } = cellData

    // Show "Scheduled" if hiddenDetails is true
    if (hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, schedule.subject?.name ?? 'No Subject'),
      h('span', { class: 'badge badge-info badge-xs' }, schedule.teacher?.name ?? 'No Teacher'),
      h('span', { class: 'badge badge-neutral badge-xs' }, studentName),
    ])
  }

  async function loadMondayGroupSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, groupRoomsData, schedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        groupRooms.length ? groupRooms : pb.collection('grouproom').getFullList({ sort: 'name' }),
        pb.collection('mondayGroupLessonSchedule').getList(1, 500, {
          filter: `date = "${selectedMonday}"`,
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      groupRooms = groupRoomsData

      // Build schedule map
      const scheduleMap = {}
      for (const s of schedules.items) {
        const roomId = s.expand?.grouproom?.id
        const timeslotId = s.expand?.timeslot?.id
        if (!roomId || !timeslotId) continue

        scheduleMap[roomId] ??= {}
        const students = Array.isArray(s.expand?.student) ? s.expand.student : []
        const existing = scheduleMap[roomId][timeslotId]

        if (!existing || students.length > (existing.students?.length || 0)) {
          scheduleMap[roomId][timeslotId] = {
            subject: s.expand?.subject,
            teacher: s.expand?.teacher,
            students,
            hiddenDetails: s.hiddenDetails || false,
          }
        }
      }

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
              return student
                ? {
                    schedule,
                    studentName: student.englishName || 'Unknown',
                    hiddenDetails: schedule.hiddenDetails || false,
                  }
                : null
            }),
          ]
        })

        // Add a separator row after each room except the last
        if (roomIndex < groupRooms.length - 1) {
          rows.push(['', '', ...timeslots.map(() => h('div', { class: 'h-[3px] w-full rounded-full' }))])
        }

        return rows
      })

      const columns = [
        { name: 'Group Room', width: '120px' },
        { name: 'S-Slot', width: '120px' },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (groupGrid) {
        const wrapper = document.querySelector('#mondayGroupGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        groupGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#mondayGroupGrid .gridjs-wrapper')
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
        }).render(document.getElementById('mondayGroupGrid'))
      }
    } catch (error) {
      console.error('Error loading Monday group schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadMondayGroupSchedule, 150)
  }

  onMount(() => {
    loadMondayGroupSchedule()
    pb.collection('mondayGroupLessonSchedule').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', () => {
      groupRooms = []
      debouncedReload()
    })
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    groupGrid?.destroy()
    pb.collection('mondayGroupLessonSchedule').unsubscribe()
    pb.collection('grouproom').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday GRP Room Slot Table</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Select Monday:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={selectedMonday}
        class="input input-bordered input-sm w-40"
        onchange={loadMondayGroupSchedule}
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">{getMondayDisplay(selectedMonday)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span>Subject</div>
      <div class="flex gap-1"><span class="badge badge-info badge-xs"></span>Teacher</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span>Student Names</div>
    </div>
  </div>

  <div id="mondayGroupGrid" class="border rounded-lg"></div>
</div>
