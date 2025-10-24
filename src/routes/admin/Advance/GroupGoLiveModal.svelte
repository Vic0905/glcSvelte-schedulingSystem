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

      // ✅ Generate Tuesday–Friday dates correctly
      const weekDates = []
      const start = new Date(currentWeekStart)
      // Get to Sunday of this week (day 0)
      const sunday = new Date(start)
      sunday.setDate(start.getDate() - start.getDay())

      // Generate Tuesday (2) through Friday (5)
      for (let i = 2; i <= 5; i++) {
        const date = new Date(sunday)
        date.setDate(sunday.getDate() + i)
        weekDates.push(date.toISOString().split('T')[0])
      }

      // Step 1: Load advance group bookings
      loadingProgress.currentStep = 'Loading advance group bookings...'
      await new Promise((resolve) => setTimeout(resolve, 500)) // Small delay for UI

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
      loadingProgress.currentStep = `Processing ${advanceBookings.length} group bookings for ${weekDates.length} days (Tuesday to Friday)...`

      let createdCount = 0
      let skippedCount = 0
      const conflicts = []

      for (let bookingIndex = 0; bookingIndex < advanceBookings.length; bookingIndex++) {
        const booking = advanceBookings[bookingIndex]

        // Update current booking info
        const teacherName = booking.expand?.teacher?.name || 'Unknown Teacher'
        const subjectName = booking.expand?.subject?.name || 'Unknown Subject'
        const studentNames = Array.isArray(booking.expand?.student)
          ? booking.expand.student.map((s) => s.name).join(', ')
          : booking.expand?.student?.name || 'Unknown Students'

        loadingProgress.currentBooking = `${teacherName} - ${subjectName} (${studentNames})`
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
            // Check if a schedule already exists for this date/room/timeslot
            const existingSchedules = await pb.collection('groupLessonSchedule').getFullList({
              filter: `date = "${date}" && grouproom = "${booking.grouproom}" && timeslot = "${booking.timeslot}"`,
            })

            // If schedule already exists, skip it
            if (existingSchedules.length > 0) {
              const skipMsg = `${loadingProgress.currentDate} - Schedule already exists for ${subjectName}`
              conflicts.push(skipMsg)
              loadingProgress.conflicts = [...conflicts]
              skippedCount++
              loadingProgress.skippedSchedules = skippedCount
              continue
            }

            const scheduleData = {
              date: date,
              grouproom: booking.grouproom,
              timeslot: booking.timeslot,
              subject: booking.subject,
              teacher: booking.teacher,
              student: booking.student, // This should be an array of student IDs
              status: 'scheduled',
            }

            // Check for potential conflicts (teacher/room conflicts)
            const conflictChecks = [
              {
                filter: `teacher = "${booking.teacher}" && date = "${date}" && timeslot = "${booking.timeslot}"`,
                type: 'Teacher',
              },
              {
                filter: `grouproom = "${booking.grouproom}" && date = "${date}" && timeslot = "${booking.timeslot}"`,
                type: 'Room',
              },
            ]

            let hasConflict = false
            for (const { filter, type } of conflictChecks) {
              try {
                await pb.collection('groupLessonSchedule').getFirstListItem(filter)
                const conflictMsg = `${loadingProgress.currentDate} - ${type} conflict for ${subjectName}`
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
              // Create new schedule
              await pb.collection('groupLessonSchedule').create(scheduleData)
              createdCount++
              loadingProgress.createdSchedules = createdCount
            }
          } catch (error) {
            console.error(`Error processing group booking for ${date}:`, error)
            const errorMsg = `${loadingProgress.currentDate} - Processing error for ${subjectName}`
            conflicts.push(errorMsg)
            loadingProgress.conflicts = [...conflicts]
            skippedCount++
            loadingProgress.skippedSchedules = skippedCount
          }
        }
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
