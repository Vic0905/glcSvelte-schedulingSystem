<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), mondaySchedule = $bindable(), onSave } = $props()

  let existingSchedules = $state([])
  let mondayGroupSchedules = $state([])
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let timeslots = $state([])

  // Consolidated conflict detection using $derived
  const conflicts = $derived({
    teacher:
      existingSchedules.find((s) => s.teacher === mondaySchedule.teacher?.id) ||
      mondayGroupSchedules.find((s) => s.teacher === mondaySchedule.teacher?.id),
    student:
      existingSchedules.find((s) => s.student === mondaySchedule.student?.id) ||
      mondayGroupSchedules.find((s) => Array.isArray(s.student) && s.student.includes(mondaySchedule.student?.id)),
    room:
      existingSchedules.find((s) => s.room === mondaySchedule.room?.id) ||
      mondayGroupSchedules.find((s) => s.grouproom === mondaySchedule.room?.id),
  })

  // Combined data loading
  $effect(() => {
    if (!teachers.length) {
      loadAllData()
    }
  })

  $effect(() => {
    if (mondaySchedule.date && mondaySchedule.timeslot?.id) {
      loadExistingSchedules()
    }
  })

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList(),
        pb.collection('student').getFullList(),
        pb.collection('subject').getFullList(),
        pb.collection('timeslot').getFullList({ sort: 'start' }),
      ])

      teachers = teachersData.sort((a, b) => a.name.localeCompare(b.name))
      students = studentsData.sort((a, b) => a.englishName.localeCompare(b.englishName))
      subjects = subjectsData.sort((a, b) => a.name.localeCompare(b.name))
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  const loadExistingSchedules = async () => {
    try {
      const { date, timeslot, mode, id } = mondaySchedule
      const excludeFilter = mode === 'edit' && id ? ` && id != "${id}"` : ''

      const [mondayRecords, groupRecords] = await Promise.all([
        pb.collection('mondayLessonSchedule').getFullList({
          filter: `date = "${date}" && timeslot = "${timeslot.id}"${excludeFilter}`,
          expand: 'teacher,student,room',
        }),
        pb
          .collection('mondayGroupLessonSchedule')
          .getFullList({
            filter: `date = "${date}" && timeslot = "${timeslot.id}"${excludeFilter}`,
            expand: 'teacher,student,grouproom,subject',
          })
          .catch(() => []),
      ])

      existingSchedules = mondayRecords
      mondayGroupSchedules = groupRecords
    } catch (error) {
      console.error('Error loading existing schedules:', error)
      existingSchedules = []
      mondayGroupSchedules = []
    }
  }

  const getConflictLabel = (schedule, type) => {
    if (!schedule?.expand) {
      return type === 'student' ? 'Monday Group Lesson' : 'Unknown'
    }

    const isGroupLesson = Array.isArray(schedule.student)

    switch (type) {
      case 'teacher':
        if (isGroupLesson) {
          const count = schedule.student?.length || 0
          return `Monday Group Lesson (${count} students)`
        }
        return schedule.expand.student?.englishName || 'Unknown Student'

      case 'student':
        if (isGroupLesson) {
          return `Monday Group Lesson with ${schedule.expand.teacher?.name || 'Unknown Teacher'}`
        }
        return schedule.expand.teacher?.name || 'Unknown Teacher'

      case 'room':
        if (isGroupLesson) {
          const teacher = schedule.expand.teacher?.name || 'Unknown Teacher'
          const count = schedule.student?.length || 0
          return `Monday Group - ${teacher} (${count} students)`
        }
        const teacher = schedule.expand.teacher?.name || 'Unknown Teacher'
        const student = schedule.expand.student?.englishName || 'Unknown Student'
        return `${teacher} & ${student}`

      default:
        return 'Unknown'
    }
  }

  const validateAndCheckConflicts = () => {
    const { teacher, student, subject, room } = mondaySchedule

    // Validation
    const validations = [
      [teacher?.id, 'Please select Teacher'],
      [student?.id, 'Please select Student'],
      [subject?.id, 'Please select Subject'],
      [room?.id, 'Please select Room'],
    ]

    for (const [field, message] of validations) {
      if (!field) {
        toast.error(message)
        return false
      }
    }

    // In-memory conflict checks (no database queries needed)
    if (conflicts.teacher) {
      toast.error('Teacher is already scheduled at this timeslot')
      return false
    }

    if (conflicts.student) {
      toast.error('Student is already scheduled at this timeslot')
      return false
    }

    if (conflicts.room) {
      toast.error('Room is already occupied at this timeslot')
      return false
    }

    return true
  }

  const saveMondaySchedule = async () => {
    if (!validateAndCheckConflicts()) return

    const { date, timeslot, teacher, student, subject, room, mode, id } = mondaySchedule

    const scheduleData = {
      date,
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
    }

    try {
      if (mode === 'edit' && id) {
        await pb.collection('mondayLessonSchedule').update(id, scheduleData)
        toast.success('Monday schedule updated successfully')
      } else {
        await pb.collection('mondayLessonSchedule').create(scheduleData)
        toast.success('Monday schedule created successfully')
      }

      closeModal()
      onSave()
    } catch (error) {
      console.error('Error saving Monday schedule:', error)
      toast.error('Failed to save Monday schedule')
    }
  }

  const deleteMondaySchedule = async () => {
    if (!mondaySchedule.id) return

    const { date, subject, teacher, student, room, timeslot } = mondaySchedule

    const confirmMessage =
      `Are you sure you want to delete this Monday schedule?\n\n` +
      `Date: ${date}\n` +
      `Subject: ${subject?.name || 'N/A'}\n` +
      `Teacher: ${teacher?.name || 'N/A'}\n` +
      `Student: ${student?.englishName || 'N/A'}\n` +
      `Room: ${room?.name || 'N/A'}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    try {
      await pb.collection('mondayLessonSchedule').delete(mondaySchedule.id)
      toast.success('Monday schedule deleted successfully')
      closeModal()
      onSave()
    } catch (error) {
      console.error('Error deleting Monday schedule:', error)
      toast.error('Failed to delete Monday schedule')
    }
  }

  const closeModal = () => {
    show = false
  }
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {mondaySchedule.mode === 'edit' ? 'Edit' : 'Create'} Monday Schedule
      </h3>

      <div class="alert alert-info">
        <span>
          📅 Creating schedule for: {new Date(mondaySchedule.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
            <select class="select select-bordered w-full" bind:value={mondaySchedule.subject.id} required>
              <option value="">Select Subject</option>
              {#each subjects as subject}
                <option value={subject.id}>{subject.name}</option>
              {/each}
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
            <select class="select select-bordered w-full" bind:value={mondaySchedule.student.id} required>
              <option value="">Select Student</option>
              {#each students as student (student.id)}
                {@const isGraduated = student.status === 'graduated'}
                {@const isCurrentStudent = student.id === mondaySchedule.student.id}
                {@const conflictSchedule =
                  existingSchedules.find((s) => s.student === student.id) ||
                  mondayGroupSchedules.find((s) => Array.isArray(s.student) && s.student.includes(student.id))}

                {#if !isGraduated || isCurrentStudent}
                  <option
                    value={student.id}
                    disabled={isGraduated || !!conflictSchedule}
                    class:text-gray-400={isGraduated || conflictSchedule}
                    class:italic={isGraduated}
                  >
                    {student.englishName}
                    {#if isGraduated}
                      (Graduated)
                    {:else if conflictSchedule}
                      ({getConflictLabel(conflictSchedule, 'student')})
                    {/if}
                  </option>
                {/if}
              {/each}
            </select>

            {#if conflicts.student}
              <div class="label">
                <span class="label-text-alt text-warning">
                  ⚠️ This student is already scheduled for this timeslot
                </span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
            <select class="select select-bordered w-full" bind:value={mondaySchedule.timeslot.id} required>
              <option value="">Select Time Slot</option>
              {#each timeslots as timeslot}
                <option value={timeslot.id}>{timeslot.start} - {timeslot.end}</option>
              {/each}
            </select>
          </fieldset>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
            <select class="select select-bordered w-full" bind:value={mondaySchedule.teacher.id} required>
              <option value="">Select Teacher</option>
              {#each teachers as teacher}
                {@const conflictSchedule =
                  existingSchedules.find((s) => s.teacher === teacher.id) ||
                  mondayGroupSchedules.find((s) => s.teacher === teacher.id)}
                <option value={teacher.id} disabled={!!conflictSchedule} class:text-gray-400={conflictSchedule}>
                  {teacher.name}
                  {#if conflictSchedule}
                    ({getConflictLabel(conflictSchedule, 'teacher')})
                  {/if}
                </option>
              {/each}
            </select>

            {#if conflicts.teacher}
              <div class="label">
                <span class="label-text-alt text-warning">
                  ⚠️ This teacher is already scheduled for this timeslot
                </span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
            <input type="text" value={mondaySchedule.room.name} class="input input-bordered w-full" readonly />

            {#if conflicts.room}
              <div class="label">
                <span class="label-text-alt text-warning"> ⚠️ This room is already occupied for this timeslot </span>
              </div>
            {/if}
          </fieldset>
        </div>
      </div>

      <!-- Buttons -->
      <div class="modal-action">
        {#if mondaySchedule.mode === 'edit' && mondaySchedule.id}
          <button class="btn btn-error mr-auto" onclick={deleteMondaySchedule}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          </button>
        {/if}

        <button class="btn btn-primary" onclick={saveMondaySchedule}>
          {mondaySchedule.mode === 'edit' ? 'Update' : 'Create'}
        </button>

        <button class="btn" onclick={closeModal}>Close</button>
      </div>
    </div>
  </dialog>
{/if}
