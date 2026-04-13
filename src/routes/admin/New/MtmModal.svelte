<script>
  import { booking } from './schedule.svelte.js'
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
    if (!validateForm()) return

    const { id, timeslot, teacher, student, subject, room, mode, startDate, endDate } = booking.data

    // Map your booking data to the MtmSchedule schema
    const scheduleData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
      start: startDate, // "2026-04-14"
      end: endDate, // "2026-04-17"
    }

    toast.promise(
      async () => {
        // 🔍 PRE-CHECKS FIRST

        // 1️⃣ Student conflict
        const studentConflict = await pb.collection('MtmSchedule').getList(1, 1, {
          filter: `student="${scheduleData.student}" && timeslot="${scheduleData.timeslot}"`,
        })

        if (studentConflict.items.length > 0) {
          throw new Error('Student already has a schedule in this timeslot!')
        }

        // 2️⃣ Teacher conflict
        const teacherConflict = await pb.collection('MtmSchedule').getList(1, 1, {
          filter: `teacher="${scheduleData.teacher}" && timeslot="${scheduleData.timeslot}"`,
        })

        if (teacherConflict.items.length > 0) {
          throw new Error('Teacher is already booked for this timeslot!')
        }

        // 3️⃣ Room conflict (optional)
        const roomConflict = await pb.collection('MtmSchedule').getList(1, 1, {
          filter: `room="${scheduleData.room}" && timeslot="${scheduleData.timeslot}"`,
        })

        if (roomConflict.items.length > 0) {
          throw new Error('Room is already occupied at this timeslot!')
        }

        // ✅ If no conflicts → proceed
        if (mode === 'edit' && id) {
          await pb.collection('MtmSchedule').update(id, scheduleData)
          return 'Schedule updated!'
        } else {
          await pb.collection('MtmSchedule').create(scheduleData)
          return 'Schedule created!'
        }
      },
      {
        loading: 'Saving to MtmSchedule...',
        success: (msg) => {
          dispatch('refresh')
          document.getElementById('editModal').close()
          return msg
        },
        error: (err) => err.message, // 👈 now shows your custom errors
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
    {#if booking.data}
      <h3 class="text-xl font-bold text-center">
        {booking.data.mode === 'edit' ? 'Edit' : 'Create'} MTM Schedule
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">Student</label>
          <select class="select select-bordered w-full" bind:value={booking.data.student.id}>
            <option value="">Select Student</option>
            {#each students as s}<option value={s.id}>{s.englishName}</option>{/each}
          </select>
        </div>

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">Subject</label>
          <select class="select select-bordered w-full" bind:value={booking.data.subject.id}>
            <option value="">Select Subject</option>
            {#each subjects as sub}<option value={sub.id}>{sub.name}</option>{/each}
          </select>
        </div>

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">Teacher</label>
          <select class="select select-bordered w-full" bind:value={booking.data.teacher.id}>
            <option value="">Select Teacher</option>
            {#each teachers as t}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </div>

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">Room</label>
          <select class="select select-bordered w-full" bind:value={booking.data.room.id}>
            <option value="">Select Room</option>
            {#each rooms as r}<option value={r.id}>{r.name}</option>{/each}
          </select>
        </div>

        <div class="form-control md:col-span-2">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">Timeslot</label>
          <select class="select select-bordered w-full" bind:value={booking.data.timeslot.id}>
            <option value="">Select Timeslot</option>
            {#each timeslots as ts}<option value={ts.id}>{ts.start} - {ts.end}</option>{/each}
          </select>
        </div>

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">Start Date</label>
          <input type="date" class="input input-bordered w-full" bind:value={booking.data.startDate} />
        </div>

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label font-semibold">End Date</label>
          <input type="date" class="input input-bordered w-full" bind:value={booking.data.endDate} />
        </div>
      </div>

      <div class="modal-action">
        {#if booking.data.mode === 'edit' && booking.data.id}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule}>Delete Record</button>
        {/if}
        <button class="btn btn-primary px-8" onclick={saveSchedule}>
          {booking.data.mode === 'edit' ? 'Update' : 'Save'} Record
        </button>
        <form method="dialog"><button class="btn">Close</button></form>
      </div>
    {:else}
      <div class="flex justify-center p-10"><span class="loading loading-spinner loading-lg"></span></div>
    {/if}
  </div>
</dialog>
