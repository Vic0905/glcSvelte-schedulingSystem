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

  let mondayGroupGrid = null
  let timeslots = []
  let groupRooms = []
  let isLoading = $state(false)

  // Get Monday of current week (always shows Monday regardless of today's day)
  function getMondayDateDisplay() {
    const today = new Date()
    const day = today.getDay() // 0 = Sunday, 1 = Monday, etc.

    // Calculate difference to get to Monday (Monday is 1)
    // If today is Sunday (0), go back 6 days. If today is Monday (1), no change.
    // If today is Tuesday (2), go back 1 day, etc.
    const diff = day === 0 ? 6 : day - 1

    const monday = new Date(today)
    monday.setDate(today.getDate() - diff)

    return {
      display: monday.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      dateObj: monday,
    }
  }

  const formatCell = (cellData) => {
    if (!cellData?.schedule) return h('span', {}, '—')
    const { schedule, studentName, hiddenDetails } = cellData

    //show "Scheduled" if hiddenDetails is true
    if (hiddenDetails) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, schedule.subject?.name ?? 'No Subject'),
      h('span', { class: 'badge badge-neutral badge-xs' }, studentName),
      h('span', { class: 'badge badge-error badge-xs' }, schedule.teacher?.name ?? 'No Teacher'),
    ])
  }

  async function loadMondayGroupSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const mondayDate = getMondayDateDisplay()

      const [timeslotsData, groupRoomsData, bookings] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        groupRooms.length ? groupRooms : pb.collection('grouproom').getFullList({ sort: 'name' }),
        pb.collection('mondayAdvanceGroupBooking').getList(1, 500, {
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
          hiddenDetails: b.hiddenDetails || false,
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

        // Add a separator after each room except the last
        if (roomIndex < groupRooms.length - 1) {
          rows.push([
            h(
              'div',
              {
                class: 'text-xs font-bold italic opacity-80',
                innerHTML: `┄┄┄ ${room.name} end ┄┄┄`,
              },
              ''
            ),
            '',
            ...timeslots.map(() =>
              h('div', {
                class: 'h-[4px] w-full rounded-full opacity-70 my-1',
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

      if (mondayGroupGrid) {
        const wrapper = document.querySelector('#mondayGroupGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        mondayGroupGrid.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#mondayGroupGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        mondayGroupGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
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
    pb.collection('mondayAdvanceGroupBooking').subscribe('*', debouncedReload)
    pb.collection('grouproom').subscribe('*', () => {
      groupRooms = []
      debouncedReload()
    })
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    mondayGroupGrid?.destroy()
    mondayGroupGrid = null
    pb.collection('mondayAdvanceGroupBooking').unsubscribe()
    pb.collection('grouproom').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Monday GRP Room Slot Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-6">
    <!-- Simplified display showing Monday of current week -->
    <h3 class="text-xl font-semibold text-center">{getMondayDateDisplay().display}</h3>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
    <div class="flex flex-wrap gap-4 text-xs">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Teacher</span>
      </div>
    </div>
  </div>

  <div id="mondayGroupGrid" class="border rounded-lg"></div>
</div>
