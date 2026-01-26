<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  let { show = $bindable(false), mondaySchedule = $bindable(), onSave } = $props()

  // Store reference data
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let timeslots = $state([])

  // Loading state
  let isSaving = $state(false)
  let isDeleting = $state(false)

  // Load reference data ONCE
  onMount(async () => {
    if (teachers.length === 0) {
      await loadAllData()
    }
  })

  const loadAllData = async () => {
    try {
      const [teachersData, studentsData, subjectsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }), // KEEP status field
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }), // KEEP status field
        pb.collection('subject').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('timeSlot').getFullList({ sort: 'start', fields: 'id,start,end' }),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      timeslots = timeslotsData
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load data')
    }
  }

  // SIMPLIFIED: Check conflicts only on save
  const checkForConflicts = async () => {
    const { date, teacher, student, timeslot, room, mode, id } = mondaySchedule

    if (!teacher?.id || !student?.id || !timeslot?.id || !date) return true

    try {
      const excludeFilter = mode === 'edit' && id ? ` && id != "${id}"` : ''

      // Check individual schedules
      const individualFilter = `date = "${date}" && timeslot = "${timeslot.id}" && (teacher = "${teacher.id}" || student = "${student.id}" || room = "${room.id}")${excludeFilter}`

      const [individualSchedules, groupSchedules, studentRecords] = await Promise.all([
        pb.collection('mondayLessonSchedule').getFullList({
          filter: individualFilter,
          expand: 'teacher,student,room',
          $autoCancel: false,
        }),

        // Check group schedules
        pb
          .collection('mondayGroupLessonSchedule')
          .getFullList({
            filter: `date = "${date}" && timeslot = "${timeslot.id}"${excludeFilter}`,
            expand: 'teacher,student,grouproom',
            $autoCancel: false,
          })
          .catch(() => []),

        // Get student names for reference
        pb.collection('student').getFullList({
          fields: 'id,englishName',
          $autoCancel: false,
        }),
      ])

      // Create a map of student IDs to names
      const studentMap = new Map()
      studentRecords.forEach((s) => studentMap.set(s.id, s.englishName))

      // Combine all schedules
      const allSchedules = [...individualSchedules, ...groupSchedules]

      // Check teacher conflict
      const teacherConflict = allSchedules.find((s) => s.teacher === teacher.id)
      if (teacherConflict) {
        const teacherName =
          teacherConflict.expand?.teacher?.name ||
          teachers.find((t) => t.id === teacherConflict.teacher)?.name ||
          'Unknown Teacher'

        if (Array.isArray(teacherConflict.student)) {
          const count = teacherConflict.student.length
          toast.error(`${teacherName} is already teaching a group lesson (${count} students) for this timeslot`)
        } else {
          const studentId = teacherConflict.student
          const studentName =
            teacherConflict.expand?.student?.englishName || studentMap.get(studentId) || 'Unknown Student'
          toast.error(`${teacherName} is already booked with ${studentName} for this timeslot`)
        }
        return false
      }

      // Check student conflict
      const studentConflict = allSchedules.find((s) => {
        if (s.student === student.id) return true
        if (Array.isArray(s.student) && s.student.includes(student.id)) return true
        return false
      })

      if (studentConflict) {
        const currentStudentName =
          mondaySchedule.student?.englishName || studentMap.get(student.id) || 'Unknown Student'

        if (Array.isArray(studentConflict.student)) {
          const teacherId = studentConflict.teacher
          const teacherName =
            studentConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          toast.error(`${currentStudentName} is already in a group lesson with ${teacherName} for this timeslot`)
        } else {
          const teacherId = studentConflict.teacher
          const teacherName =
            studentConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          toast.error(`${currentStudentName} is already booked with ${teacherName} for this timeslot`)
        }
        return false
      }

      // Check room conflict
      const roomConflict = allSchedules.find((s) => {
        const roomId = s.room || s.grouproom
        return roomId === room.id
      })

      if (roomConflict) {
        const roomName = mondaySchedule.room?.name || 'Unknown Room'

        if (Array.isArray(roomConflict.student)) {
          const teacherId = roomConflict.teacher
          const teacherName =
            roomConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          const count = roomConflict.student.length
          toast.error(`${roomName} is already occupied by a group lesson with ${teacherName} (${count} students)`)
        } else {
          const teacherId = roomConflict.teacher
          const studentId = roomConflict.student
          const teacherName =
            roomConflict.expand?.teacher?.name || teachers.find((t) => t.id === teacherId)?.name || 'Unknown Teacher'
          const studentName =
            roomConflict.expand?.student?.englishName || studentMap.get(studentId) || 'Unknown Student'
          toast.error(`${roomName} is already occupied by ${teacherName} and ${studentName}`)
        }
        return false
      }

      return true
    } catch (error) {
      console.error('Error checking conflicts:', error)
      return true // Allow save on error
    }
  }

  const validateForm = () => {
    const { teacher, student, subject, timeslot, room, date } = mondaySchedule

    if (!teacher?.id) {
      toast.error('Please select Teacher')
      return false
    }
    if (!student?.id) {
      toast.error('Please select Student')
      return false
    }
    if (!subject?.id) {
      toast.error('Please select Subject')
      return false
    }
    if (!timeslot?.id) {
      toast.error('Please select Timeslot')
      return false
    }
    if (!room?.id) {
      toast.error('Please select Room')
      return false
    }
    if (!date) {
      toast.error('Please select Date')
      return false
    }

    return true
  }

  const saveMondaySchedule = async () => {
    if (!validateForm()) return

    // Check for conflicts and show toast if found
    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { date, timeslot, teacher, student, subject, room, mode, id } = mondaySchedule

    const scheduleData = {
      date,
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: student.id,
      subject: subject.id,
      room: room.id,
    }

    toast.promise(
      async () => {
        let savedSchedule
        if (mode === 'edit' && id) {
          savedSchedule = await pb.collection('mondayLessonSchedule').update(id, scheduleData)
          return 'Monday schedule updated successfully!'
        } else {
          savedSchedule = await pb.collection('mondayLessonSchedule').create(scheduleData)
          return 'Monday schedule created successfully!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          closeModal()
          onSave()
          return 'Monday schedule saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
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
      `Time: ${timeslot?.start || 'N/A'} - ${timeslot?.end || 'N/A'}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    toast.promise(
      async () => {
        await pb.collection('mondayLessonSchedule').delete(mondaySchedule.id)
      },
      {
        loading: 'Deleting...',
        success: () => {
          closeModal()
          onSave()
          return 'Monday schedule deleted successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to delete: ${error.message}`
        },
      }
    )
  }

  const closeModal = () => {
    show = false
  }
</script>

<dialog class="modal {show ? 'modal-open' : ''}">
  <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
    <h3 class="text-xl font-bold text-center">
      {mondaySchedule.mode === 'edit' ? 'Edit' : 'Create'} Monday Schedule
    </h3>

    {#if mondaySchedule.date}
      <div class="alert alert-info text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <span>
          📅 Creating schedule for: {new Date(mondaySchedule.date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Left column -->
      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
          <select
            class="select select-bordered w-full"
            bind:value={mondaySchedule.subject.id}
            disabled={subjects.length === 0}
            required
          >
            <option value="">Select Subject</option>
            {#each subjects as subject}
              <option value={subject.id}>{subject.name}</option>
            {/each}
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Student</legend>
          <select
            class="select select-bordered w-full"
            bind:value={mondaySchedule.student.id}
            disabled={students.length === 0}
            required
          >
            <option value="">Select Student</option>
            {#each students as student (student.id)}
              {#if student.status !== 'graduated' || student.id === mondaySchedule.student.id}
                <option
                  value={student.id}
                  disabled={student.status === 'graduated'}
                  class:italic={student.status === 'graduated'}
                >
                  {student.englishName}
                  {#if student.status === 'graduated'}(Graduated){/if}
                </option>
              {/if}
            {/each}
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Teacher</legend>
          <select
            class="select select-bordered w-full"
            bind:value={mondaySchedule.teacher.id}
            disabled={teachers.length === 0}
            required
          >
            <option value="">Select Teacher</option>
            {#each teachers as teacher}
              {#if teacher.status !== 'disabled' || teacher.id === mondaySchedule.teacher.id}
                <option
                  value={teacher.id}
                  disabled={teacher.status === 'disabled'}
                  class:italic={teacher.status === 'disabled'}
                >
                  {teacher.name}
                  {#if teacher.status === 'disabled'}(Disabled){/if}
                </option>
              {/if}
            {/each}
          </select>
        </fieldset>
      </div>

      <!-- Right column -->
      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Time Slot</legend>
          <select
            class="select select-bordered w-full"
            bind:value={mondaySchedule.timeslot.id}
            disabled={timeslots.length === 0}
            required
          >
            <option value="">Select Time Slot</option>
            {#each timeslots as timeslot}
              <option value={timeslot.id}>{timeslot.start} - {timeslot.end}</option>
            {/each}
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend font-semibold text-gray-700">Room</legend>
          <input
            type="text"
            value={mondaySchedule.room.name}
            class="input input-bordered w-full bg-base-200"
            readonly
            disabled
          />
        </fieldset>
      </div>
    </div>

    <!-- Buttons -->
    <div class="modal-action">
      {#if mondaySchedule.mode === 'edit' && mondaySchedule.id}
        <button class="btn btn-error mr-auto" onclick={deleteMondaySchedule} disabled={isDeleting || isSaving}>
          {#if isDeleting}
            <span class="loading loading-spinner loading-sm"></span>
            Deleting...
          {:else}
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
          {/if}
        </button>
      {/if}

      <button class="btn btn-primary" onclick={saveMondaySchedule} disabled={isSaving || isDeleting}>
        {#if isSaving}
          <span class="loading loading-spinner loading-sm"></span>
          Saving...
        {:else}
          {mondaySchedule.mode === 'edit' ? 'Update' : 'Create'}
        {/if}
      </button>

      <button class="btn" onclick={closeModal} disabled={isSaving || isDeleting}>Close</button>
    </div>
  </div>

  <!-- Modal backdrop -->
  <div class="modal-backdrop" onclick={closeModal}></div>
</dialog>
