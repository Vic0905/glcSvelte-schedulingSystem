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
  let selectedDate = $state(getTodayDate())
  let timeslots = $state([])
  let rooms = $state([])
  let isLoading = $state(false)

  // --- Helper Functions ---
  function getTodayDate() {
    return new Date().toISOString().split('T')[0]
  }

  function formatDateDisplay(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  // Parses the room numeric string (e.g., "A005" -> 5, "A1033" -> 1033) and returns the background Tailwind class
  function getBgClass(roomName) {
    if (!roomName) return ''

    // Convert to uppercase to handle 'g01' or 'G01' safely
    const upperRoom = roomName.toUpperCase()

    // Rule: All "G" rooms (G01 - G26) must be ONLY WHITE
    if (upperRoom.startsWith('G')) {
      return 'bg-white text-neutral-800'
    }

    // Extract numbers for the "A" rooms logic
    const num = parseInt(upperRoom.replace(/\D/g, ''), 10)
    if (isNaN(num)) return ''

    // Defined gray bands for "A" rooms
    const isGray =
      (num >= 1 && num <= 5) || // A001 - A005
      (num >= 19 && num <= 33) || // A019 - A033
      (num >= 50 && num <= 64) || // A050 - A064
      (num >= 74 && num <= 83) || // A074 - A083
      (num >= 93 && num <= 101) || // A093 - A101
      (num >= 110 && num <= 125) || // A110 - A125
      (num >= 142 && num <= 157) // A142 - A157

    return isGray ? 'bg-neutral-100/90 text-neutral-800' : 'bg-white text-neutral-800'
  }

  const changeDay = async (days) => {
    const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    selectedDate = d.toISOString().split('T')[0]

    await loadSchedules(savedScrollTop, savedScrollLeft)
  }

  const onDateChange = async (e) => {
    const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    selectedDate = e.target.value
    await loadSchedules(savedScrollTop, savedScrollLeft)
  }

  const goToToday = async () => {
    const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
    const savedScrollTop = wrapper?.scrollTop || 0
    const savedScrollLeft = wrapper?.scrollLeft || 0

    selectedDate = getTodayDate()
    await loadSchedules(savedScrollTop, savedScrollLeft)
  }

  const formatCell = (cell) => {
    const bgClass = cell?.bgClass || ''

    if (!cell || !cell.schedules || cell.schedules.length === 0) {
      return h(
        'div',
        { class: `w-full h-full min-h-[55px] flex items-center justify-center text-gray-400 ${bgClass}` },
        '—'
      )
    }

    const { schedules } = cell
    const firstSched = schedules[0]
    const subjectName = firstSched.subject?.name || 'No Subject'
    const teacherName = firstSched.teacher?.name || 'No Teacher'
    const allStudents = schedules.flatMap((s) => s.students.map((std) => std.name))

    return h('div', { class: `flex flex-col gap-1 p-2 items-center text-center w-full h-full ${bgClass}` }, [
      h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-300 mb-1 pb-1 w-full' }, [
        h('div', { class: '' }, subjectName),
        h('div', { class: 'text-[10px] uppercase mt-1 text-neutral-500' }, teacherName),
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
      const startDateStr = `${selectedDate} 00:00:00`
      const endDateStr = `${selectedDate} 23:59:59`

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

      const emptyRoomsCountMap = new Map()
      for (const tSlot of timeslots) {
        let emptyCount = 0
        for (const rm of rooms) {
          const slotSchedules = scheduleMap.get(`${rm.id}-${tSlot.id}`) || []
          if (slotSchedules.length === 0) {
            emptyCount++
          }
        }
        emptyRoomsCountMap.set(tSlot.id, emptyCount)
      }

      const data = rooms.map((room) => {
        const teacher = room.expand?.teacher
        const bgClass = getBgClass(room.name)

        const row = [
          { value: teacher?.name || '-', disabled: true, bgClass },
          { value: room.name, disabled: true, bgClass },
        ]

        for (const ts of timeslots) {
          const schedules = scheduleMap.get(`${room.id}-${ts.id}`) || []
          row.push({
            label: schedules.length ? 'Schedule' : 'Empty',
            schedules,
            room,
            timeslot: ts,
            bgClass,
          })
        }
        return row
      })

      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (c, row) =>
            h(
              'div',
              { class: `w-full h-full p-2 flex items-center justify-center text-center ${row.cells[0].data.bgClass}` },
              c.value
            ),
        },
        {
          name: 'Room',
          width: '120px',
          formatter: (c, row) =>
            h(
              'div',
              {
                class: `w-full h-full p-2 flex items-center justify-center font-semibold text-center ${row.cells[1].data.bgClass}`,
              },
              c.value
            ),
        },
        ...timeslots.map((t) => {
          const emptyCount = emptyRoomsCountMap.get(t.id) || 0
          return {
            id: t.id,
            width: '180px',
            name: h('div', { class: 'flex flex-col items-center gap-0.5' }, [
              h('span', null, `${t.start} - ${t.end}`),
              h(
                'span',
                { class: 'text-[10px] font-normal text-teal-300 bg-teal-950/40 px-1.5 py-0.5 rounded-full' },
                `${emptyCount} Available`
              ),
            ]),
            formatter: formatCell,
          }
        }),
      ]

      if (gridInstance) {
        if (savedScrollTop === null) {
          const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
          savedScrollTop = wrapper?.scrollTop || 0
          savedScrollLeft = wrapper?.scrollLeft || 0
        }

        gridInstance.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
          if (wrapper) {
            wrapper.scrollTop = savedScrollTop
            wrapper.scrollLeft = savedScrollLeft || 0
          }
        })
      } else {
        gridInstance = new Grid({
          columns,
          data,
          height: '600px',
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'text-center',
            td: 'text-center',
          },
          style: { table: { 'table-layout': 'fixed' } },
        }).render(document.getElementById('daily-grid'))

        gridInstance.on('cellClick', (...args) => {
          const cell = args[1].data
          if (cell.disabled) return

          const isCreateMode = cell.label === 'Empty'
          const firstSched = cell.schedules?.[0]

          const activeTeacher = isCreateMode ? cell.room?.expand?.teacher : firstSched?.teacher

          const modalStartDate = !isCreateMode ? firstSched?.start || selectedDate : selectedDate
          const modalEndDate = !isCreateMode ? firstSched?.end || selectedDate : selectedDate

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
    const wrapper = document.querySelector('#daily-grid .gridjs-wrapper')
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
    <h2 class="text-center flex-1">Daily Schedule (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between relative">
    <h3 class="absolute left-1/2 -translate-x-1/2 text-xl font-semibold">
      {formatDateDisplay(selectedDate)}
    </h3>

    <div class="ml-auto flex items-center gap-2">
      <button
        class="btn btn-outline btn-sm"
        onclick={goToToday}
        disabled={isLoading || selectedDate === getTodayDate()}
      >
        Today
      </button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(-1)} disabled={isLoading}>&larr;</button>
      <input
        type="date"
        class="input input-bordered input-sm"
        value={selectedDate}
        onchange={onDateChange}
        disabled={isLoading}
      />
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div id="daily-grid" class="border rounded-lg"></div>
</div>

<CombineModal bind:this={combineModal} onrefresh={refreshWithScroll} />

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }

  #daily-grid :global(.gridjs-table td:hover > div) {
    background-color: #d1fae5 !important;
    transition: background-color 0.2s ease;
    cursor: pointer;
  }

  #daily-grid :global(.gridjs-wrapper) {
    max-height: 650px;
    overflow: auto;
    contain: strict;
  }

  /* Zero out padding on td to let background divs fill full width/height completely */
  #daily-grid :global(td) {
    padding: 0 !important;
    vertical-align: stretch;
  }

  #daily-grid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: 0 1px 0 #ddd;
    background-color: #484b4f;
    color: #ffffff;
  }

  #daily-grid :global(th:nth-child(1)),
  #daily-grid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #daily-grid :global(th:nth-child(1)) {
    z-index: 25;
  }

  #daily-grid :global(th:nth-child(2)),
  #daily-grid :global(td:nth-child(2)) {
    position: sticky;
    left: 120px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
  }

  #daily-grid :global(th:nth-child(2)) {
    z-index: 25;
  }
</style>
