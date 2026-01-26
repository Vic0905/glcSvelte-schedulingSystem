<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  const stickyStyles = `
    #groupGrid .gridjs-wrapper { 
      max-height: 700px; 
      overflow: auto;
      scroll-behavior: auto !important; 
    }
    
    #groupGrid table {
      border-collapse: collapse !important:
    }

    #groupGrid th { 
      position: sticky; 
      top: 0; 
      z-index: 20; 
      background: var(--b2, #fafcff);
      outline: 1px solid #ddd;
      outline-offset: -1px;
    }

    #groupGrid th:nth-child(1), 
    #groupGrid td:nth-child(1) { 
      position: sticky; 
      left: 0; 
      z-index: 15; 
      background: var(--b2, #fafcff);
      outline: 1px solid #ddd;
      outline-offset: -1px; 
    }

    #groupGrid th:nth-child(1) { 
      z-index: 25; 
    }

    #groupGrid th:nth-child(2), 
    #groupGrid td:nth-child(2) { 
      position: sticky; 
      left: 120px; 
      z-index: 10; 
      background: var(--b2, #fafcff);
      outline: 1px solid #ddd;
      outline-offset: -1px; 
    }

    #groupGrid th:nth-child(2) { 
      z-index: 25; 
    }

    #groupGrid td {
      border-bottom: 1px solid #eee !important;
    }

    #groupGrid th:nth-child(2),
    #groupGrid td:nth-child(2) {
      border-left: none !important;
      margin-left: -1px; 
  }
  `

  let groupGrid = null
  let timeslots = $state([])
  let groupRooms = []

  function getCurrentDateDisplay() {
    const today = new Date()
    return today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatCell = (cellData) => {
    if (!cellData?.schedule) return h('span', {}, '—')
    const { schedule, studentName } = cellData
    return h('div', { class: 'text-xs flex flex-col gap-1 items-center' }, [
      h('span', { class: 'badge badge-primary badge-xs p-3' }, schedule.subject?.name ?? 'No Subject'),
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
        // CHANGED: No .items
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
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 text-center align-middle',
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
    loadTimeslots().then(() => {
      loadGroupSchedule()
    })

    pb.collection('groupAdvanceBooking').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New group booking added')
      } else if (e.action === 'update') {
        toast.info('Group booking updated')
      } else if (e.action === 'delete') {
        toast.warning('Group booking removed')
      }
      debouncedReload()
    })

    pb.collection('grouproom').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New group room added')
      } else if (e.action === 'update') {
        toast.info('Group room updated')
      } else if (e.action === 'delete') {
        toast.warning('Group room removed')
      }
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
