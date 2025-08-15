<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'
  import { booking, grid } from './schedule.svelte'
  import ScheduleModal from './scheduleModal.svelte'

  let date = $state(new Date().toISOString().split('T')[0])
  let timeslots = []

  // Duplicate modal state
  let showDuplicateModal = $state(false)
  let duplicateStartDate = $state('')
  let duplicateEndDate = $state('')
  let isLoading = $state(false)

  const changeDate = (days) => {
    const currentDate = new Date(date)
    currentDate.setDate(currentDate.getDate() + days)
    date = currentDate.toISOString().split('T')[0]
    loadSchedules()
  }

  const createBadge = (text, colorClass) => h('div', { class: `badge ${colorClass} badge-xs` }, text)

  const formatCell = (cell) => {
    if (!cell || cell.label === 'Empty') return h('span', {}, '—')
    return h(
      'div',
      {
        class: 'w-full max-w-full rounded p-2 flex flex-col gap-1 text-xs justify-center items-left whitespace-nowrap',
      },
      [
        createBadge(cell.subject.name, 'badge-primary'),
        createBadge(cell.teacher.name, 'badge-success'),
        createBadge(cell.student.name, 'badge-accent'),
        createBadge(cell.room.name, 'badge-error'),
      ]
    )
  }

  const createSlotData = (item, room, roomId, t, assignedTeacher) => ({
    label: item ? 'Schedule' : 'Empty',
    id: item?.id || '',
    date,
    subject: { name: item?.expand?.subject?.name || '', id: item?.expand?.subject?.id || '' },
    teacher: { name: item?.expand?.teacher?.name || '', id: item?.expand?.teacher?.id || '' },
    student: { name: item?.expand?.student?.name || '', id: item?.expand?.student?.id || '' },
    room: { name: room, id: roomId },
    timeslot: { id: t.id, start: t.start, end: t.end },
    assignedTeacher: assignedTeacher, // Pass the room's assigned teacher
  })

  // Function to get all weekdays between start and end date (skip weekends)
  const getDatesBetween = (startDate, endDate) => {
    const dates = []
    const currentDate = new Date(startDate)
    const end = new Date(endDate)

    while (currentDate <= end) {
      const dayOfWeek = currentDate.getDay() // 0 = Sunday, 6 = Saturday
      // Only include weekdays (Monday = 1 through Friday = 5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        dates.push(new Date(currentDate).toISOString().split('T')[0])
      }
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return dates
  }

  // Function to duplicate schedules for selected date range
  const duplicateSchedule = async () => {
    if (!duplicateStartDate || !duplicateEndDate) {
      toast.error('Please select both start and end dates')
      return
    }

    if (new Date(duplicateStartDate) > new Date(duplicateEndDate)) {
      toast.error('Start date must be before or equal to end date')
      return
    }

    try {
      isLoading = true

      // Get all schedules for the currently selected date
      const sourceSchedules = await pb.collection('lessonSchedule').getFullList({
        filter: `date = "${date}"`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (sourceSchedules.length === 0) {
        toast.error('No schedules found for the selected date to duplicate')
        return
      }

      // Get target dates
      const targetDates = getDatesBetween(duplicateStartDate, duplicateEndDate)

      let duplicatedCount = 0
      let skippedCount = 0

      for (const targetDate of targetDates) {
        // Skip if target date is the same as source date
        if (targetDate === date) {
          skippedCount += sourceSchedules.length
          continue
        }

        // Check existing schedules for target date to avoid duplicates
        const existingSchedules = await pb.collection('lessonSchedule').getFullList({
          filter: `date = "${targetDate}"`,
        })

        const existingKeys = new Set(
          existingSchedules.map((s) => `${s.teacher}-${s.student}-${s.subject}-${s.room}-${s.timeslot}`)
        )

        // Create schedules
        for (const schedule of sourceSchedules) {
          const scheduleKey = `${schedule.teacher}-${schedule.student}-${schedule.subject}-${schedule.room}-${schedule.timeslot}`

          // Skip if schedule already exists for this date
          if (existingKeys.has(scheduleKey)) {
            skippedCount++
            continue
          }

          // Create new schedule record with the same teacher as original
          const newSchedule = {
            date: targetDate,
            teacher: schedule.teacher,
            student: schedule.student,
            subject: schedule.subject,
            room: schedule.room,
            timeslot: schedule.timeslot,
            status: schedule.status || 'scheduled',
            notes: schedule.notes || '',
          }

          await pb.collection('lessonSchedule').create(newSchedule)
          duplicatedCount++
        }
      }

      toast.success(
        `Successfully duplicated ${duplicatedCount} schedules. ${skippedCount > 0 ? `Skipped ${skippedCount} existing schedules.` : ''}`
      )

      // Reset modal
      showDuplicateModal = false
      duplicateStartDate = ''
      duplicateEndDate = ''

      // Refresh current view if we're looking at one of the target dates
      if (targetDates.includes(date)) {
        loadSchedules()
      }
    } catch (error) {
      console.error('Error duplicating schedules:', error)
      toast.error(`Failed to duplicate schedules: ${error.message}`)
    } finally {
      isLoading = false
    }
  }

  async function loadSchedules() {
    if (!timeslots.length) {
      timeslots = await pb.collection('timeSlot').getFullList({ sort: 'start' })
    }

    // Get all rooms with their assigned teachers
    const allRooms = await pb.collection('room').getFullList({
      sort: 'name',
      expand: 'teacher', // Expand to get assigned teacher information
    })

    const records = await pb.collection('lessonSchedule').getFullList({
      filter: `date = "${date}"`,
      expand: 'teacher,student,subject,room,timeslot',
    })

    // Group schedules by room
    const scheduledRooms = {}
    records.forEach((r) => {
      const roomId = r.expand.room.id
      if (!scheduledRooms[roomId]) {
        scheduledRooms[roomId] = {}
      }
      scheduledRooms[roomId][r.expand.timeslot.id] = r
    })

    // Create data for all rooms (including empty ones)
    const data = allRooms.map((room) => {
      const slotMap = scheduledRooms[room.id] || {}

      // Get the assigned teacher from the room data
      const assignedTeacher = room.expand?.teacher
      const teacherName = assignedTeacher?.name || '-'

      const row = [
        { label: 'Teacher', value: teacherName, disabled: true },
        { label: 'Room', value: room.name, disabled: true },
      ]

      timeslots.forEach((t) => {
        const item = slotMap[t.id]
        row.push(createSlotData(item, room.name, room.id, t, assignedTeacher))
      })

      return row
    })

    // Build columns once
    if (!grid.columns) {
      grid.columns = [
        {
          name: 'Teacher',
          formatter: (cell) => {
            if (cell.disabled) {
              return h(
                'span',
                {
                  class: 'cursor-not-allowed',
                  style: 'pointer-events: none;',
                },
                cell.value
              )
            }
            return cell.value
          },
          hidden: false,
        },
        {
          name: 'Room',
          formatter: (cell) => {
            if (cell.disabled) {
              return h(
                'span',
                {
                  class: 'cursor-not-allowed',
                  style: 'pointer-events: none;',
                },
                cell.value
              )
            }
            return cell.value
          },
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          id: t.id,
          width: 'auto',
          formatter: formatCell,
        })),
      ]
    }

    // Grid reuse or create
    if (grid.schedule) {
      requestAnimationFrame(() => {
        grid.schedule.updateConfig({ data }).forceRender()
      })
    } else {
      grid.schedule = new Grid({
        columns: grid.columns,
        data,
        search: {
          enabled: true,
          selector: (cell) => {
            if (typeof cell === 'string') return cell
            return cell?.value || ''
          },
        },
        sort: false,
        pagination: false,
        autoWidth: true,
        className: {
          table: 'w-full border text-sm relative',
          th: 'bg-base-200 p-2 border text-center sticky top-0 z-10',
          td: 'border p-2 whitespace-pre-line align-middle text-left font-semibold',
        },
      }).render(document.getElementById('grid'))

      grid.schedule.on('cellClick', (...args) => {
        const cellData = args[1].data

        // Check if the cell is disabled and return early if it is
        if (cellData.disabled === true) {
          return // Don't do anything for disabled cells
        }

        console.log(args)

        Object.assign(booking.data, cellData)
        booking.data.startDate = cellData.date
        booking.data.endDate = cellData.date
        booking.data.timeslot.id = cellData.timeslot?.id || ''
        booking.data.room.id = cellData.room?.id || ''
        booking.data.mode = cellData.label === 'Empty' ? 'create' : 'edit'

        // Set the assigned teacher as default when creating new schedule
        if (cellData.label === 'Empty' && cellData.assignedTeacher) {
          booking.data.teacher.id = cellData.assignedTeacher.id
          booking.data.teacher.name = cellData.assignedTeacher.name
        }

        console.log(args)
        editModal.showModal()
      })
    }
  }

  onMount(() => {
    if (grid.schedule) {
      grid.schedule.destroy()
      grid.schedule = null
    }
    loadSchedules()
  })
</script>

<div class="p-6 max-w-auto mx-auto bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold text-primary">Room</h2>
    <h2 class="text-2xl font-bold text-primary text-center flex-1">Advance Schedule Table</h2>
  </div>

  <!-- Filter row -->
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Filter Date:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={date}
        class="input input-bordered input-sm w-40"
        onchange={loadSchedules}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center">
      {new Date(date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })} - {new Date(date).toLocaleDateString('en-US', { weekday: 'long' })}
    </h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(-1)}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDate(1)}>&rarr;</button>

      <!-- Duplicate Schedule Button -->
      <button class="btn btn-primary btn-sm" onclick={() => (showDuplicateModal = true)}>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        Duplicate Schedule
      </button>
    </div>
  </div>

  <div id="grid" class="overflow-auto max-h-[700px]"></div>
</div>

<!-- Duplicate Schedule Modal -->
{#if showDuplicateModal}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">Duplicate Schedule</h3>
      <p class="text-sm text-gray-600 mb-4">
        Duplicate schedules from <strong>{new Date(date).toLocaleDateString()}</strong> to selected weekday range (weekends
        will be skipped)
      </p>

      <div class="space-y-4">
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">Start Date</span>
          </label>
          <input
            type="date"
            bind:value={duplicateStartDate}
            class="input input-bordered w-full"
            min={new Date().toISOString().split('T')[0]}
          />
        </div>

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">End Date</span>
          </label>
          <input
            type="date"
            bind:value={duplicateEndDate}
            class="input input-bordered w-full"
            min={duplicateStartDate || new Date().toISOString().split('T')[0]}
          />
        </div>

        {#if duplicateStartDate && duplicateEndDate}
          <div class="alert alert-info">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="stroke-current shrink-0 w-6 h-6"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span>
              Will duplicate to {getDatesBetween(duplicateStartDate, duplicateEndDate).length} weekday(s) (skipping weekends)
              {getDatesBetween(duplicateStartDate, duplicateEndDate).includes(date) ? '(excluding source date)' : ''}
            </span>
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => {
            showDuplicateModal = false
            duplicateStartDate = ''
            duplicateEndDate = ''
          }}
          disabled={isLoading}
        >
          Cancel
        </button>
        <button
          class="btn btn-primary"
          onclick={duplicateSchedule}
          disabled={!duplicateStartDate || !duplicateEndDate || isLoading}
        >
          {#if isLoading}
            <span class="loading loading-spinner loading-sm"></span>
            Duplicating...
          {:else}
            Duplicate
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<ScheduleModal on:refresh={loadSchedules} />

<style>
  /* Add minimum height to prevent shaking when data changes */
  .gridjs-td {
    min-height: 120px;
  }
</style>
