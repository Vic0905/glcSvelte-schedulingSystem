<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), mondaySchedule = $bindable(), onSave } = $props()

  let isDeleting = $state(false)
  let isSaving = $state(false)
  let existingSchedules = $state([])
  let mondayGroupSchedules = $state([])

  // Cache reference data globally (shared across all modal instances)
  let teachers = $state([])
  let students = $state([])
  let subjects = $state([])
  let timeslots = $state([])
  let dataLoaded = $state(false)

  // Enhanced cache with smart invalidation
  let schedulesCache = new Map()
  let isLoading = $state(false)
  let lastCacheKey = null // Track last loaded cache key

  // Consolidated computed conflicts
  const conflicts = $derived({
    teacher:
      mondaySchedule.teacher?.id &&
      (existingSchedules.find((s) => s.teacher === mondaySchedule.teacher.id) ||
        mondayGroupSchedules.find((s) => s.teacher === mondaySchedule.teacher.id)),
    student:
      mondaySchedule.student?.id &&
      (existingSchedules.find((s) => s.student === mondaySchedule.student.id) ||
        mondayGroupSchedules.find((s) => Array.isArray(s.student) && s.student.includes(mondaySchedule.student.id))),
    room:
      mondaySchedule.room?.id &&
      (existingSchedules.find((s) => s.room === mondaySchedule.room.id) ||
        mondayGroupSchedules.find((s) => s.grouproom === mondaySchedule.room.id)),
  })

  // Check if data is ready for rendering
  const isDataReady = $derived(
    mondaySchedule?.teacher &&
      mondaySchedule?.student &&
      mondaySchedule?.subject &&
      mondaySchedule?.room &&
      mondaySchedule?.timeslot
  )

  // Generate cache key from date and timeslot
  const getCacheKey = (date, timeslotId, mode, id) => {
    return `${date}_${timeslotId}_${mode}_${id || 'new'}`
  }

  // Load all data ONCE globally
  $effect(() => {
    if (!dataLoaded && !teachers.length) {
      loadAllData()
    }
  })

  // OPTIMIZED: Only load schedules when cache key CHANGES
  $effect(() => {
    if (mondaySchedule.date && mondaySchedule.timeslot?.id) {
      const cacheKey = getCacheKey(
        mondaySchedule.date,
        mondaySchedule.timeslot.id,
        mondaySchedule.mode,
        mondaySchedule.id
      )
      if (cacheKey !== lastCacheKey) {
        lastCacheKey = cacheKey
        loadExistingSchedulesOptimized(cacheKey)
      }
    }
  })

  const loadAllData = async () => {
    if (dataLoaded) return

    try {
      const [teachersData, studentsData, subjectsData, timeslotsData] = await Promise.all([
        pb.collection('teacher').getFullList({
          sort: 'name',
          fields: 'id,name,status',
        }),
        pb.collection('student').getFullList({
          sort: 'englishName',
          fields: 'id,englishName,status',
        }),
        pb.collection('subject').getFullList({
          sort: 'name',
          fields: 'id,name',
        }),
        pb.collection('timeSlot').getFullList({
          sort: 'start',
          fields: 'id,start,end',
        }),
      ])

      teachers = teachersData
      students = studentsData
      subjects = subjectsData
      timeslots = timeslotsData
      dataLoaded = true
    } catch (error) {
      console.error('Error loading reference data:', error)
    }
  }

  // OPTIMIZED: Use cache more aggressively, only reload if stale
  const loadExistingSchedulesOptimized = async (cacheKey) => {
    if (!cacheKey) return

    const cached = schedulesCache.get(cacheKey)
    const cacheAge = cached ? Date.now() - cached.timestamp : Infinity
    const cacheStale = cacheAge > 30000 // 30 seconds

    // Use cache if fresh
    if (cached && !cacheStale) {
      existingSchedules = cached.schedules
      mondayGroupSchedules = cached.groupSchedules
      return
    }

    // Load in background, don't block UI
    isLoading = true
    try {
      const { date, timeslot, mode, id } = mondaySchedule
      const excludeFilter = mode === 'edit' && id ? ` && id != "${id}"` : ''

      const [mondayRecords, groupRecords] = await Promise.all([
        pb.collection('mondayLessonSchedule').getFullList({
          filter: `date = "${date}" && timeslot = "${timeslot.id}"${excludeFilter}`,
          expand: 'teacher,student,room',
          fields: 'id,teacher,student,room,timeslot,date,expand',
          $autoCancel: false,
        }),
        pb
          .collection('mondayGroupLessonSchedule')
          .getFullList({
            filter: `date = "${date}" && timeslot = "${timeslot.id}"${excludeFilter}`,
            expand: 'teacher,student,grouproom,subject',
            fields: 'id,teacher,student,grouproom,timeslot,date,expand',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      existingSchedules = mondayRecords
      mondayGroupSchedules = groupRecords

      // Cache with timestamp
      schedulesCache.set(cacheKey, {
        schedules: mondayRecords,
        groupSchedules: groupRecords,
        timestamp: Date.now(),
      })

      cleanupCache()
    } catch (error) {
      console.error('Error loading schedules:', error)
      existingSchedules = []
      mondayGroupSchedules = []
    } finally {
      isLoading = false
    }
  }

  const cleanupCache = () => {
    const now = Date.now()
    const fiveMinutes = 5 * 60 * 1000

    for (const [key, value] of schedulesCache.entries()) {
      if (now - value.timestamp > fiveMinutes) {
        schedulesCache.delete(key)
      }
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
        toast.error(message, { position: 'bottom-right', duration: 3000 })
        return false
      }
    }

    // Conflict checks
    if (conflicts.teacher) {
      toast.error('Teacher conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${teacher.name} is already scheduled at this timeslot`,
      })
      return false
    }

    if (conflicts.student) {
      toast.error('Student conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${student.englishName} is already scheduled at this timeslot`,
      })
      return false
    }

    if (conflicts.room) {
      toast.error('Room conflict', {
        position: 'bottom-right',
        duration: 5000,
        description: `${room.name} is already occupied at this timeslot`,
      })
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
      isSaving = true

      if (mode === 'edit' && id) {
        await pb.collection('mondayLessonSchedule').update(id, scheduleData)
        toast.success('Monday schedule updated successfully', { position: 'bottom-right', duration: 3000 })
      } else {
        await pb.collection('mondayLessonSchedule').create(scheduleData)
        toast.success('Monday schedule created successfully', { position: 'bottom-right', duration: 3000 })
      }

      // OPTIMIZED: Invalidate only affected cache entry
      const affectedCacheKey = getCacheKey(date, timeslot.id, 'any', 'any')
      schedulesCache.delete(affectedCacheKey)

      closeModal()
      onSave()
    } catch (error) {
      console.error('Error saving Monday schedule:', error)
      toast.error('Failed to save Monday schedule', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isSaving = false
    }
  }

  const deleteMondaySchedule = async () => {
    if (!mondaySchedule.id) {
      toast.error('No schedule selected to delete', { position: 'bottom-right', duration: 3000 })
      return
    }

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
      isDeleting = true

      await pb.collection('mondayLessonSchedule').delete(mondaySchedule.id)
      toast.success('Monday schedule deleted successfully', { position: 'bottom-right', duration: 3000 })

      // OPTIMIZED: Invalidate cache
      const affectedCacheKey = getCacheKey(date, timeslot.id, 'any', 'any')
      schedulesCache.delete(affectedCacheKey)

      closeModal()
      onSave()
    } catch (error) {
      console.error('Error deleting Monday schedule:', error)
      toast.error('Failed to delete Monday schedule', {
        position: 'bottom-right',
        duration: 5000,
        description: error.message,
      })
    } finally {
      isDeleting = false
    }
  }

  const closeModal = () => {
    show = false
  }
</script>

<dialog class="modal {show ? 'modal-open' : ''}">
  <div class="modal-box max-w-3xl w-full space-y-6 rounded-xl">
    {#if isDataReady}
      <h3 class="text-xl font-bold text-center">
        {mondaySchedule.mode === 'edit' ? 'Edit' : 'Create'} Monday Schedule
      </h3>

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

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend font-semibold text-gray-700">Subject</legend>
            <select
              class="select select-bordered w-full"
              bind:value={mondaySchedule.subject.id}
              disabled={!dataLoaded}
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
              disabled={!dataLoaded}
              required
            >
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
            <select
              class="select select-bordered w-full"
              bind:value={mondaySchedule.timeslot.id}
              disabled={!dataLoaded}
              required
            >
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
            <select
              class="select select-bordered w-full"
              bind:value={mondaySchedule.teacher.id}
              disabled={!dataLoaded}
              required
            >
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
            <input
              type="text"
              value={mondaySchedule.room.name}
              class="input input-bordered w-full bg-base-200"
              readonly
              disabled
            />

            {#if conflicts.room}
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

        <button class="btn" onclick={closeModal} disabled={isSaving || isDeleting}> Close </button>
      </div>
    {:else}
      <!-- Loading fallback -->
      <div class="flex justify-center items-center py-10">
        {#if isLoading}
          <span class="loading loading-spinner loading-lg"></span>
          <span class="ml-2">Loading data...</span>
        {:else}
          <div class="text-center">
            <div class="text-warning text-lg mb-2">⚠️ Data not ready</div>
            <div class="text-sm text-gray-500">Please ensure all required fields are filled</div>
          </div>
        {/if}
      </div>
      <div class="modal-action">
        <button class="btn" onclick={closeModal}>Close</button>
      </div>
    {/if}
  </div>

  <!-- Modal backdrop -->
  <div class="modal-backdrop" onclick={closeModal}></div>
</dialog>
