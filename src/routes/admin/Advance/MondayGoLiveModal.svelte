<script>
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { show = $bindable(false), getMondayDisplay, currentMonday, getMondayDate } = $props()

  let isProcessing = $state(false)
  let result = $state({ success: 0, failed: 0, errors: [] })

  async function goLive() {
    if (isProcessing) return

    const mondayDate = getMondayDate()
    const confirmMessage = `🚀 Go Live for ${getMondayDisplay(mondayDate)}?\n\nThis will copy all Monday advance bookings to the live schedule for this specific Monday.`

    if (!confirm(confirmMessage)) return

    isProcessing = true
    result = { success: 0, failed: 0, errors: [] }

    try {
      // Step 1: Get all Monday advance bookings
      const mondayBookings = await pb.collection('mondayAdvanceBooking').getFullList({
        expand: 'teacher,student,subject,room,timeslot',
      })

      if (mondayBookings.length === 0) {
        alert('⚠️ No Monday advance bookings found to publish.')
        isProcessing = false
        return
      }

      // Step 2: Fetch all existing schedules for this Monday at once
      let existingSchedules = []
      try {
        existingSchedules = await pb.collection('mondayLessonSchedule').getFullList({
          filter: `date = "${mondayDate}"`,
        })
      } catch (err) {
        if (err.status !== 404) throw err
        // No existing schedules, that's fine
      }

      // Create a Map for quick lookup: "room_timeslot" -> existing schedule
      const existingMap = new Map(existingSchedules.map((s) => [`${s.room}_${s.timeslot}`, s]))

      // Step 3: Prepare batch operations
      const schedulesToCreate = []
      const schedulesToUpdate = []

      for (const booking of mondayBookings) {
        const scheduleData = {
          date: mondayDate,
          room: booking.room,
          timeslot: booking.timeslot,
          teacher: booking.teacher,
          student: booking.student,
          subject: booking.subject,
          status: 'scheduled',
          hiddenDetails: booking.hiddenDetails || false,
        }

        const key = `${booking.room}_${booking.timeslot}`
        const existing = existingMap.get(key)

        if (existing) {
          // Schedule to update
          schedulesToUpdate.push({ id: existing.id, data: scheduleData, booking })
        } else {
          // Schedule to create
          schedulesToCreate.push({ data: scheduleData, booking })
        }
      }

      // Step 4: Batch create new schedules
      const BATCH_SIZE = 50
      let successCount = 0
      let failedCount = 0
      const errors = []

      // Create in batches
      for (let i = 0; i < schedulesToCreate.length; i += BATCH_SIZE) {
        const batch = schedulesToCreate.slice(i, i + BATCH_SIZE)

        const createPromises = batch.map(({ data, booking }) =>
          pb
            .collection('mondayLessonSchedule')
            .create(data)
            .then(() => ({ success: true }))
            .catch((error) => ({
              success: false,
              booking,
              error: error.message,
            }))
        )

        const results = await Promise.all(createPromises)

        results.forEach((result, idx) => {
          if (result.success) {
            successCount++
          } else {
            failedCount++
            const booking = batch[idx].booking
            errors.push({
              room: booking.expand?.room?.name || 'Unknown',
              timeslot: `${booking.expand?.timeslot?.start || ''} - ${booking.expand?.timeslot?.end || ''}`,
              error: result.error,
            })
          }
        })
      }

      // Step 5: Batch update existing schedules
      for (let i = 0; i < schedulesToUpdate.length; i += BATCH_SIZE) {
        const batch = schedulesToUpdate.slice(i, i + BATCH_SIZE)

        const updatePromises = batch.map(({ id, data, booking }) =>
          pb
            .collection('mondayLessonSchedule')
            .update(id, data)
            .then(() => ({ success: true }))
            .catch((error) => ({
              success: false,
              booking,
              error: error.message,
            }))
        )

        const results = await Promise.all(updatePromises)

        results.forEach((result, idx) => {
          if (result.success) {
            successCount++
          } else {
            failedCount++
            const booking = batch[idx].booking
            errors.push({
              room: booking.expand?.room?.name || 'Unknown',
              timeslot: `${booking.expand?.timeslot?.start || ''} - ${booking.expand?.timeslot?.end || ''}`,
              error: result.error,
            })
          }
        })
      }

      // Update result state
      result = {
        success: successCount,
        failed: failedCount,
        errors,
      }

      // Show results
      if (failedCount === 0) {
        alert(`✅ Success! Published ${successCount} Monday bookings to live schedule.`)
        show = false
      } else {
        alert(
          `⚠️ Partially completed:\n✅ Success: ${successCount}\n❌ Failed: ${failedCount}\n\nCheck the modal for error details.`
        )
      }
    } catch (error) {
      console.error('Error going live:', error)
      alert('❌ Failed to publish Monday schedule. Check console for details.')
    } finally {
      isProcessing = false
    }
  }

  function resetResult() {
    result = { success: 0, failed: 0, errors: [] }
  }

  $effect(() => {
    if (!show) {
      resetResult()
    }
  })
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">🚀 Go Live - Monday Schedule</h3>

      <div class="space-y-4">
        <div class="alert alert-info">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <div>
            <div class="font-bold">Publishing Monday Schedule</div>
            <div class="text-sm">{getMondayDisplay(currentMonday)}</div>
          </div>
        </div>

        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold mb-2">What will happen:</h4>
          <ul class="list-disc list-inside space-y-1 text-sm">
            <li>All Monday advance bookings will be copied to the live schedule</li>
            <li>Date will be set to: {currentMonday}</li>
            <li>Existing schedules for this date/room/timeslot will be updated</li>
            <li>Status will be set to "scheduled"</li>
          </ul>
        </div>

        {#if result.success > 0 || result.failed > 0}
          <div class="bg-base-200 p-4 rounded-lg">
            <h4 class="font-semibold mb-2">Results:</h4>
            <div class="stats stats-vertical lg:stats-horizontal shadow w-full">
              <div class="stat">
                <div class="stat-title">Success</div>
                <div class="stat-value text-success">{result.success}</div>
              </div>
              <div class="stat">
                <div class="stat-title">Failed</div>
                <div class="stat-value text-error">{result.failed}</div>
              </div>
            </div>

            {#if result.errors.length > 0}
              <div class="mt-4">
                <h5 class="font-semibold text-error mb-2">Errors:</h5>
                <div class="max-h-40 overflow-auto space-y-2">
                  {#each result.errors as error}
                    <div class="alert alert-error py-2">
                      <div class="text-xs">
                        <div><strong>Room:</strong> {error.room}</div>
                        <div><strong>Time:</strong> {error.timeslot}</div>
                        <div><strong>Error:</strong> {error.error}</div>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn" onclick={() => (show = false)} disabled={isProcessing}>
          {result.success > 0 || result.failed > 0 ? 'Close' : 'Cancel'}
        </button>
        {#if result.success === 0 && result.failed === 0}
          <button class="btn btn-primary" onclick={goLive} disabled={isProcessing}>
            {isProcessing ? 'Publishing...' : '🚀 Publish to Live'}
          </button>
        {/if}
      </div>
    </div>
    <div class="modal-backdrop" onclick={() => (show = false)}></div>
  </div>
{/if}
