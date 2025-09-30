<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), getWeekRange, currentWeekStart, getWeekDates } = $props()

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

      const weekDates = getWeekDates(currentWeekStart)

      // Step 1: Load advance bookings
      loadingProgress.currentStep = 'Loading advance bookings...'
      await new Promise((resolve) => setTimeout(resolve, 500)) // Small delay for UI

      const advanceBookings = await pb.collection('advanceBooking').getFullList({
        filter: `teacher != "" && student != "" && subject != ""`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (advanceBookings.length === 0) {
        loadingProgress.show = false
        toast.error('No complete bookings found to publish')
        return
      }

      loadingProgress.totalBookings = advanceBookings.length
      loadingProgress.totalSchedules = advanceBookings.length * weekDates.length
      loadingProgress.currentStep = `Processing ${advanceBookings.length} bookings for ${weekDates.length} days...`

      let publishedCount = 0
      let skippedCount = 0
      const conflicts = []

      for (let bookingIndex = 0; bookingIndex < advanceBookings.length; bookingIndex++) {
        const booking = advanceBookings[bookingIndex]

        // Update current booking info
        loadingProgress.currentBooking = `${booking.expand?.teacher?.name} - ${booking.expand?.student?.name} (${booking.expand?.subject?.name})`
        loadingProgress.processedBookings = bookingIndex + 1

        for (let dateIndex = 0; dateIndex < weekDates.length; dateIndex++) {
          const date = weekDates[dateIndex]
          loadingProgress.currentDate = new Date(date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })
          loadingProgress.currentStep = `Processing ${loadingProgress.currentBooking} for ${loadingProgress.currentDate}`

          // Small delay to show progress
          if ((bookingIndex * weekDates.length + dateIndex) % 3 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }

          try {
            const existingSchedule = await pb.collection('lessonSchedule').getFullList({
              filter: `date = "${date}" && room = "${booking.room}" && timeslot = "${booking.timeslot}"`,
            })

            if (existingSchedule.length > 0) {
              skippedCount++
              loadingProgress.skippedSchedules = skippedCount
              continue
            }

            const conflictChecks = [
              {
                filter: `student = "${booking.student}" && date = "${date}" && timeslot = "${booking.timeslot}"`,
                type: 'Student',
              },
              {
                filter: `teacher = "${booking.teacher}" && date = "${date}" && timeslot = "${booking.timeslot}"`,
                type: 'Teacher',
              },
              {
                filter: `room = "${booking.room}" && date = "${date}" && timeslot = "${booking.timeslot}"`,
                type: 'Room',
              },
            ]

            let hasConflict = false
            for (const { filter, type } of conflictChecks) {
              try {
                await pb.collection('lessonSchedule').getFirstListItem(filter)
                const conflictMsg = `${loadingProgress.currentDate} - ${type} conflict`
                conflicts.push(conflictMsg)
                loadingProgress.conflicts = [...conflicts]
                hasConflict = true
                skippedCount++
                loadingProgress.skippedSchedules = skippedCount
                break
              } catch {
                // No conflict found, continue
              }
            }

            if (!hasConflict) {
              const liveSchedule = {
                date: date,
                teacher: booking.teacher,
                student: booking.student,
                subject: booking.subject,
                room: booking.room,
                timeslot: booking.timeslot,
                status: 'scheduled',
              }

              await pb.collection('lessonSchedule').create(liveSchedule)
              publishedCount++
              loadingProgress.createdSchedules = publishedCount
            }
          } catch (error) {
            console.error(`Error processing booking for ${date}:`, error)
            skippedCount++
            loadingProgress.skippedSchedules = skippedCount
          }
        }
      }

      // Final step
      loadingProgress.currentStep = 'Finalizing...'
      await new Promise((resolve) => setTimeout(resolve, 500))

      const conflictSummary = conflicts.length > 0 ? ` ${conflicts.length} conflicts were skipped.` : ''
      toast.success(
        `Published ${publishedCount} schedules to live system. ${skippedCount > 0 ? `Skipped ${skippedCount} existing/conflicting schedules.` : ''}${conflictSummary}`
      )

      closeModal()
      loadingProgress.show = false
    } catch (error) {
      console.error('Error going live:', error)
      toast.error('Failed to publish schedules')
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
      <h3 class="font-bold text-lg mb-4">🚀 Publishing Schedules to Live System</h3>

      <!-- Overall Progress -->
      <div class="mb-6">
        <div class="flex justify-between text-sm mb-2">
          <span>Overall Progress</span>
          <span>{loadingProgress.createdSchedules} / {loadingProgress.totalSchedules} schedules created</span>
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
          <span>Processing Bookings</span>
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
      <h3 class="font-bold text-lg">Publish Week to Live Schedule</h3>
      <p class="py-4">
        Publish all complete bookings for <strong>{getWeekRange(currentWeekStart)}</strong>?
      </p>
      <div class="alert alert-warning">
        <span
          >⚠️ This will create Monday-Friday schedules for each template and make them visible to students and teachers</span
        >
      </div>
      <div class="modal-action">
        <button class="btn" onclick={closeModal}>Cancel</button>
        <button class="btn btn-primary" onclick={goLiveWithBookings} disabled={isGoingLive}>
          {#if isGoingLive}
            <span class="loading loading-spinner loading-sm"></span>
          {/if}
          {isGoingLive ? 'Publishing...' : '🚀 Publish'}
        </button>
      </div>
    </div>
  </div>
{/if}
