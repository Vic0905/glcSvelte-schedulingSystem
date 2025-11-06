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

  // Load all reference data once
  const loadReferenceData = async () => {
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

  // Load existing schedules for conflict detection - UPDATED TO CHECK BOTH COLLECTIONS
  const loadExistingSchedules = async () => {
    try {
      const date = mondaySchedule.date
      const timeslotId = mondaySchedule.timeslot.id
      if (!date || !timeslotId) {
        existingSchedules = []
        mondayGroupSchedules = []
        return
      }

      // Load individual Monday schedules
      const mondayRecords = await pb.collection('mondayLessonSchedule').getFullList({
        filter: `date = "${date}" && timeslot = "${timeslotId}"${
          mondaySchedule.mode === 'edit' && mondaySchedule.id ? ` && id != "${mondaySchedule.id}"` : ''
        }`,
        expand: 'teacher,student,room',
      })

      // Load group Monday schedules
      const groupRecords = await pb.collection('mondayGroupLessonSchedule').getFullList({
        filter: `date = "${date}" && timeslot = "${timeslotId}"${
          mondaySchedule.mode === 'edit' && mondaySchedule.id ? ` && id != "${mondaySchedule.id}"` : ''
        }`,
        expand: 'teacher,student,grouproom,subject',
      })

      existingSchedules = mondayRecords
      mondayGroupSchedules = groupRecords
    } catch (error) {
      console.error('Error loading existing schedules:', error)
      existingSchedules = []
      mondayGroupSchedules = []
    }
  }

  // Conflict detection helpers - UPDATED TO CHECK BOTH COLLECTIONS
  const isResourceBooked = (resourceId, type) => {
    return existingSchedules.some((schedule) => schedule[type] === resourceId)
  }

  const isStudentInMondayGroupLesson = (studentId) => {
    return mondayGroupSchedules.some(
      (schedule) => Array.isArray(schedule.student) && schedule.student.includes(studentId)
    )
  }

  const isTeacherInMondayGroupLesson = (teacherId) => {
    return mondayGroupSchedules.some((schedule) => schedule.teacher === teacherId)
  }

  const isRoomInMondayGroupLesson = (roomId) => {
    return mondayGroupSchedules.some((schedule) => schedule.grouproom === roomId)
  }

  // Get conflict info from individual lessons
  const getConflictInfo = (resourceId, type) => {
    const schedule = existingSchedules.find((s) => s[type] === resourceId)
    if (!schedule?.expand) return ''

    switch (type) {
      case 'teacher':
        return schedule.expand.student?.englishName || 'Unknown Student'
      case 'student':
        return schedule.expand.teacher?.name || 'Unknown Teacher'
      case 'room':
        return `${schedule.expand.teacher?.name || 'Unknown Teacher'} & ${schedule.expand.student?.englishName || 'Unknown Student'}`
      default:
        return ''
    }
  }

  // Get conflict info from group lessons
  const getMondayGroupLessonConflictInfo = (studentId) => {
    const schedule = mondayGroupSchedules.find((s) => Array.isArray(s.student) && s.student.includes(studentId))
    if (!schedule?.expand) return 'Monday Group Lesson'

    return `Monday Group Lesson with ${schedule.expand.teacher?.name || 'Unknown Teacher'}`
  }

  const getMondayGroupLessonTeacherConflictInfo = (teacherId) => {
    const schedule = mondayGroupSchedules.find((s) => s.teacher === teacherId)
    if (!schedule?.expand) return 'Monday Group Lesson'

    const studentCount = Array.isArray(schedule.student) ? schedule.student.length : 0
    return `Monday Group Lesson (${studentCount} students)`
  }

  const getMondayGroupLessonRoomConflictInfo = (roomId) => {
    const schedule = mondayGroupSchedules.find((s) => s.grouproom === roomId)
    if (!schedule?.expand) return 'Monday Group Lesson'

    const teacherName = schedule.expand.teacher?.name || 'Unknown Teacher'
    const studentCount = Array.isArray(schedule.student) ? schedule.student.length : 0
    return `Monday Group Lesson - ${teacherName} (${studentCount} students)`
  }

  // Validation and conflict checking - UPDATED TO CHECK BOTH COLLECTIONS
  const validateAndCheckConflicts = async () => {
    const data = mondaySchedule

    // Required field validation
    const requiredFields = [
      { field: data.teacher?.id, message: 'Please select Teacher' },
      { field: data.student?.id, message: 'Please select Student' },
      { field: data.subject?.id, message: 'Please select Subject' },
      { field: data.room?.id, message: 'Please select Room' },
    ]

    for (const { field, message } of requiredFields) {
      if (!field) {
        toast.error(message)
        return false
      }
    }

    // Check conflicts in both collections
    const date = data.date
    const timeslotId = data.timeslot.id
    const excludeFilter = data.mode === 'edit' && data.id ? ` && id != "${data.id}"` : ''

    try {
      // Check teacher conflict in individual lessons
      await pb
        .collection('mondayLessonSchedule')
        .getFirstListItem(
          `date = "${date}" && teacher = "${data.teacher.id}" && timeslot = "${timeslotId}"${excludeFilter}`
        )
      toast.error('Teacher is already scheduled in individual Monday lesson at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    try {
      // Check teacher conflict in group lessons
      await pb
        .collection('mondayGroupLessonSchedule')
        .getFirstListItem(
          `date = "${date}" && teacher = "${data.teacher.id}" && timeslot = "${timeslotId}"${excludeFilter}`
        )
      toast.error('Teacher is already scheduled in Monday group lesson at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    try {
      // Check student conflict in individual lessons
      await pb
        .collection('mondayLessonSchedule')
        .getFirstListItem(
          `date = "${date}" && student = "${data.student.id}" && timeslot = "${timeslotId}"${excludeFilter}`
        )
      toast.error('Student is already scheduled in individual Monday lesson at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    try {
      // Check student conflict in group lessons
      const groupSchedules = await pb.collection('mondayGroupLessonSchedule').getFullList({
        filter: `date = "${date}" && timeslot = "${timeslotId}"${excludeFilter}`,
      })

      const isStudentInGroup = groupSchedules.some(
        (schedule) => Array.isArray(schedule.student) && schedule.student.includes(data.student.id)
      )

      if (isStudentInGroup) {
        toast.error('Student is already scheduled in Monday group lesson at this timeslot')
        return false
      }
    } catch {
      // No conflict - this is expected
    }

    try {
      // Check room conflict in individual lessons
      await pb
        .collection('mondayLessonSchedule')
        .getFirstListItem(`date = "${date}" && room = "${data.room.id}" && timeslot = "${timeslotId}"${excludeFilter}`)
      toast.error('Room is already occupied in individual Monday lesson at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    try {
      // Check room conflict in group lessons
      await pb
        .collection('mondayGroupLessonSchedule')
        .getFirstListItem(
          `date = "${date}" && grouproom = "${data.room.id}" && timeslot = "${timeslotId}"${excludeFilter}`
        )
      toast.error('Room is already occupied in Monday group lesson at this timeslot')
      return false
    } catch {
      // No conflict - this is expected
    }

    return true
  }

  // Save Monday schedule
  const saveMondaySchedule = async () => {
    if (!(await validateAndCheckConflicts())) return

    const data = mondaySchedule
    const scheduleData = {
      date: data.date,
      timeslot: data.timeslot.id,
      teacher: data.teacher.id,
      student: data.student.id,
      subject: data.subject.id,
      room: data.room.id,
    }

    try {
      if (data.mode === 'edit' && data.id) {
        await pb.collection('mondayLessonSchedule').update(data.id, scheduleData)
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

  // Delete Monday schedule
  const deleteMondaySchedule = async () => {
    if (!mondaySchedule.id) return

    const confirmMessage =
      `Are you sure you want to delete this Monday schedule?\n\n` +
      `Date: ${mondaySchedule.date}\n` +
      `Subject: ${mondaySchedule.subject?.name || 'N/A'}\n` +
      `Teacher: ${mondaySchedule.teacher?.name || 'N/A'}\n` +
      `Student: ${mondaySchedule.student?.englishName || 'N/A'}\n` +
      `Room: ${mondaySchedule.room?.name || 'N/A'}\n` +
      `Time: ${mondaySchedule.timeslot.start} - ${mondaySchedule.timeslot.end}\n\n` +
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

  // Load data when date or timeslot changes
  $effect(() => {
    if (mondaySchedule.date && mondaySchedule.timeslot.id) {
      loadExistingSchedules()
    }
  })

  // Load reference data once
  $effect(() => {
    if (!teachers.length) {
      loadReferenceData()
    }
  })
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {mondaySchedule.mode === 'edit' ? 'Edit Monday Schedule' : 'Create Monday Schedule'}
      </h3>

      <div class="alert alert-info">
        <span
          >📅 Creating schedule for: {new Date(mondaySchedule.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}</span
        >
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
                {#if student.status !== 'graduated' || student.id === mondaySchedule.student.id}
                  {@const isBooked = isResourceBooked(student.id, 'student')}
                  {@const isInGroupLesson = isStudentInMondayGroupLesson(student.id)}
                  {@const conflictInfo = isBooked
                    ? getConflictInfo(student.id, 'student')
                    : getMondayGroupLessonConflictInfo(student.id)}
                  {@const hasConflict = isBooked || isInGroupLesson}
                  <option
                    value={student.id}
                    disabled={student.status === 'graduated' || hasConflict}
                    class={student.status === 'graduated' ? 'text-gray-400 italic' : hasConflict ? 'text-gray-400' : ''}
                  >
                    {student.englishName}
                    {#if student.status === 'graduated'}
                      (Graduated)
                    {:else if hasConflict}
                      ({conflictInfo})
                    {/if}
                  </option>
                {/if}
              {/each}
            </select>
            {#if mondaySchedule.student.id && (isResourceBooked(mondaySchedule.student.id, 'student') || isStudentInMondayGroupLesson(mondaySchedule.student.id))}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This student is already scheduled for this timeslot</span>
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
                {@const isBooked = isResourceBooked(teacher.id, 'teacher')}
                {@const isInGroupLesson = isTeacherInMondayGroupLesson(teacher.id)}
                {@const conflictInfo = isBooked
                  ? getConflictInfo(teacher.id, 'teacher')
                  : getMondayGroupLessonTeacherConflictInfo(teacher.id)}
                {@const hasConflict = isBooked || isInGroupLesson}
                <option value={teacher.id} disabled={hasConflict} class={hasConflict ? 'text-gray-400' : ''}>
                  {teacher.name}
                  {#if hasConflict}({conflictInfo}){/if}
                </option>
              {/each}
            </select>
            {#if mondaySchedule.teacher.id && (isResourceBooked(mondaySchedule.teacher.id, 'teacher') || isTeacherInMondayGroupLesson(mondaySchedule.teacher.id))}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This teacher is already scheduled for this timeslot</span>
              </div>
            {/if}
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
            <input type="text" value={mondaySchedule.room.name} class="input input-bordered w-full" readonly />
            {#if mondaySchedule.room.id && (isResourceBooked(mondaySchedule.room.id, 'room') || isRoomInMondayGroupLesson(mondaySchedule.room.id))}
              <div class="label">
                <span class="label-text-alt text-warning">⚠️ This room is already occupied for this timeslot</span>
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
