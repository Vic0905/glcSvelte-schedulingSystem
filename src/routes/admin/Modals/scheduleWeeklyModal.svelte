<script>
  import { booking } from './schedule.svelte.js'
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte.js'

  const dispatch = createEventDispatcher()

  // Core state
  let isLoading = $state(false)
  let allowConflicts = $state(false)
  let conflictedStudents = $state(new Set())
  let weekSchedules = $state([])

  // Reference data
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let rooms = $state([])
  let timeslots = $state([])

  // Computed state using getters
  const remainingDays = $derived(getRemainingDays(booking.data.date))

  // Initialize booking data with defaults
  function initBooking() {
    const defaults = { id: '', name: '' }
    booking.data = {
      ...booking.data,
      subject: booking.data.subject ?? { ...defaults },
      student: booking.data.student ?? { ...defaults },
      teacher: booking.data.teacher ?? { ...defaults },
      room: booking.data.room ?? { ...defaults },
      timeslot: booking.data.timeslot ?? { ...defaults, start: '', end: '' },
    }
  }

  // Load all reference data
  async function loadData() {
    if (isLoading) return
    isLoading = true

    try {
      const [teachersData, studentsData, subjectsData, roomsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList(),
        pb.collection('student').getFullList(),
        pb.collection('subject').getFullList(),
        pb.collection('room').getFullList(),
        pb.collection('timeSlot').getFullList(),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      rooms = roomsData
      timeslots = timeslotsData

      initBooking()
    } catch (error) {
      toast.error('Failed to load data')
    } finally {
      isLoading = false
    }
  }

  // Get days from selected date to Friday
  function getRemainingDays(date) {
    if (!date) return []

    const parsed = new Date(date)
    if (isNaN(parsed)) return []

    const dayOfWeek = parsed.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) return [] // Weekend
    if (dayOfWeek === 5) return [date] // Already Friday

    const days = []
    for (let i = 0; i <= 5 - dayOfWeek; i++) {
      const d = new Date(parsed)
      d.setDate(parsed.getDate() + i)
      days.push(d.toISOString().split('T')[0])
    }
    return days
  }

  // Get conflicted students for current date/timeslot
  async function loadConflictedStudents() {
    if (!booking.data.date || !booking.data.timeslot?.id) {
      conflictedStudents = new Set()
      return
    }

    try {
      const conflicts = await pb.collection('lessonSchedule').getFullList({
        filter: `date = "${booking.data.date}" && timeslot = "${booking.data.timeslot.id}"`,
        fields: 'student',
      })

      conflictedStudents = new Set(
        conflicts
          .flatMap((schedule) => (Array.isArray(schedule.student) ? schedule.student : [schedule.student]))
          .filter(Boolean)
      )
    } catch {
      conflictedStudents = new Set()
    }
  }

  // Get week schedules for preview
  async function loadWeekSchedules() {
    const days = remainingDays
    if (!booking.data.date || !booking.data.timeslot?.id || !days.length) {
      weekSchedules = []
      return
    }

    try {
      let filter = `date >= "${days[0]}" && date <= "${days[days.length - 1]}" && timeslot = "${booking.data.timeslot.id}"`

      if (booking.data.room?.id) {
        filter += ` && room = "${booking.data.room.id}"`
      } else if (booking.data.teacher?.id) {
        filter += ` && teacher = "${booking.data.teacher.id}"`
      } else {
        weekSchedules = []
        return
      }

      weekSchedules = await pb.collection('lessonSchedule').getFullList({
        filter,
        expand: 'teacher,student,subject,room',
        sort: 'date',
      })
    } catch {
      weekSchedules = []
    }
  }

  // Validation
  function validate() {
    const required = [
      [booking.data.teacher?.id, 'Teacher'],
      [booking.data.student?.id, 'Student'],
      [booking.data.subject?.id, 'Subject'],
      [booking.data.timeslot?.id, 'Timeslot'],
      [booking.data.room?.id, 'Room'],
      [booking.data.date, 'Date'],
    ]

    for (const [value, name] of required) {
      if (!value) {
        toast.error(`Please select ${name}`)
        return false
      }
    }

    // Check conflicts
    if (conflictedStudents.has(booking.data.student.id)) {
      if (!allowConflicts) {
        toast.error('Student has a schedule conflict. Enable "Allow conflicts" to proceed.')
        return false
      }
      toast.warning('Creating schedule with student conflict - please verify this is intentional')
    }

    return true
  }

  // Save schedule for all remaining days
  async function saveSchedule() {
    if (!validate()) return

    const scheduleData = {
      timeslot: booking.data.timeslot.id,
      teacher: booking.data.teacher.id,
      student: booking.data.student.id,
      subject: booking.data.subject.id,
      room: booking.data.room.id,
    }

    try {
      const operations = remainingDays.map(async (date) => {
        const data = { ...scheduleData, date }

        if (booking.data.mode === 'edit') {
          try {
            const existing = await pb
              .collection('lessonSchedule')
              .getFirstListItem(
                `date = "${date}" && room = "${booking.data.room.id}" && timeslot = "${booking.data.timeslot.id}"`
              )
            return pb.collection('lessonSchedule').update(existing.id, data)
          } catch {
            return pb.collection('lessonSchedule').create(data)
          }
        } else {
          return pb.collection('lessonSchedule').create(data)
        }
      })

      await Promise.allSettled(operations)

      const action = booking.data.mode === 'edit' ? 'updated' : 'created'
      toast.success(`Schedule ${action} for ${remainingDays.length} day(s) until Friday`)
      closeModal()
    } catch (error) {
      toast.error(`Operation failed: ${error.message}`)
    }
  }

  // Delete schedule
  async function deleteSchedule() {
    if (!confirm('Delete this schedule?')) return

    try {
      await pb.collection('lessonSchedule').delete(booking.data.id)
      toast.success('Schedule deleted')
      closeModal()
    } catch (error) {
      toast.error(`Delete failed: ${error.message}`)
    }
  }

  function closeModal() {
    dispatch('refresh')
    document.getElementById('editModal').close()
  }

  // Auto-update names when IDs change
  $effect(() => {
    if (booking.data.student?.id && students.length) {
      const student = students.find((s) => s.id === booking.data.student.id)
      if (student) booking.data.student.name = student.name
    }

    if (booking.data.teacher?.id && teachers.length) {
      const teacher = teachers.find((t) => t.id === booking.data.teacher.id)
      if (teacher) booking.data.teacher.name = teacher.name
    }
  })

  // Load conflicts when date/timeslot changes
  $effect(() => {
    if (booking.data.date && booking.data.timeslot?.id) {
      loadConflictedStudents()
      loadWeekSchedules()
    }
  })

  // Reload schedules when room changes
  $effect(() => {
    if (booking.data.room?.id && remainingDays.length) {
      loadWeekSchedules()
    }
  })

  // Initialize on mount
  $effect(() => {
    if (!teachers.length) loadData()
  })
</script>

<dialog id="editModal" class="modal">
  <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
    <h3 class="text-xl font-bold text-center">
      {booking.data.mode === 'edit' ? 'Edit Schedule' : 'Input Schedule'}
    </h3>

    {#if isLoading}
      <div class="flex justify-center p-8">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        <!-- Left Column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text font-semibold">Subject</span></label>
            <select class="select select-bordered" bind:value={booking.data.subject.id}>
              <option value="">Select Subject</option>
              {#each subjects as item}
                <option value={item.id}>{item.name}</option>
              {/each}
            </select>
          </div>

          <!-- Student -->
          <div class="form-control">
            <label class="label">
              <span class="label-text font-semibold">Student</span>
              <label class="label cursor-pointer">
                <span class="label-text-alt text-xs">Allow conflicts</span>
                <input type="checkbox" class="checkbox checkbox-xs" bind:checked={allowConflicts} />
              </label>
            </label>
            <select class="select select-bordered" bind:value={booking.data.student.id}>
              <option value="">Select Student</option>
              {#each students as student}
                {@const isConflicted = conflictedStudents.has(student.id)}
                <option value={student.id} disabled={!allowConflicts && isConflicted}>
                  {student.name}
                  {#if isConflicted}
                    {allowConflicts ? '(Has conflict - Override enabled)' : '(Conflicted)'}
                  {/if}
                </option>
              {/each}
            </select>
            {#if booking.data.student.id && conflictedStudents.has(booking.data.student.id)}
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="label">
                <span class="label-text-alt text-warning">⚠️ This student already has a schedule at this time</span>
              </label>
            {/if}
          </div>

          <!-- Date -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text font-semibold">Date</span></label>
            <input type="date" class="input input-bordered" bind:value={booking.data.date} />
            {#if remainingDays.length > 1}
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="label">
                <span class="label-text-alt text-info">
                  Will save for {remainingDays.length} days until Friday
                </span>
              </label>
            {/if}
          </div>
        </div>

        <!-- Right Column -->
        <div class="space-y-4">
          <!-- Teacher -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text font-semibold">Teacher</span></label>
            <select class="select select-bordered" bind:value={booking.data.teacher.id}>
              <option value="">Select Teacher</option>
              {#each teachers as item}
                <option value={item.id}>{item.name}</option>
              {/each}
            </select>
          </div>

          <!-- Room -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text font-semibold">Room</span></label>
            <select class="select select-bordered" bind:value={booking.data.room.id}>
              <option value="">Select Room</option>
              {#each rooms as item}
                <option value={item.id}>{item.name}</option>
              {/each}
            </select>
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label"><span class="label-text font-semibold">Timeslot</span></label>
            <select class="select select-bordered" bind:value={booking.data.timeslot.id}>
              <option value="">Select Timeslot</option>
              {#each timeslots as item}
                <option value={item.id}>{item.start} - {item.end}</option>
              {/each}
            </select>
          </div>
        </div>
      </div>

      <!-- Days Preview -->
      <div class="divider">
        Days that will be scheduled: {remainingDays.join(', ')}
      </div>

      <!-- Week Schedules Table -->
      {#if weekSchedules.length > 0}
        <div class="overflow-x-auto">
          <table class="table table-xs w-full">
            <thead>
              <tr>
                <th>Date</th>
                <th>Teacher</th>
                <th>Student</th>
                <th>Subject</th>
                <th>Room</th>
              </tr>
            </thead>
            <tbody>
              {#each weekSchedules as schedule}
                <tr>
                  <td>{schedule.date}</td>
                  <td>{schedule.expand?.teacher?.name || 'Unknown'}</td>
                  <td>
                    {#if Array.isArray(schedule.expand?.student)}
                      {schedule.expand.student.map((st) => st.name).join(', ')}
                    {:else}
                      {schedule.expand?.student?.name || 'Unknown'}
                    {/if}
                  </td>
                  <td>{schedule.expand?.subject?.name || 'Unknown'}</td>
                  <td>{schedule.expand?.room?.name || 'Unknown'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="text-center text-sm text-gray-500">No existing schedules found.</p>
      {/if}

      <!-- Actions -->
      <div class="modal-action">
        {#if booking.data.mode === 'edit' && booking.data.id}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule}>Delete</button>
        {/if}

        <div class="flex gap-2">
          <button class="btn btn-primary" onclick={saveSchedule}>
            {booking.data.mode === 'edit' ? 'Update' : 'Save'}
            ({remainingDays.length} day{remainingDays.length > 1 ? 's' : ''})
          </button>
        </div>

        <form method="dialog">
          <button class="btn">Close</button>
        </form>
      </div>
    {/if}
  </div>
</dialog>
