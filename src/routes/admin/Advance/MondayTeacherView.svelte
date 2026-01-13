<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  const stickyStyles = `
    #mondayTeacherAdvanceGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #mondayTeacherAdvanceGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #mondayTeacherAdvanceGrid th:nth-child(1), #mondayTeacherAdvanceGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15;  box-shadow: inset -1px 0 0 #ddd; }
    #mondayTeacherAdvanceGrid th:nth-child(1) { z-index: 25; }
  `

  let teacherGrid = null
  let timeslots = $state([])
  let rooms = []
  let grouprooms = []

  function getCurrentDateDisplay() {
    const today = new Date()
    return today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')

    // Check if all items have hiddenDetails = true
    const allHidden = cell.every((item) => item.hiddenDetails === true)
    if (allHidden) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) => {
        // Show "Scheduled" for items with hiddenDetails = true
        if (item.hiddenDetails === true) {
          return h('div', { class: 'badge badge-success badge-sm mb-1' }, 'Scheduled')
        }

        return h('div', { class: 'flex flex-col gap-1 items-center' }, [
          h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name ?? 'No Subject'),
          item.isGroup
            ? h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class')
            : h('span', { class: 'badge badge-neutral badge-xs' }, item.student?.englishName ?? 'No Student'),
          h('span', { class: 'badge badge-error badge-xs' }, item.room?.name ?? 'No Room'),
        ])
      })
    )
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

  async function loadRoomsAndGrouprooms() {
    try {
      const [roomRecords, grouproomRecords] = await Promise.all([
        pb.collection('room').getFullList({ expand: 'teacher' }),
        pb.collection('grouproom').getFullList({ expand: 'teacher' }),
      ])

      rooms = roomRecords
      grouprooms = grouproomRecords

      const teacherAssignmentMap = {}

      roomRecords.forEach((room) => {
        if (room.teacher && room.expand?.teacher) {
          teacherAssignmentMap[room.teacher] = {
            type: 'room',
            name: room.name || 'Unnamed Room',
            id: room.id,
            teacherName: room.expand.teacher.name,
            sortKey: `room_${room.name || ''}`,
          }
        }
      })

      grouproomRecords.forEach((grouproom) => {
        if (grouproom.teacher && grouproom.expand?.teacher) {
          if (!teacherAssignmentMap[grouproom.teacher]) {
            teacherAssignmentMap[grouproom.teacher] = {
              type: 'grouproom',
              name: grouproom.name || 'Unnamed Grouproom',
              id: grouproom.id,
              teacherName: grouproom.expand.teacher.name,
              maxStudents: grouproom.maxstudents,
              sortKey: `grouproom_${grouproom.name || ''}`,
            }
          }
        }
      })

      return teacherAssignmentMap
    } catch (error) {
      console.error('Error loading rooms and grouprooms:', error)
      toast.error('Failed to load rooms')
      return {}
    }
  }

  async function loadMondayTeacherSchedule() {
    try {
      if (timeslots.length === 0) {
        await loadTimeslots()
      }

      const teacherAssignmentMap = await loadRoomsAndGrouprooms()
      const [allTeachers, individualBookings, groupBookings] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('mondayAdvanceBooking').getFullList({
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('mondayAdvanceGroupBooking').getFullList({
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      const teachersWithBookings = new Set()

      for (const b of individualBookings) {
        const teacherId = b.expand?.teacher?.id
        if (teacherId) teachersWithBookings.add(teacherId)
      }

      for (const b of groupBookings) {
        const teacherId = b.expand?.teacher?.id
        if (teacherId) teachersWithBookings.add(teacherId)
      }

      let teachers = allTeachers.filter((t) => {
        if (t.status !== 'disabled') return true
        return teachersWithBookings.has(t.id)
      })

      const teachersWithRooms = []
      const teachersWithGrouproomsOnly = []
      const teachersWithoutAssignments = []

      teachers.forEach((teacher) => {
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

      teachersWithRooms.sort((a, b) => a.assignment.name.localeCompare(b.assignment.name))
      teachersWithGrouproomsOnly.sort((a, b) => a.assignment.name.localeCompare(b.assignment.name))
      teachersWithoutAssignments.sort((a, b) => a.teacher.name.localeCompare(b.teacher.name))

      teachers = [
        ...teachersWithRooms.map((item) => item.teacher),
        ...teachersWithGrouproomsOnly.map((item) => item.teacher),
        ...teachersWithoutAssignments.map((item) => item.teacher),
      ]

      const scheduleMap = {}

      for (const b of individualBookings) {
        const teacherId = b.expand?.teacher?.id
        const timeslotId = b.expand?.timeslot?.id
        const studentId = b.expand?.student?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        scheduleMap[teacherId][timeslotId][studentId] = {
          subject: b.expand?.subject,
          student: b.expand?.student,
          room: b.expand?.room,
          isGroup: false,
          hiddenDetails: b.hiddenDetails === true, // ADDED: Include hiddenDetails
        }
      }

      for (const b of groupBookings) {
        const teacherId = b.expand?.teacher?.id
        const timeslotId = b.expand?.timeslot?.id
        const subjectId = b.expand?.subject?.id
        const roomId = b.expand?.grouproom?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        const key = `group_${subjectId}_${roomId}`
        scheduleMap[teacherId][timeslotId][key] = {
          subject: b.expand?.subject,
          student: null,
          room: b.expand?.grouproom,
          isGroup: true,
          hiddenDetails: b.hiddenDetails === true, // ADDED: Include hiddenDetails
        }
      }

      if (timeslots.length === 0) {
        console.warn('No timeslots available')
        return
      }

      const data = teachers.map((teacher) => {
        const teacherSchedule = scheduleMap[teacher.id] || {}
        const assignment = teacherAssignmentMap[teacher.id]

        return [
          {
            value: teacher.name,
            sortValue: assignment ? assignment.sortKey : '',
            rawName: teacher.name,
            assignmentType: assignment?.type,
            assignmentName: assignment?.name,
          },
          ...timeslots.map((ts) => {
            const schedules = teacherSchedule[ts.id]
            return schedules ? Object.values(schedules) : []
          }),
        ]
      })

      const columns = [
        {
          name: 'Teacher',
          width: '120px',
          formatter: (cell) => h('span', {}, cell.rawName || cell.value),
          sort: {
            compare: (a, b) => {
              if (a.assignmentType === 'room' && b.assignmentType !== 'room') return -1
              if (a.assignmentType !== 'room' && b.assignmentType === 'room') return 1

              if (a.assignmentType === b.assignmentType) {
                if (a.assignmentName && b.assignmentName) {
                  const nameCompare = a.assignmentName.localeCompare(b.assignmentName)
                  if (nameCompare !== 0) return nameCompare
                }
                return a.rawName.localeCompare(b.rawName)
              }

              if (a.assignmentType === 'grouproom' && !b.assignmentType) return -1
              if (!a.assignmentType && b.assignmentType === 'grouproom') return 1

              return 0
            },
          },
        },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (teacherGrid) {
        const wrapper = document.querySelector('#mondayTeacherAdvanceGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        teacherGrid.updateConfig({ columns, data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#mondayTeacherAdvanceGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        teacherGrid = new Grid({
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
        }).render(document.getElementById('mondayTeacherAdvanceGrid'))
      }
    } catch (error) {
      console.error('Error loading Monday teacher schedule:', error)
      toast.error('Failed to load teacher schedule')
    }
  }

  onMount(() => {
    loadTimeslots().then(() => {
      loadMondayTeacherSchedule()
    })

    // Subscribe to Monday collections
    pb.collection('mondayAdvanceBooking').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New Monday booking added')
      } else if (e.action === 'update') {
        toast.info('Monday booking updated')
      } else if (e.action === 'delete') {
        toast.warning('Monday booking removed')
      }
      loadMondayTeacherSchedule()
    })

    pb.collection('mondayAdvanceGroupBooking').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New Monday group booking added')
      } else if (e.action === 'update') {
        toast.info('Monday group booking updated')
      } else if (e.action === 'delete') {
        toast.warning('Monday group booking removed')
      }
      loadMondayTeacherSchedule()
    })

    pb.collection('room').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New room added')
      } else if (e.action === 'update') {
        toast.info('Room updated')
      } else if (e.action === 'delete') {
        toast.warning('Room removed')
      }
      loadMondayTeacherSchedule()
    })

    pb.collection('grouproom').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success('New group room added')
      } else if (e.action === 'update') {
        toast.info('Group room updated')
      } else if (e.action === 'delete') {
        toast.warning('Group room removed')
      }
      loadMondayTeacherSchedule()
    })
  })

  onDestroy(() => {
    teacherGrid?.destroy()
    teacherGrid = null
    pb.collection('mondayAdvanceBooking').unsubscribe()
    pb.collection('mondayAdvanceGroupBooking').unsubscribe()
    pb.collection('room').unsubscribe()
    pb.collection('grouproom').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center">Monday Teacher View Table (Advance Template)</h2>
  </div>

  <div class="mb-6">
    <h3 class="text-xl font-semibold text-primary text-center">{getCurrentDateDisplay()}</h3>
  </div>

  <div class="p-3 bg-base-200 rounded-lg mb-4">
    <div class="flex flex-wrap gap-4 text-xs mb-2">
      <div class="flex items-center gap-1">
        <div class="badge badge-primary badge-xs"></div>
        <span>Subject</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-neutral badge-xs"></div>
        <span>Student</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-secondary badge-xs"></div>
        <span>Group Lesson</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-error badge-xs"></div>
        <span>Room</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="badge badge-success badge-xs"></div>
        <span>Scheduled (hidden)</span>
      </div>
    </div>
  </div>

  <div id="mondayTeacherAdvanceGrid" class="border rounded-lg"></div>
</div>
