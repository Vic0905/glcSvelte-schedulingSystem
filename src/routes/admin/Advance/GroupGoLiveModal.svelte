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

  const goLiveWithBookings = async () => {
    try {
      isGoingLive = true

      // Initialize loading progress
      loadingProgress.show = true
      loadingProgress.currentStep = 'Preparing...'
      loadingProgress.processedBookings = 0
      loadingProgress.createdSchedules = 0
      loadingProgress.skippedSchedules = 0
      loadingProgress.conflicts = []

      const weekDates = []
      const start = new Date(currentWeekStart)
      const sunday = new Date(start)
      sunday.setDate(start.getDate() - start.getDay())

      // Generate Tuesday (2) through Friday (5)
      for (let i = 2; i <= 5; i++) {
        const date = new Date(sunday)
        date.setDate(sunday.getDate() + i)
        weekDates.push(date.toISOString().split('T')[0])
      }

      // Step 1: Load group bookings from groupAdvanceBooking
      loadingProgress.currentStep = 'Loading group bookings...'
      await new Promise((resolve) => setTimeout(resolve, 500))

      const groupBookings = await pb.collection('groupAdvanceBooking').getFullList({
        filter: `teacher != "" && subject != ""`,
        expand: 'teacher,student,subject,grouproom,timeslot',
      })

      if (groupBookings.length === 0) {
        loadingProgress.show = false
        toast.error('No complete group bookings found to publish')
        return
      }

      loadingProgress.totalBookings = groupBookings.length
      loadingProgress.totalSchedules = groupBookings.length * weekDates.length
      loadingProgress.currentStep = 'Checking for conflicts...'

      // Step 2: Fetch all existing GROUP schedules for the week at once
      const dateFilters = weekDates.map((d) => `date = "${d}"`).join(' || ')
      const existingSchedules = await pb.collection('groupLessonSchedule').getFullList({
        filter: dateFilters,
      })

      // Create conflict checking sets
      const existingScheduleKeys = new Set(existingSchedules.map((s) => `${s.date}_${s.grouproom}_${s.timeslot}`))
      const teacherConflicts = new Set(existingSchedules.map((s) => `${s.date}_${s.teacher}_${s.timeslot}`))

      // For student conflicts, we need to check each student in the array
      const studentConflicts = new Set()
      existingSchedules.forEach((schedule) => {
        if (schedule.student && Array.isArray(schedule.student)) {
          schedule.student.forEach((studentId) => {
            studentConflicts.add(`${schedule.date}_${studentId}_${schedule.timeslot}`)
          })
        }
      })

      // Step 3: Build batch of schedules to create
      const schedulesToCreate = []
      let skippedCount = 0
      const conflicts = []

      for (let bookingIndex = 0; bookingIndex < groupBookings.length; bookingIndex++) {
        const booking = groupBookings[bookingIndex]

        loadingProgress.currentBooking = `${booking.expand?.teacher?.name} - Group (${booking.expand?.subject?.name})`
        loadingProgress.processedBookings = bookingIndex + 1

        for (const date of weekDates) {
          const scheduleKey = `${date}_${booking.grouproom}_${booking.timeslot}`
          const teacherKey = `${date}_${booking.teacher}_${booking.timeslot}`

          // Check for conflicts
          if (existingScheduleKeys.has(scheduleKey)) {
            skippedCount++
            continue
          }

          let hasConflict = false

          // Check teacher conflict
          if (teacherConflicts.has(teacherKey)) {
            conflicts.push(`${date} - Teacher ${booking.expand?.teacher?.name} already booked`)
            hasConflict = true
          }

          // Check each student for conflicts (FIXED: no else if, check all)
          if (booking.student && Array.isArray(booking.student)) {
            for (const studentId of booking.student) {
              const studentKey = `${date}_${studentId}_${booking.timeslot}`
              if (studentConflicts.has(studentKey)) {
                conflicts.push(`${date} - Student conflict`)
                hasConflict = true
                break // No need to check other students if one has conflict
              }
            }
          }

          if (hasConflict) {
            skippedCount++
            loadingProgress.skippedSchedules = skippedCount
            loadingProgress.conflicts = [...conflicts]
            continue
          }

          // Add to batch - note the field names match groupLessonSchedule
          schedulesToCreate.push({
            date: date,
            teacher: booking.teacher,
            student: booking.student || [], // Array of student IDs
            subject: booking.subject,
            grouproom: booking.grouproom, // Note: field is grouproom, not room
            timeslot: booking.timeslot,
            status: 'scheduled',
          })
        }
      }

      loadingProgress.currentStep = `Creating ${schedulesToCreate.length} group schedules...`

      // Step 4: Use PocketBase Batch API (50 operations per batch max)
      const BATCH_SIZE = 50
      let createdCount = 0
      let failedBatches = 0

      for (let i = 0; i < schedulesToCreate.length; i += BATCH_SIZE) {
        const chunk = schedulesToCreate.slice(i, i + BATCH_SIZE)

        try {
          // Create a new batch instance
          const batch = pb.createBatch()

          // Add all creates to the batch - writing to groupLessonSchedule
          chunk.forEach((schedule) => {
            batch.collection('groupLessonSchedule').create(schedule)
          })

          // Execute the batch - sends all operations in ONE HTTP request
          await batch.send()

          createdCount += chunk.length
          loadingProgress.createdSchedules = createdCount
          loadingProgress.currentStep = `Created ${createdCount} / ${schedulesToCreate.length} group schedules...`
        } catch (error) {
          console.error('Batch create failed:', error)
          failedBatches++

          // Optionally fall back to individual creates for this batch
          console.warn('Falling back to individual creates for failed batch')
          for (const schedule of chunk) {
            try {
              await pb.collection('groupLessonSchedule').create(schedule)
              createdCount++
            } catch (err) {
              console.error('Failed to create group schedule:', err)
            }
          }
          loadingProgress.createdSchedules = createdCount
        }

        // Small delay between batches
        if (i + BATCH_SIZE < schedulesToCreate.length) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      if (failedBatches > 0) {
        console.warn(`${failedBatches} batches failed`)
      }

      // Final step
      loadingProgress.currentStep = 'Finalizing...'
      await new Promise((resolve) => setTimeout(resolve, 500))

      const conflictSummary = conflicts.length > 0 ? ` ${conflicts.length} conflicts were skipped.` : ''
      toast.success(
        `Published ${createdCount} GROUP schedules to live system. ${skippedCount > 0 ? `Skipped ${skippedCount} existing/conflicting schedules.` : ''}${conflictSummary}`
      )

      closeModal()
      loadingProgress.show = false
    } catch (error) {
      console.error('Error going live with groups:', error)
      toast.error('Failed to publish group schedules')
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
      <h3 class="font-bold text-lg mb-4">🚀 Publishing GROUP Schedules to Live System</h3>

      <!-- Overall Progress -->
      <div class="mb-6">
        <div class="flex justify-between text-sm mb-2">
          <span>Overall Progress</span>
          <span>{loadingProgress.createdSchedules} / {loadingProgress.totalSchedules} group schedules created</span>
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
        {#if loadingProgress.currentBooking}
          <div class="text-xs text-gray-600 mt-1">Processing: {loadingProgress.currentBooking}</div>
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
          <div class="stat-title">Conflicts</div>
          <div class="stat-value text-error text-2xl">{loadingProgress.conflicts.length}</div>
        </div>
      </div>

      <!-- Recent Conflicts -->
      {#if loadingProgress.conflicts.length > 0}
        <div class="bg-orange-50 border border-orange-200 rounded-lg p-3">
          <div class="text-sm font-semibold text-orange-800 mb-2">Recent Conflicts:</div>
          <div class="text-xs text-orange-700 max-h-20 overflow-y-auto">
            {#each loadingProgress.conflicts.slice(-5) as conflict}
              <div>• {conflict}</div>
            {/each}
            {#if loadingProgress.conflicts.length > 5}
              <div class="text-orange-600">... and {loadingProgress.conflicts.length - 5} more</div>
            {/if}
          </div>
        </div>
      {/if}

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
      <h3 class="font-bold text-lg">Publish Group Week to Live Schedule</h3>
      <p class="py-4">
        Publish all complete GROUP bookings for <strong>{getWeekRange(currentWeekStart)}</strong>?
      </p>
      <div class="alert alert-warning">
        <span
          >⚠️ This will create Tuesday to Friday schedules for each group template and make them visible to students and
          teachers</span
        >
      </div>
      <div class="modal-action">
        <button class="btn" onclick={closeModal}>Cancel</button>
        <button class="btn btn-primary" onclick={goLiveWithBookings} disabled={isGoingLive}>
          {#if isGoingLive}
            <span class="loading loading-spinner loading-sm"></span>
          {/if}
          {isGoingLive ? 'Publishing Groups...' : '🚀 Publish Groups'}
        </button>
      </div>
    </div>
  </div>
{/if}
