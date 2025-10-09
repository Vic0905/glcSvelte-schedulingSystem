<script>
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let { show = $bindable(false), getWeekRange, currentWeekStart, getWeekDates } = $props()

  let targetWeekStart = $state('')
  let copying = $state(false)
  let copyMode = $state('current') // 'current' or 'custom'

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

  // Initialize target week to current week when modal opens
  $effect(() => {
    if (show && !targetWeekStart) {
      targetWeekStart = currentWeekStart
    }
  })

  function closeModal() {
    show = false
    targetWeekStart = ''
    copyMode = 'current'
    loadingProgress.show = false
  }

  function setTargetToCurrentWeek() {
    targetWeekStart = currentWeekStart
    copyMode = 'current'
  }

  function setCustomWeek() {
    copyMode = 'custom'
  }

  const goLiveWithGroupBookings = async () => {
    if (!targetWeekStart) {
      toast.error('Please select a target week')
      return
    }

    try {
      copying = true

      // Initialize loading progress
      loadingProgress.show = true
      loadingProgress.currentStep = 'Preparing...'
      loadingProgress.processedBookings = 0
      loadingProgress.createdSchedules = 0
      loadingProgress.skippedSchedules = 0
      loadingProgress.conflicts = []

      // ✅ Force-generate Tuesday–Friday dates for this week
      const weekDates = []
      const start = new Date(targetWeekStart)
      for (let i = 2; i <= 5; i++) {
        const date = new Date(start)
        date.setDate(start.getDate() + (i - start.getDay()))
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
      copying = false
    }
  }

  // Helper function to change target week
  const changeTargetWeek = (weeks) => {
    const monday = new Date(targetWeekStart)
    monday.setDate(monday.getDate() + weeks * 7)
    targetWeekStart = monday.toISOString().split('T')[0]
    copyMode = 'custom'
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

{#if show && !loadingProgress.show}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl w-full space-y-6">
      <h3 class="text-xl font-bold text-center">🚀 Go Live - Group Schedule Templates</h3>

      <div class="space-y-4">
        <p class="text-sm text-base-content/80">
          Copy your advance group schedule templates to create actual schedules for a specific week. This will create
          group lesson schedules for Tuesday through Friday.
        </p>

        <!-- Current Week Option -->
        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text font-medium">Current Week ({getWeekRange(currentWeekStart)})</span>
            <input
              type="radio"
              name="copyMode"
              class="radio radio-primary"
              checked={copyMode === 'current'}
              onchange={setTargetToCurrentWeek}
            />
          </label>
        </div>

        <!-- Custom Week Option -->
        <div class="form-control">
          <label class="label cursor-pointer">
            <span class="label-text font-medium">Custom Week</span>
            <input
              type="radio"
              name="copyMode"
              class="radio radio-primary"
              checked={copyMode === 'custom'}
              onchange={setCustomWeek}
            />
          </label>
        </div>

        {#if copyMode === 'custom'}
          <div class="ml-6 space-y-3">
            <div class="flex items-center gap-2">
              <button class="btn btn-outline btn-sm" onclick={() => changeTargetWeek(-1)}>
                &larr; Previous Week
              </button>
              <input
                type="date"
                bind:value={targetWeekStart}
                class="input input-bordered input-sm flex-1"
                placeholder="Select Monday of target week"
              />
              <button class="btn btn-outline btn-sm" onclick={() => changeTargetWeek(1)}> Next Week &rarr; </button>
            </div>
            {#if targetWeekStart}
              <p class="text-sm text-base-content/60">
                Target week: {getWeekRange(targetWeekStart)}
              </p>
            {/if}
          </div>
        {/if}

        <!-- Warning -->
        <div class="alert alert-warning">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div>
            <h4 class="font-medium">Warning</h4>
            <p class="text-sm">
              This action will create new group lesson schedules for Tuesday to Friday. Existing schedules for the same
              time slots will be skipped to preserve your manual changes.
            </p>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="modal-action">
        <button class="btn btn-primary" onclick={goLiveWithGroupBookings} disabled={copying || !targetWeekStart}>
          {copying ? 'Processing...' : '🚀 Go Live'}
          {#if copying}
            <span class="loading loading-spinner loading-sm"></span>
          {/if}
        </button>
        <button class="btn" onclick={closeModal} disabled={copying}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
