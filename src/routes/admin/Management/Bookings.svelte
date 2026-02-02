<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let currentDate = $state(new Date().toISOString().split('T')[0])
  let timeslots = $state([])
  let bookingsGrid = null
  let totalBookingsToday = $state(0)
  let schedulesData = $state([])
  let selectedTimeslots = $state(new Set())
  let showTimeslotSelector = $state(false)

  const getDateDisplay = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const changeDate = (days) => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + days)
    currentDate = d.toISOString().split('T')[0]
    loadBookings()
  }

  const formatCell = (count) => {
    return h('div', { class: 'p-3' }, [
      h('div', { class: count > 0 ? 'text-2xl font-bold' : 'text-xl text-gray-400' }, count || '—'),
    ])
  }

  // Toggle timeslot selection
  function toggleTimeslot(timeslotId) {
    const newSet = new Set(selectedTimeslots)
    if (newSet.has(timeslotId)) {
      newSet.delete(timeslotId)
    } else {
      newSet.add(timeslotId)
    }
    selectedTimeslots = newSet
  }

  // Select all timeslots
  function selectAllTimeslots() {
    const newSet = new Set()
    timeslots.forEach((t) => newSet.add(t.id))
    selectedTimeslots = newSet
  }

  // Clear all timeslot selections
  function clearAllTimeslots() {
    selectedTimeslots = new Set()
  }

  async function loadBookings() {
    try {
      const [slots, schedules] = await Promise.all([
        timeslots.length ? Promise.resolve(timeslots) : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        pb.collection('lessonSchedule').getFullList({
          filter: `date = "${currentDate}"`,
          expand: 'student,teacher,subject,room,timeslot',
        }),
      ])

      if (!timeslots.length) {
        timeslots = slots
        // Auto-select all timeslots initially
        selectAllTimeslots()
      }

      schedulesData = schedules
      totalBookingsToday = schedules.length

      const counts = new Map(timeslots.map((t) => [t.id, 0]))
      schedules.forEach((s) => counts.has(s.timeslot) && counts.set(s.timeslot, counts.get(s.timeslot) + 1))

      const columns = timeslots.map((t) => ({
        name: `${t.start} - ${t.end}`,
        width: '150px',
        formatter: (cell) => formatCell(cell),
      }))

      const data = [timeslots.map((t) => counts.get(t.id))]

      if (bookingsGrid) {
        bookingsGrid.updateConfig({ columns, data }).forceRender()
      } else {
        bookingsGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full',
            th: 'bg-gray-100 p-2 text-sm font-medium',
            td: 'text-center',
          },
        }).render(document.getElementById('bookings-grid'))
      }
    } catch (error) {
      toast.error('Failed to load bookings')
    }
  }

  // Helper function to get teacher assignments including assigned rooms
  async function loadTeacherAssignments() {
    try {
      // Load both rooms and grouprooms
      const [roomRecords, grouproomRecords] = await Promise.all([
        pb.collection('room').getFullList({
          expand: 'teacher',
        }),
        pb.collection('grouproom').getFullList({
          expand: 'teacher',
        }),
      ])

      const teacherAssignmentMap = {}

      // Process regular rooms - get assigned room for each teacher
      roomRecords.forEach((room) => {
        if (room.teacher) {
          teacherAssignmentMap[room.teacher] = {
            type: 'room',
            name: room.name || 'Unnamed Room',
            id: room.id,
            teacherName: room.expand?.teacher?.name || 'Unknown Teacher',
            sortKey: `room_${room.name || ''}`,
            assignedRoom: room.name || 'Unnamed Room', // This is the assigned room from room collection
          }
        }
      })

      // Process grouprooms - only if teacher doesn't already have a regular room
      grouproomRecords.forEach((grouproom) => {
        if (grouproom.teacher && !teacherAssignmentMap[grouproom.teacher]) {
          teacherAssignmentMap[grouproom.teacher] = {
            type: 'grouproom',
            name: grouproom.name || 'Unnamed Grouproom',
            id: grouproom.id,
            teacherName: grouproom.expand?.teacher?.name || 'Unknown Teacher',
            maxStudents: grouproom.maxstudents,
            sortKey: `grouproom_${grouproom.name || ''}`,
            assignedRoom: grouproom.name || 'Unnamed Grouproom', // Use grouproom name as assigned room
          }
        }
      })

      return teacherAssignmentMap
    } catch (error) {
      console.error('Error loading teacher assignments:', error)
      return {}
    }
  }

  // Updated export function with assigned room column
  async function exportSchedule() {
    // Check if any timeslots are selected
    if (selectedTimeslots.size === 0) {
      toast.error('Please select at least one timeslot to export')
      return
    }

    try {
      // Get all schedules for the current date
      const schedules = await pb.collection('lessonSchedule').getFullList({
        filter: `date = "${currentDate}"`,
        expand: 'teacher,room,timeslot',
        sort: 'teacher,timeslot',
      })

      if (schedules.length === 0) {
        toast.warning('No bookings found for this date')
        return
      }

      // Get teacher assignments including assigned rooms
      const teacherAssignmentMap = await loadTeacherAssignments()

      // Get all teachers
      const allTeachers = await pb.collection('teacher').getFullList({
        sort: 'name',
      })

      // Filter teachers: show non-disabled OR disabled with bookings
      const teachersWithBookings = new Set(schedules.map((s) => s.teacher).filter(Boolean))

      const filteredTeachers = allTeachers.filter((teacher) => {
        if (teacher.status !== 'disabled') return true
        return teachersWithBookings.has(teacher.id)
      })

      // Categorize teachers based on assignments
      const teachersWithRooms = []
      const teachersWithGrouproomsOnly = []
      const teachersWithoutAssignments = []

      filteredTeachers.forEach((teacher) => {
        const assignment = teacherAssignmentMap[teacher.id]

        if (assignment) {
          if (assignment.type === 'room') {
            teachersWithRooms.push({ teacher, assignment })
          } else if (assignment.type === 'grouproom') {
            teachersWithGrouproomsOnly.push({ teacher, assignment })
          }
        } else {
          teachersWithoutAssignments.push({ teacher, assignment: null })
        }
      })

      // Sort teachers with rooms by room name
      teachersWithRooms.sort((a, b) => {
        return a.assignment.name.localeCompare(b.assignment.name)
      })

      // Sort teachers with only grouprooms by grouproom name
      teachersWithGrouproomsOnly.sort((a, b) => {
        return a.assignment.name.localeCompare(b.assignment.name)
      })

      // Sort teachers without assignments by name
      teachersWithoutAssignments.sort((a, b) => {
        return a.teacher.name.localeCompare(b.teacher.name)
      })

      // Combine lists in order: room-assigned > grouproom-only > unassigned
      const sortedTeachers = [
        ...teachersWithRooms.map((item) => ({ teacher: item.teacher, assignment: item.assignment })),
        ...teachersWithGrouproomsOnly.map((item) => ({ teacher: item.teacher, assignment: item.assignment })),
        ...teachersWithoutAssignments.map((item) => ({ teacher: item.teacher, assignment: null })),
      ]

      // Filter timeslots to only include selected ones
      const selectedTimeslotData = timeslots.filter((t) => selectedTimeslots.has(t.id))

      if (selectedTimeslotData.length === 0) {
        toast.error('No timeslots selected')
        return
      }

      // Create a map to group bookings by teacher and timeslot
      const teacherScheduleMap = new Map()

      // Initialize map for all sorted teachers
      sortedTeachers.forEach(({ teacher, assignment }) => {
        teacherScheduleMap.set(teacher.id, {
          teacherName: teacher.name,
          assignedRoom: assignment?.assignedRoom || 'N/A',
          timeslots: new Map(),
        })
      })

      // Process schedules and group by teacher and timeslot
      schedules.forEach((schedule) => {
        const teacherId = schedule.teacher
        const timeslotId = schedule.timeslot

        // Only include if timeslot is selected
        if (!selectedTimeslots.has(timeslotId)) return

        const roomName = schedule.expand?.room?.name || 'No Room'

        if (!teacherScheduleMap.has(teacherId)) {
          // Teacher might not be in sortedTeachers (filtered out), skip
          return
        }

        const teacherData = teacherScheduleMap.get(teacherId)

        // For each timeslot, track unique rooms
        if (!teacherData.timeslots.has(timeslotId)) {
          teacherData.timeslots.set(timeslotId, new Set())
        }

        teacherData.timeslots.get(timeslotId).add(roomName)
      })

      // Prepare CSV content with Teacher, Assigned Room, then Timeslots
      const headers = ['Teacher', 'Assigned Room']

      // Add only selected timeslot columns
      selectedTimeslotData.forEach((timeSlot) => {
        headers.push(`${timeSlot.start} - ${timeSlot.end}`)
      })

      const csvRows = []
      csvRows.push(headers.join(','))

      // Add data rows for each teacher
      sortedTeachers.forEach(({ teacher }) => {
        const teacherData = teacherScheduleMap.get(teacher.id)

        const row = [`"${teacher.name}"`, `"${teacherData?.assignedRoom || 'N/A'}"`]

        // For each selected timeslot, add the rooms for this teacher
        selectedTimeslotData.forEach((timeSlot) => {
          if (teacherData) {
            const rooms = teacherData.timeslots.get(timeSlot.id)

            if (rooms && rooms.size > 0) {
              // Join multiple rooms with commas
              const roomList = Array.from(rooms).join(', ')
              row.push(`"${roomList}"`)
            } else {
              row.push('') // Empty cell if no booking
            }
          } else {
            row.push('') // Teacher with no bookings
          }
        })

        csvRows.push(row.join(','))
      })

      // Create CSV blob
      const csvContent = csvRows.join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })

      // Create download link
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)

      // Format filename with selected timeslots
      const date = new Date(currentDate)
      const timeslotCount = selectedTimeslotData.length
      const filename = `daily_schedule_${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${timeslotCount}_timeslots.csv`

      link.setAttribute('download', filename)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast.success(`Exported schedule with ${selectedTimeslotData.length} timeslot(s)`)
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Failed to export schedule')
    }
  }

  onMount(() => {
    loadBookings()
    pb.collection('lessonSchedule').subscribe('*', loadBookings)
  })

  onDestroy(() => {
    bookingsGrid?.destroy()
    pb.collection('lessonSchedule').unsubscribe()
  })
</script>

<div class="p-6 max-w-7xl mx-auto">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold">Daily Bookings</h1>
    <div class="flex gap-2">
      <button
        class="btn btn-outline"
        onclick={() => (showTimeslotSelector = !showTimeslotSelector)}
        title="Select timeslots to export"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
        Select Timeslots ({selectedTimeslots.size}/{timeslots.length})
      </button>
      <button class="btn btn-primary" onclick={exportSchedule} title="Export selected schedule to CSV">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
            clip-rule="evenodd"
          />
        </svg>
        Export Schedule
      </button>
    </div>
  </div>

  {#if showTimeslotSelector}
    <div class="mb-6 p-4 border rounded-lg bg-gray-50">
      <div class="flex justify-between items-center mb-3">
        <h3 class="font-semibold">Select Timeslots to Export</h3>
        <div class="flex gap-2">
          <button class="btn btn-xs" onclick={selectAllTimeslots}>Select All</button>
          <button class="btn btn-xs btn-outline" onclick={clearAllTimeslots}>Clear All</button>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {#each timeslots as timeslot}
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedTimeslots.has(timeslot.id)}
              onchange={() => toggleTimeslot(timeslot.id)}
              class="checkbox checkbox-sm"
            />
            <span>{timeslot.start} - {timeslot.end}</span>
          </label>
        {/each}
      </div>
    </div>
  {/if}

  <div class="flex items-center justify-between mb-6 gap-4">
    <button class="btn btn-sm" onclick={() => changeDate(-1)}>&larr;</button>
    <div class="text-lg font-medium">{getDateDisplay(currentDate)}</div>
    <button class="btn btn-sm" onclick={() => changeDate(1)}>&rarr;</button>
  </div>

  <div class="text-center mb-6">
    <span class="text-4xl font-bold">{totalBookingsToday}</span>
    <span class="text-sm text-gray-500 ml-2">total bookings</span>
  </div>

  <div id="bookings-grid" class="border rounded"></div>
</div>
