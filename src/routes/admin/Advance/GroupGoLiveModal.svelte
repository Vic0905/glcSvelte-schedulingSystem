<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), getWeekRange, currentWeekStart } = $props()

  let isGoingLive = $state(false)

  // Loading animation states
  let loadingProgress = $state({
    show: false,
    currentStep: '',
    totalBookings: 0,
    processedBookings: 0,
    totalSchedules: 0,
    createdSchedules: 0,
    skippedSchedules: 0,
    conflicts: [],
    currentDate: '',
    currentBooking: '',
  })

  const goLiveWithGroupBookings = async () => {
    try {
      isGoingLive = true

      // Initialize loading progress
      loadingProgress.show = true
      loadingProgress.currentStep = 'Preparing...'
      loadingProgress.processedBookings = 0
      loadingProgress.createdSchedules = 0
      loadingProgress.skippedSchedules = 0
      loadingProgress.conflicts = []

      // Generate Tuesday–Friday dates
      const weekDates = []
      const start = new Date(currentWeekStart)
      const sunday = new Date(start)
      sunday.setDate(start.getDate() - start.getDay())

      for (let i = 2; i <= 5; i++) {
        const date = new Date(sunday)
        date.setDate(sunday.getDate() + i)
        weekDates.push(date.toISOString().split('T')[0])
      }

      // Step 1: Load advance group bookings
      loadingProgress.currentStep = 'Loading advance group bookings...'
      await new Promise((resolve) => setTimeout(resolve, 500))

      const advanceBookings = await pb.collection('groupAdvanceBooking').getFullList({
        filter: `teacher != "" && student != "" && subject != "" && grouproom != "" && timeslot != ""`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (advanceBookings.length === 0) {
        loadingProgress.show = false
        toast.error('No complete group bookings found to publish')
        return
      }

      loadingProgress.totalBookings = advanceBookings.length
      loadingProgress.totalSchedules = advanceBookings.length * weekDates.length
      loadingProgress.currentStep = 'Checking for conflicts...'

      // Step 2: Fetch all existing group schedules for the week at once
      const dateFilters = weekDates.map((d) => `date = "${d}"`).join(' || ')
      const existingSchedules = await pb.collection('groupLessonSchedule').getFullList({
        filter: dateFilters,
      })

      // Create Sets for quick conflict checking
      const existingScheduleKeys = new Set(existingSchedules.map((s) => `${s.date}_${s.grouproom}_${s.timeslot}`))
      const teacherConflicts = new Set(existingSchedules.map((s) => `${s.date}_${s.teacher}_${s.timeslot}`))
      const roomConflicts = new Set(existingSchedules.map((s) => `${s.date}_${s.grouproom}_${s.timeslot}`))

      // Step 3: Build batch of schedules to create
      const schedulesToCreate = []
      let skippedCount = 0
      const conflicts = []

      for (let bookingIndex = 0; bookingIndex < advanceBookings.length; bookingIndex++) {
        const booking = advanceBookings[bookingIndex]

        const teacherName = booking.expand?.teacher?.name || 'Unknown Teacher'
        const subjectName = booking.expand?.subject?.name || 'Unknown Subject'
        const studentNames = Array.isArray(booking.expand?.student)
          ? booking.expand.student.map((s) => s.name).join(', ')
          : booking.expand?.student?.name || 'Unknown Students'

        loadingProgress.currentBooking = `${teacherName} - ${subjectName} (${studentNames})`
        loadingProgress.processedBookings = bookingIndex + 1

        for (const date of weekDates) {
          const scheduleKey = `${date}_${booking.grouproom}_${booking.timeslot}`
          const teacherKey = `${date}_${booking.teacher}_${booking.timeslot}`
          const roomKey = `${date}_${booking.grouproom}_${booking.timeslot}`

          // Check if schedule already exists
          if (existingScheduleKeys.has(scheduleKey)) {
            const skipMsg = `${date} - Schedule already exists for ${subjectName}`
            conflicts.push(skipMsg)
            skippedCount++
            continue
          }

          // Check for conflicts
          let hasConflict = false
          if (teacherConflicts.has(teacherKey)) {
            conflicts.push(`${date} - Teacher conflict for ${subjectName}`)
            hasConflict = true
          } else if (roomConflicts.has(roomKey)) {
            conflicts.push(`${date} - Room conflict for ${subjectName}`)
            hasConflict = true
          }

          if (hasConflict) {
            skippedCount++
            loadingProgress.skippedSchedules = skippedCount
            loadingProgress.conflicts = [...conflicts]
            continue
          }

          // Add to batch
          schedulesToCreate.push({
            date: date,
            grouproom: booking.grouproom,
            timeslot: booking.timeslot,
            subject: booking.subject,
            teacher: booking.teacher,
            student: booking.student, // Array of student IDs
            status: 'scheduled',
          })
        }
      }

      loadingProgress.currentStep = `Creating ${schedulesToCreate.length} group schedules...`

      // Step 4: Batch create schedules
      const BATCH_SIZE = 50 // Adjust based on server capacity
      let createdCount = 0

      for (let i = 0; i < schedulesToCreate.length; i += BATCH_SIZE) {
        const batch = schedulesToCreate.slice(i, i + BATCH_SIZE)

        // Create promises for batch
        const batchPromises = batch.map((schedule) => pb.collection('groupLessonSchedule').create(schedule))

        await Promise.all(batchPromises)

        createdCount += batch.length
        loadingProgress.createdSchedules = createdCount
        loadingProgress.currentStep = `Created ${createdCount} / ${schedulesToCreate.length} schedules...`

        // Small delay to update UI
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Final step
      loadingProgress.currentStep = 'Finalizing...'
      await new Promise((resolve) => setTimeout(resolve, 500))

      const conflictSummary =
        conflicts.length > 0 ? ` ${conflicts.length} conflicts/existing schedules were skipped.` : ''

      if (createdCount > 0) {
        toast.success(
          `Published ${createdCount} new group schedules to live system. ${skippedCount > 0 ? `Skipped ${skippedCount} conflicting or existing schedules.` : ''}${conflictSummary}`
        )
      } else {
        toast.warning('No new schedules were created')
      }

      closeModal()
      loadingProgress.show = false
    } catch (error) {
      console.error('Error going live with group schedules:', error)
      toast.error(`Failed to publish group schedules: ${error.message}`)
      loadingProgress.show = false
    } finally {
      isGoingLive = false
    }
  }

  const closeModal = () => {
    show = false
  }
</script>

<!-- Loading Progress Modal -->
{#if loadingProgress.show}
  <div class="modal modal-open" style="z-index: 9999;">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">🚀 Publishing Group Schedules to Live System</h3>

      <!-- Overall Progress -->
      <div class="mb-6">
        <div class="flex justify-between text-sm mb-2">
          <span>Overall Progress</span>
          <span>{loadingProgress.createdSchedules} / {loadingProgress.totalSchedules} schedules processed</span>
        </div>
        <progress
          class="progress progress-primary w-full"
          value={loadingProgress.createdSchedules + loadingProgress.skippedSchedules}
          max={loadingProgress.totalSchedules}
        ></progress>
      </div>

      <!-- Booking Progress -->
      <div class="mb-6">
        <div class="flex justify-between text-sm mb-2">
          <span>Processing Group Bookings</span>
          <span>{loadingProgress.processedBookings} / {loadingProgress.totalBookings} bookings</span>
        </div>
        <progress
          class="progress progress-secondary w-full"
          value={loadingProgress.processedBookings}
          max={loadingProgress.totalBookings}
        ></progress>
      </div>

      <!-- Current Status -->
      <div class="bg-base-200 p-4 rounded-lg mb-4">
        <div class="text-sm font-semibold mb-2">Current Status:</div>
        <div class="text-sm">{loadingProgress.currentStep}</div>
        {#if loadingProgress.currentDate}
          <div class="text-xs text-gray-600 mt-1">Date: {loadingProgress.currentDate}</div>
        {/if}
        {#if loadingProgress.currentBooking}
          <div class="text-xs text-gray-600 mt-1 truncate">Booking: {loadingProgress.currentBooking}</div>
        {/if}
      </div>

      <!-- Statistics -->
      <div class="stats stats-vertical lg:stats-horizontal shadow w-full mb-4">
        <div class="stat">
          <div class="stat-title">Created</div>
          <div class="stat-value text-success text-2xl">{loadingProgress.createdSchedules}</div>
        </div>
        <div class="stat">
          <div class="stat-title">Skipped</div>
          <div class="stat-value text-warning text-2xl">{loadingProgress.skippedSchedules}</div>
        </div>
        <div class="stat">
          <div class="stat-title">Issues</div>
          <div class="stat-value text-error text-2xl">{loadingProgress.conflicts.length}</div>
        </div>
      </div>

      <!-- Loading Animation -->
      <div class="flex justify-center mt-4">
        <div class="loading loading-dots loading-lg text-primary"></div>
      </div>
    </div>
  </div>
{/if}

{#if show}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg">Publish Week to Live Schedule</h3>
      <p class="py-4">
        Publish all complete group bookings for <strong>{getWeekRange(currentWeekStart)}</strong>?
      </p>
      <div class="alert alert-warning">
        <span
          >⚠️ This will create Tuesday to Friday group schedules for each template and make them visible to students and
          teachers</span
        >
      </div>
      <div class="modal-action">
        <button class="btn" onclick={closeModal}>Cancel</button>
        <button class="btn btn-primary" onclick={goLiveWithGroupBookings} disabled={isGoingLive}>
          {#if isGoingLive}
            <span class="loading loading-spinner loading-sm"></span>
          {/if}
          {isGoingLive ? 'Publishing...' : '🚀 Publish'}
        </button>
      </div>
    </div>
  </div>
{/if}
