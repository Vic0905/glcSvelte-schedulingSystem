<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let groupGrid = null
  let timeslots = $state([])
  let groupRooms = []

  function getCurrentDateDisplay() {
    const today = new Date()
    const day = today.getDay()

    // Get Tuesday (2) of the current week
    const tuesday = new Date(today)
    tuesday.setDate(today.getDate() + (day === 0 ? 2 : 2 - day))

    // Friday is 3 days after Tuesday
    const friday = new Date(tuesday)
    friday.setDate(tuesday.getDate() + 3)

    // Format output
    const format = (date, showYear = true) =>
      date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        ...(showYear && { year: 'numeric' }),
      })

    return tuesday.getMonth() === friday.getMonth() && tuesday.getFullYear() === friday.getFullYear()
      ? `${format(tuesday, false)} - ${friday.getDate()}, ${friday.getFullYear()}`
      : `${format(tuesday)} - ${format(friday)}`
  }

  // --- Toast Handler ---
  function handleToast(e, label = 'Schedule') {
    const messages = { create: `${label} created`, update: `${label} updated`, delete: `${label} deleted` }
    const types = { create: toast.success, update: toast.info, delete: toast.error }
    if (types[e.action]) types[e.action](messages[e.action])
  }

  const formatCell = (cellData) => {
    if (!cellData?.schedule) return h('span', {}, '—')
    const { schedule, studentName } = cellData
    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3 font-semibold' }, schedule.subject?.name ?? 'No Subject'),
      h('span', { class: 'badge badge-neutral badge-xs' }, studentName),
      h('span', { class: 'badge badge-error badge-xs' }, schedule.teacher?.name ?? 'No Teacher'),
    ])
  }

  async function loadTimeslots() {
    try {
      const timeslotsData = await pb.collection('timeSlot').getFullList({ sort: 'start' })
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading timeslots:', error)
      toast.error('Failed to load timeslots')
    }
  }

  async function loadGroupSchedule() {
    try {
      if (timeslots.length === 0) {
        await loadTimeslots()
      }

      const [groupRoomsData, bookings] = await Promise.all([
        groupRooms.length ? groupRooms : pb.collection('grouproom').getFullList({ sort: 'name' }),
        pb.collection('groupAdvanceBooking').getFullList({
          // CHANGED: getList to getFullList
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      groupRooms = groupRoomsData

      const scheduleMap = {}
      for (const b of bookings) {
        // CHANGED: No .
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

      if (timeslots.length === 0) {
        console.warn('No timeslots available')
        return
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
              return student ? { schedule, studentName: student.englishName || student.name || 'Unknown' } : null
            }),
          ]
        })

        // In the loadGroupSchedule function:
        if (roomIndex < groupRooms.length - 1) {
          // Add a separator row with room name
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
                class: 'h-[1px] w-full bg-gradient-to-r from-transparent via-primary/20 to-transparent my-1',
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
          pagination: false,
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'bg-base-200 p-2 border-t border-d !border-x-0 text-center',
            td: 'border-t border-d !border-x-0 p-2 text-center align-middle',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('groupGrid'))
      }
    } catch (error) {
      console.error('Error loading group schedule:', error)
      toast.error('Failed to load group schedule')
    }
  }

  let reloadTimeout

  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadGroupSchedule, 150)
  }

  onMount(() => {
    loadGroupSchedule()

    const sub1 = pb.collection('groupAdvanceBooking').subscribe('*', (e) => {
      handleToast(e, 'Group Booking')
      debouncedReload()
    })

    const sub2 = pb.collection('grouproom').subscribe('*', (e) => {
      handleToast(e, 'Group Room')
      debouncedReload()
    })

    return () => {
      sub1.then((u) => u())
      sub2.then((u) => u())
      groupGrid?.destroy()
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="mb-4 text-2xl font-bold">
    <h2 class="text-center">GRP Room Slot Table (Advance Template)</h2>
  </div>

  <div class="mb-6">
    <h3 class="text-xl font-semibold text-center">{getCurrentDateDisplay()}</h3>
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

  <div id="groupGrid" class="border rounded-lg"></div>
</div>

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
