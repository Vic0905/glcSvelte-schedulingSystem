<script>
  import { createEventDispatcher } from 'svelte'
  import { toast } from 'svelte-sonner'
  // import { booking } from './schedule.svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const dispatch = createEventDispatcher()

  let show = $state(false)
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let groupRooms = $state([])
  let timeslots = $state([])
  let saving = $state(false)
  let selectedStudents = $state([])
  let maxStudentsAllowed = $state(0)
  let searchTerm = $state('')
  let dataLoaded = $state(false)

  // Track which graduated students to remove when saving
  let graduatedStudentsToRemove = $state(new Set())

  // Store existing bookings for filtering
  let existingBookings = $state([])

  // Show modal method (called from parent)
  export function showModal() {
    show = true

    if (!dataLoaded) {
      loadAllData()
    } else {
      // Refresh existing bookings when modal opens
      loadExistingBookings()
    }

    // Initialize selected students from booking data
    if (booking?.data?.mode === 'edit' && Array.isArray(booking.data.students)) {
      selectedStudents = booking.data.students.map((student) => student.id || student).filter((id) => id)
    } else {
      selectedStudents = []
    }

    // Reset graduated students to remove
    graduatedStudentsToRemove = new Set()

    setMaxStudentsAllowed()
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
    graduatedStudentsToRemove = new Set()
  }

  const loadAllData = async () => {
    if (dataLoaded) return

    try {
      const [subjectsData, studentsData, teachersData, groupRoomsData, timeslotsData] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name', fields: 'id,name' }),
        pb.collection('student').getFullList({ sort: 'englishName', fields: 'id,englishName,status' }),
        pb.collection('teacher').getFullList({ sort: 'name', fields: 'id,name,status' }),
        pb.collection('groupRoom').getFullList({ sort: 'name', fields: 'id,name,maxstudents' }),
        pb.collection('timeslot').getFullList({ sort: 'start', fields: 'id,start,end' }),
      ])

      subjects = subjectsData
      groupRooms = groupRoomsData
      timeslots = timeslotsData

      // Load existing bookings for filtering
      await loadExistingBookings()

      // Create map for student booking counts
      const studentBookingCount = new Map()
      existingBookings.forEach((booking) => {
        const studentIds = booking.student || []
        if (Array.isArray(studentIds)) {
          studentIds.forEach((studentId) => {
            if (studentId) {
              studentBookingCount.set(studentId, (studentBookingCount.get(studentId) || 0) + 1)
            }
          })
        }
      })

      // Filter students: show non-graduated OR graduated with existing bookings OR currently selected
      students = studentsData.filter((student) => {
        if (student.status !== 'graduated') return true

        // For graduated students, only show if they have existing bookings
        // OR if this is the currently selected student (for editing)
        const hasBookings = studentBookingCount.has(student.id)
        const isCurrentlySelected =
          selectedStudents.includes(student.id) ||
          booking?.data?.students?.some((s) => (typeof s === 'object' ? s.id : s) === student.id)

        return hasBookings || isCurrentlySelected
      })

      // Create map for teacher booking counts
      const teacherBookingCount = new Map()
      existingBookings.forEach((booking) => {
        const teacherId = booking.teacher
        if (teacherId) {
          teacherBookingCount.set(teacherId, (teacherBookingCount.get(teacherId) || 0) + 1)
        }
      })

      // Filter teachers: show non-disabled OR disabled with existing bookings OR currently selected
      teachers = teachersData.filter((teacher) => {
        if (teacher.status !== 'disabled') return true

        // For disabled teachers, only show if they have existing bookings
        // OR if this is the currently selected teacher (for editing)
        const hasBookings = teacherBookingCount.has(teacher.id)
        const isCurrentlySelected = booking?.data?.teacher?.id === teacher.id

        return hasBookings || isCurrentlySelected
      })

      dataLoaded = true
    } catch (err) {
      console.error('Error loading data:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  const loadExistingBookings = async () => {
    try {
      existingBookings = await pb.collection('GrpSchedule').getFullList({
        $autoCancel: false,
      })
    } catch (error) {
      console.error('Error loading existing bookings:', error)
      existingBookings = []
    }
  }

  const checkForConflicts = async () => {
    const { teacher, timeslot, startDate, groupRoom, mode, id } = booking.data

    if (!teacher?.id || !timeslot?.id || !startDate || !groupRoom?.id) return true

    try {
      const baseFilter = `timeslot = "${timeslot.id}" && start = "${startDate}"`

      // If editing, exclude current record
      const excludeFilter = mode === 'edit' ? ` && id != "${id}"` : ''

      // ONLY 3 QUERIES TOTAL (matches your indexes)

      const [teacherConflict, roomConflict, studentConflict] = await Promise.all([
        pb
          .collection('GrpSchedule')
          .getFirstListItem(`teacher = "${teacher.id}" && ${baseFilter}${excludeFilter}`)
          .catch(() => null),

        pb
          .collection('GrpSchedule')
          .getFirstListItem(`grouproom = "${groupRoom.id}" && ${baseFilter}${excludeFilter}`)
          .catch(() => null),

        selectedStudents.length
          ? pb
              .collection('GrpSchedule')
              .getFirstListItem(
                `(${selectedStudents.map((id) => `student ~ "${id}"`).join(' || ')}) && ${baseFilter}${excludeFilter}`
              )
              .catch(() => null)
          : null,
      ])

      // ---- TEACHER CONFLICT ----
      if (teacherConflict) {
        toast.error('Teacher already has a schedule for this timeslot')
        return false
      }

      // ---- ROOM CONFLICT ----
      if (roomConflict) {
        toast.error('Room is already occupied for this timeslot')
        return false
      }

      // ---- STUDENT CONFLICT ----
      if (studentConflict) {
        toast.error('One or more students already have a schedule for this timeslot')
        return false
      }

      return true
    } catch (err) {
      console.error('Conflict check error:', err)
      return true
    }
  }

  const validateForm = () => {
    const { subject, groupRoom, teacher, timeslot, startDate, endDate } = booking.data

    if (!subject?.id) {
      toast.error('Please select Subject')
      return false
    }

    if (!groupRoom?.id) {
      toast.error('Please select Group Room')
      return false
    }

    if (!teacher?.id) {
      toast.error('Please select Teacher')
      return false
    }

    if (!timeslot?.id) {
      toast.error('Please select Timeslot')
      return false
    }

    if (!startDate) {
      toast.error('Please select Start Date')
      return false
    }

    if (!endDate) {
      toast.error('Please select End Date')
      return false
    }

    // Filter out graduated students that are marked for removal
    const activeStudents = selectedStudents.filter((id) => !graduatedStudentsToRemove.has(id))

    if (!Array.isArray(activeStudents) || activeStudents.length === 0) {
      toast.error('Please select at least one active student')
      return false
    }

    // Validate date range
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (start > end) {
      toast.error('Start date must be before end date')
      return false
    }

    return true
  }

  function setMaxStudentsAllowed() {
    if (booking?.data?.groupRoom?.id && Array.isArray(groupRooms) && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === booking.data.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = booking?.data?.groupRoom?.maxstudents || 0
    }
  }

  function onGroupRoomChange() {
    setMaxStudentsAllowed()
    if (selectedStudents.length > maxStudentsAllowed && maxStudentsAllowed > 0) {
      selectedStudents = selectedStudents.slice(0, maxStudentsAllowed)
      toast.warning(`Student selection limited to ${maxStudentsAllowed} students for this room`)
    }
  }

  function toggleStudent(studentId) {
    const student = students.find((s) => s.id === studentId)
    const isSelected = selectedStudents.includes(studentId)
    const isGraduated = student?.status === 'graduated'

    // If trying to ADD a graduated student, show error
    if (!isSelected && isGraduated) {
      toast.error('Cannot add graduated student')
      return
    }

    // For non-graduated students, normal toggle logic
    if (!isGraduated) {
      if (!isSelected) {
        // Check if trying to ADD when at max capacity
        if (maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed) {
          toast.warning(`Maximum ${maxStudentsAllowed} students allowed for this room`)
          return
        }
        selectedStudents = [...selectedStudents, studentId]
      } else {
        // Remove non-graduated student
        selectedStudents = selectedStudents.filter((id) => id !== studentId)
      }
      return
    }

    // For graduated students: just toggle selection
    if (isSelected) {
      // Mark graduated student for removal when saving
      graduatedStudentsToRemove = new Set(graduatedStudentsToRemove).add(studentId)
      // Deselect immediately
      selectedStudents = selectedStudents.filter((id) => id !== studentId)
      toast.info(`Graduated student "${student?.englishName}" will be removed when you save`)
    } else {
      // If re-selecting a graduated student that was marked for removal
      const updated = new Set(graduatedStudentsToRemove)
      updated.delete(studentId)
      graduatedStudentsToRemove = updated
      selectedStudents = [...selectedStudents, studentId]
      toast.info(`Graduated student "${student?.englishName}" will be kept when you save`)
    }
  }

  function selectAllStudents() {
    // Filter out graduated students only (and those without bookings)
    const availableStudents = students.filter((s) => s.status !== 'graduated')

    if (maxStudentsAllowed > 0) {
      selectedStudents = availableStudents.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (availableStudents.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} available students due to room limit`)
      }
    } else {
      selectedStudents = availableStudents.map((s) => s.id)
    }

    // Clear any graduated students marked for removal
    graduatedStudentsToRemove = new Set()
  }

  function clearAllStudents() {
    selectedStudents = []
    graduatedStudentsToRemove = new Set()
  }

  const saveSchedule = async () => {
    if (!validateForm()) return

    // Check for conflicts and show toast if found
    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { subject, groupRoom, teacher, timeslot, mode, startDate, endDate } = booking.data

    // Filter out graduated students marked for removal
    const finalStudentList = selectedStudents.filter((id) => !graduatedStudentsToRemove.has(id))

    const scheduleData = {
      timeslot: timeslot.id,
      teacher: teacher.id,
      student: finalStudentList,
      subject: subject.id,
      grouproom: groupRoom.id,
    }

    toast.promise(
      async () => {
        saving = true
        try {
          if (mode === 'edit') {
            await pb.collection('GrpSchedule').update(booking.data.id, {
              ...scheduleData,
              start: startDate,
              end: endDate,
            })

            return 'Schedule updated!'
          } else {
            await pb.collection('GrpSchedule').create({
              ...scheduleData,
              start: startDate,
              end: endDate,
            })

            return 'Schedule created!'
          }
        } finally {
          saving = false
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          closeModal()
          dispatch('refresh')

          // Show summary of removed graduated students
          if (graduatedStudentsToRemove.size > 0) {
            const removedNames = Array.from(graduatedStudentsToRemove)
              .map((id) => students.find((s) => s.id === id)?.englishName || 'Unknown')
              .join(', ')
            toast.success(`Updated successfully. Removed graduated students: ${removedNames}`)
          }

          return 'Group schedule saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
  }

  const deleteSchedule = async () => {
    const { startDate, endDate, subject, teacher, groupRoom, timeslot } = booking.data

    const confirmMessage =
      `Are you sure you want to delete this group schedule?\n\n` +
      `Subject: ${subject.name}\n` +
      `Teacher: ${teacher.name}\n` +
      `Room: ${groupRoom.name}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    toast.promise(
      async () => {
        const originalTeacherId = booking.data.originalTeacherId || teacher.id
        const originalTimeslotId = booking.data.originalTimeslotId || timeslot.id
        const originalGroupRoomId = booking.data.originalGroupRoomId || groupRoom.id

        await pb.collection('GrpSchedule').delete(booking.data.id)
      },
      {
        loading: 'Deleting...',
        success: () => {
          closeModal()
          dispatch('refresh')
          return 'Weekly group schedule deleted!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to delete: ${error.message}`
        },
      }
    )
  }

  const filteredStudents = $derived(
    students.filter((s) => s.englishName.toLowerCase().includes(searchTerm.toLowerCase()))
  )
</script>

{#if show}
  <div class="modal modal-open">
    <div class="modal-box max-w-4xl w-full space-y-6 rounded-xl">
      <h3 class="text-xl font-bold text-center">
        {booking.data?.mode === 'edit' ? 'Edit' : 'Create'} Weekly Group Schedule
      </h3>

      {#if graduatedStudentsToRemove.size > 0}
        <div class="alert alert-warning">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.732 0L4.346 16.5c-.77.833.192 2.5 1.732 2.5z"
            /></svg
          >
          <span>
            {graduatedStudentsToRemove.size} graduated student{graduatedStudentsToRemove.size !== 1 ? 's' : ''} will be removed
            when you save
          </span>
        </div>
      {/if}

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
          This will {booking.data?.mode === 'edit' ? 'update' : 'create'} Single schedule per selected date range
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <label class="label"><span class="label-text">Subject</span></label>
            <select
              bind:value={booking.data.subject.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded}
            >
              <option value="">-- Select Subject --</option>
              {#each subjects as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>

          <!-- Students -->
          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Students ({selectedStudents.length} selected
                {#if maxStudentsAllowed > 0}
                  / {maxStudentsAllowed} max
                {/if})
              </span>
              <div class="space-x-2">
                <button type="button" class="btn btn-xs btn-outline" onclick={selectAllStudents} disabled={!dataLoaded}>
                  Select All
                </button>
                <button type="button" class="btn btn-xs btn-outline" onclick={clearAllStudents} disabled={!dataLoaded}>
                  Clear All
                </button>
              </div>
            </label>

            <div class="mb-2">
              <input
                type="text"
                class="input input-bordered w-full"
                placeholder="Search student..."
                bind:value={searchTerm}
                disabled={!dataLoaded}
              />
            </div>

            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto bg-base-100">
              {#each filteredStudents as student (student.id)}
                {@const isSelected = selectedStudents.includes(student.id)}
                {@const isGraduated = student.status === 'graduated'}
                {@const willBeRemoved = graduatedStudentsToRemove.has(student.id)}

                <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={isSelected && !willBeRemoved}
                      disabled={(!isSelected && isGraduated) || saving}
                      onchange={() => toggleStudent(student.id)}
                    />
                    <span
                      class="label-text"
                      class:opacity-50={!isSelected && isGraduated}
                      class:line-through={willBeRemoved}
                      class:text-warning={willBeRemoved}
                    >
                      {student.englishName}
                      {#if isGraduated}
                        <span class="text-xs ml-2">
                          {#if willBeRemoved}
                            (Graduated - will be removed)
                          {:else if isSelected}
                            (Graduated - click to mark for removal)
                          {:else}
                            (Graduated)
                          {/if}
                        </span>
                      {/if}
                    </span>
                  </label>
                </div>
              {/each}

              {#if filteredStudents.length === 0}
                <p class="text-sm text-base-content/100 text-center py-4">No matching students</p>
              {/if}
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="space-y-4">
          <!-- Teacher -->
          <div class="form-control">
            <label class="label"><span class="label-text">Teacher</span></label>
            <select
              bind:value={booking.data.teacher.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded}
            >
              <option value="">-- Select Teacher --</option>
              {#each teachers as t}
                <option
                  value={t.id}
                  disabled={t.status === 'disabled' && t.id !== booking.data.teacher?.id}
                  class:italic={t.status === 'disabled'}
                >
                  {t.name}
                  {#if t.status === 'disabled'}(Disabled){/if}
                </option>
              {/each}
            </select>
            {#if booking.data.teacher?.id && teachers.find((t) => t.id === booking.data.teacher.id)?.status === 'disabled'}
              <div class="text-xs text-warning mt-1">⚠️ This teacher is disabled but has existing bookings</div>
            {/if}
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={booking.data.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
              disabled={!dataLoaded}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as room}
                <option value={room.id}>
                  {room.name} (Max: {room.maxstudents} students)
                </option>
              {/each}
            </select>
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select
              bind:value={booking.data.timeslot.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded}
            >
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Start date -->
          <div class="form-control">
            <label class="label"><span class="label-text">Start date</span></label>
            <input
              type="date"
              class="input input-bordered w-full"
              bind:value={booking.data.startDate}
              required
              disabled={!dataLoaded}
            />
          </div>

          <!-- End date -->
          <div class="form-control">
            <label class="label"><span class="label-text">End date</span></label>
            <input
              type="date"
              class="input input-bordered w-full"
              bind:value={booking.data.endDate}
              required
              disabled={!dataLoaded}
            />
          </div>

          <!-- Schedule Info Display -->
          <div class="form-control">
            <label class="label"><span class="label-text">Schedule Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Date Range:</span>
                {booking.data.startDate && booking.data.endDate
                  ? `${new Date(booking.data.startDate).toLocaleDateString()} - ${new Date(booking.data.endDate).toLocaleDateString()}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {booking.data.groupRoom?.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {booking.data.timeslot?.start && booking.data.timeslot?.end
                  ? `${booking.data.timeslot.start} - ${booking.data.timeslot.end}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Active Students:</span>
                {selectedStudents.filter((id) => !graduatedStudentsToRemove.has(id)).length} selected
                {#if graduatedStudentsToRemove.size > 0}
                  <div class="text-xs text-warning mt-1">
                    ({graduatedStudentsToRemove.size} graduated student{graduatedStudentsToRemove.size !== 1 ? 's' : ''}
                    marked for removal)
                  </div>
                {/if}
                {#if maxStudentsAllowed > 0}
                  (Max: {maxStudentsAllowed})
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Buttons -->
      <div class="modal-action">
        {#if booking.data?.mode === 'edit'}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={saving}> Delete Week </button>
        {/if}

        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving}>
          {#if graduatedStudentsToRemove.size > 0}
            Update (Remove {graduatedStudentsToRemove.size} Graduated)
          {:else}
            {booking.data?.mode === 'edit' ? 'Update' : 'Save'} Week
          {/if}
        </button>

        <button class="btn" onclick={closeModal} disabled={saving}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
