<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import CombineModal from './combineModal.svelte'

  // --- State Runes ---
  let todayHoliday = $state(null)
  let combineModal = $state()
  let gridInstance = $state(null)
  // With this:
  function getInitialDate() {
    const hash = window.location.hash // e.g. "#/new/dailyschedule?date=2026-06-03"
    const queryString = hash.includes('?') ? hash.split('?')[1] : ''
    const params = new URLSearchParams(queryString)
    const dateParam = params.get('date')
    return dateParam || getTodayDate()
  }

  let selectedDate = $state(getInitialDate())
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

    return isGray ? 'bg-neutral-200/90 text-neutral-800' : 'bg-white text-neutral-800'
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

      const [ts, roomList, sched, holidayRecords] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('roomType').getFullList({ sort: 'name', expand: 'teacher', filter: 'roomType = "mtm"' }),
        pb.collection('schedule').getFullList({
          filter: `start <= "${endDateStr}" && end >= "${startDateStr}"`,
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('holiday').getFullList({ fields: 'id,name,date' }),
      ])

      // Check if selected date is a holiday
      // Replace the early-return holiday block with:
      const foundHoliday = holidayRecords.find((h) => h.date?.split(' ')[0] === selectedDate)
      todayHoliday = foundHoliday || null

      if (todayHoliday) {
        toast.info(`${selectedDate} is a holiday: ${todayHoliday.name}. No schedules to display.`)
        timeslots = []
        rooms = []
        if (gridInstance) {
          gridInstance.destroy()
          gridInstance = null
        }
        // isLoading = false
        return
      }

      timeslots = ts
      rooms = roomList

      // After (correct) — only drops schedule if selectedDate itself is a holiday
      // (which is already handled by the early return above, so this filter
      //  is actually not needed at all — just map directly)
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
          if (slotSchedules.length === 0) emptyCount++
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
              h('span', { class: 'text-[10px] font-bold badge badge-success badge-xs' }, `${emptyCount} Available`),
            ]),
            formatter: formatCell,
          }
        }),
      ]

      await tick() // Wait for DOM to update before manipulating the grid

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
  const clearDay = async () => {
    if (!confirm(`Clear all schedules for ${formatDateDisplay(selectedDate)}? This cannot be undone.`)) return

    if (isLoading) return
    isLoading = true

    try {
      const startDateStr = `${selectedDate} 00:00:00`
      const endDateStr = `${selectedDate} 23:59:59`

      // Fetch all schedule records that overlap this day
      const records = await pb.collection('schedule').getFullList({
        filter: `start <= "${endDateStr}" && end >= "${startDateStr}"`,
        fields: 'id,start,end,timeslot,room,teacher,subject,student',
      })

      if (records.length === 0) {
        toast.info('No schedules to clear for this day.')
        isLoading = false
        return
      }

      const batch = pb.createBatch()

      for (const rec of records) {
        const recStart = rec.start.split(' ')[0]
        const recEnd = rec.end.split(' ')[0]
        const isSingleDay = recStart === recEnd

        if (isSingleDay || (recStart === selectedDate && recEnd === selectedDate)) {
          // Case 1: single-day record — just delete
          batch.collection('schedule').delete(rec.id)
        } else if (recStart === selectedDate) {
          // Case 2: selected day is the start — push start forward by 1
          const nextDay = new Date(selectedDate)
          nextDay.setDate(nextDay.getDate() + 1)
          const newStart = nextDay.toISOString().split('T')[0]
          batch.collection('schedule').update(rec.id, {
            start: `${newStart} 00:00:00.000Z`,
          })
        } else if (recEnd === selectedDate) {
          // Case 3: selected day is the end — pull end back by 1
          const prevDay = new Date(selectedDate)
          prevDay.setDate(prevDay.getDate() - 1)
          const newEnd = prevDay.toISOString().split('T')[0]
          batch.collection('schedule').update(rec.id, {
            end: `${newEnd} 00:00:00.000Z`,
          })
        } else {
          // Case 4: selected day is in the middle — split into two records
          const prevDay = new Date(selectedDate)
          prevDay.setDate(prevDay.getDate() - 1)
          const newEnd = prevDay.toISOString().split('T')[0]

          const nextDay = new Date(selectedDate)
          nextDay.setDate(nextDay.getDate() + 1)
          const newStart = nextDay.toISOString().split('T')[0]

          // Update original to be the "before" segment
          batch.collection('schedule').update(rec.id, {
            end: `${newEnd} 00:00:00.000Z`,
          })

          // Create the "after" segment
          batch.collection('schedule').create({
            timeslot: rec.timeslot,
            room: rec.room,
            teacher: rec.teacher,
            subject: rec.subject,
            student: rec.student,
            start: `${newStart} 00:00:00.000Z`,
            end: `${recEnd} 00:00:00.000Z`,
          })
        }
      }

      await batch.send()
      toast.success(`Cleared ${records.length} schedule record(s) for ${selectedDate}`)
      isLoading = false
      await refreshWithScroll()
    } catch (err) {
      console.error(err)
      toast.error('Failed to clear schedules for this day')
    } finally {
      isLoading = false
    }
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
    <h2 class="text-center flex-1">Daily MTM Schedule</h2>
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
      <button class="btn btn-outline btn-error btn-sm" onclick={clearDay} disabled={isLoading}> Clear Day </button>
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

  {#if todayHoliday}
    <div class="border rounded-lg flex items-center justify-center py-16">
      <div class="text-center">
        <div class="text-4xl mb-3">🎉</div>
        <h3 class="text-xl font-bold text-neutral-700">{todayHoliday.name}</h3>
        <p class="text-sm text-neutral-400 mt-1">No classes scheduled for {formatDateDisplay(selectedDate)}</p>
      </div>
    </div>
  {:else}
    <div id="daily-grid" class="border rounded-lg"></div>
  {/if}
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
