<script>
  // import { booking } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte.js'

  const dispatch = createEventDispatcher()

  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // Load reference data
  $effect(() => {
    if (teachers.length === 0) {
      loadAllData()
    }
  })

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, roomsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }),
        pb.collection('subject').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('room').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('timeSlot').getFullList({ sort: 'start', fields: 'id,start,end' }),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      rooms = roomsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
      toast.error('Failed to load data')
    }
  }

  const validateForm = () => {
    const { teacher, student, subject, timeslot, startDate, endDate, room } = booking.data
    if (!teacher?.id || !student?.id || !subject?.id || !timeslot?.id || !room?.id || !startDate || !endDate) {
      toast.error('Please fill in all fields')
      return false
    }
    return true
  }

  const saveSchedule = async () => {
    // 1. Basic Form Validation
    if (!validateForm()) return

    const { id, timeslot, teacher, student, subject, room, mode, startDate, endDate } = booking.data

    // 2. Normalize IDs (Ensures we are comparing strings, not objects)
    const sId = student?.id || student
    const tId = teacher?.id || teacher
    const tsId = timeslot?.id || timeslot
    const rId = room?.id || room
    const subId = subject?.id || subject

    const scheduleData = {
      timeslot: tsId,
      teacher: tId,
      student: sId,
      subject: subId,
      room: rId,
      start: startDate,
      end: endDate || startDate,
    }

    toast.promise(
      async () => {
        // ID filter to ignore the current record when editing
        const idFilter = mode === 'edit' && id ? ` && id != "${id}"` : ''

        // 🔍 THE RANGE OVERLAP LOGIC
        // This math checks if any part of the new week touches an existing week
        const rangeOverlap = `start <= "${scheduleData.end}" && end >= "${scheduleData.start}"`

        // --- CHECK 1: MTM SCHEDULE (Single Student Relation) ---
        const mtmFilter = `timeslot = "${tsId}" && (${rangeOverlap}) && (teacher = "${tId}" || student = "${sId}")${idFilter}`

        const mtmConflict = await pb
          .collection('MtmSchedule')
          .getFirstListItem(mtmFilter)
          .catch(() => null)

        if (mtmConflict) {
          const isTeacher = mtmConflict.teacher === tId
          throw new Error(
            `${isTeacher ? 'Teacher' : 'Student'} is already booked in MTM (${mtmConflict.start} to ${mtmConflict.end})`
          )
        }

        // --- CHECK 2: GROUP SCHEDULE (Multiple Student Relation) ---
        // Using ?= because 'student' is an array of IDs
        const grpFilter = `timeslot = "${tsId}" && (${rangeOverlap}) && (teacher = "${tId}" || student ?= "${sId}")`

        const grpConflict = await pb
          .collection('GrpSchedule')
          .getFirstListItem(grpFilter)
          .catch(() => null)

        if (grpConflict) {
          const isTeacher = grpConflict.teacher === tId
          throw new Error(
            `${isTeacher ? 'Teacher' : 'Student'} is busy in a Group Class (${grpConflict.start} to ${grpConflict.end})`
          )
        }

        // --- CHECK 3: ROOM OCCUPANCY ---
        const roomFilter = `timeslot = "${tsId}" && (${rangeOverlap}) && room = "${rId}"${idFilter}`
        const roomConflict = await pb
          .collection('MtmSchedule')
          .getFirstListItem(roomFilter)
          .catch(() => null)

        if (roomConflict) {
          throw new Error(`The room is already occupied during this week/timeslot.`)
        }

        // --- FINAL ACTION ---
        if (mode === 'edit' && id) {
          await pb.collection('MtmSchedule').update(id, scheduleData)
          return 'Schedule updated!'
        } else {
          await pb.collection('MtmSchedule').create(scheduleData)
          return 'Schedule created!'
        }
      },
      {
        loading: 'Checking weekly availability...',
        success: (msg) => {
          dispatch('refresh')
          document.getElementById('editModal').close()
          return msg
        },
        error: (err) => err.message,
      }
    )
  }

  const deleteSchedule = async () => {
    if (!booking.data.id) return
    if (!confirm('Delete this MTM schedule record?')) return

    toast.promise(
      async () => {
        await pb.collection('MtmSchedule').delete(booking.data.id)
      },
      {
        loading: 'Deleting...',
        success: () => {
          dispatch('refresh')
          document.getElementById('editModal').close()
          return 'Record deleted'
        },
        error: (err) => `Delete failed: ${err.message}`,
      }
    )
  }
</script>

<dialog id="editModal" class="modal">
  <div class="modal-box max-w-xl w-full space-y-6 rounded-xl">
    {#if booking.data && booking.data.student && booking.data.teacher}
      <h3 class="text-xl font-bold text-center">
        {booking.data.mode === 'edit' ? 'Edit' : 'Create'} MTM Schedule
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label font-semibold" for="student-select">Student</label>
          <select id="student-select" class="select select-bordered w-full" bind:value={booking.data.student.id}>
            <option value="">Select Student</option>
            {#each students as s}
              <option value={s.id}>{s.englishName}</option>
            {/each}
          </select>
        </div>

        <div class="form-control">
          <label class="label font-semibold" for="subject-select">Subject</label>
          <select id="subject-select" class="select select-bordered w-full" bind:value={booking.data.subject.id}>
            <option value="">Select Subject</option>
            {#each subjects as sub}
              <option value={sub.id}>{sub.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-control">
          <label class="label font-semibold" for="teacher-select">Teacher</label>
          <select id="teacher-select" class="select select-bordered w-full" bind:value={booking.data.teacher.id}>
            <option value="">Select Teacher</option>
            {#each teachers as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-control">
          <label class="label font-semibold" for="room-select">Room</label>
          <select id="room-select" class="select select-bordered w-full" bind:value={booking.data.room.id}>
            <option value="">Select Room</option>
            {#each rooms as r}
              <option value={r.id}>{r.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-control md:col-span-2">
          <label class="label font-semibold" for="timeslot-select">Timeslot</label>
          <select id="timeslot-select" class="select select-bordered w-full" bind:value={booking.data.timeslot.id}>
            <option value="">Select Timeslot</option>
            {#each timeslots as ts}
              <option value={ts.id}>{ts.start} - {ts.end}</option>
            {/each}
          </select>
        </div>

        <div class="form-control">
          <label class="label font-semibold" for="start-date">Start Date</label>
          <input id="start-date" type="date" class="input input-bordered w-full" bind:value={booking.data.startDate} />
        </div>

        <div class="form-control">
          <label class="label font-semibold" for="end-date">End Date</label>
          <input id="end-date" type="date" class="input input-bordered w-full" bind:value={booking.data.endDate} />
        </div>
      </div>

      <div class="modal-action">
        {#if booking.data.mode === 'edit' && booking.data.id}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule}>Delete Record</button>
        {/if}

        <button class="btn btn-primary px-8" onclick={saveSchedule}>
          {booking.data.mode === 'edit' ? 'Update' : 'Save'} Record
        </button>

        <form method="dialog">
          <button class="btn">Close</button>
        </form>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center p-10 gap-4">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="text-sm text-base-content/60">Preparing schedule data...</p>
      </div>
    {/if}
  </div>
</dialog>
