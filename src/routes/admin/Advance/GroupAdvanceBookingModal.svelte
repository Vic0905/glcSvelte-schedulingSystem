<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  let { show = $bindable(false), advanceGroupBooking = $bindable(), onSave } = $props()

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

  // Load reference data ONCE globally
  onMount(async () => {
    if (!dataLoaded) {
      await loadReferenceData()
    }
  })

  // Initialize selected students when modal opens
  $effect(() => {
    if (show) {
      // Initialize selected students from booking data
      if (
        advanceGroupBooking.mode === 'edit' &&
        advanceGroupBooking.students &&
        Array.isArray(advanceGroupBooking.students)
      ) {
        selectedStudents = advanceGroupBooking.students.map((student) => student.id).filter((id) => id)
      } else {
        selectedStudents = []
      }
      setMaxStudentsAllowed()
    }
  })

  const loadReferenceData = async () => {
    if (dataLoaded) return

    try {
      const [subjectsData, studentsData, teachersData, groupRoomsData, timeslotsData] = await Promise.all([
        pb.collection('subject').getFullList({
          sort: 'name',
          fields: 'id,name',
        }),
        pb.collection('student').getFullList({
          sort: 'englishName',
          fields: 'id,englishName,status',
        }),
        pb.collection('teacher').getFullList({
          sort: 'name',
          fields: 'id,name',
        }),
        pb.collection('groupRoom').getFullList({
          sort: 'name',
          fields: 'id,name,maxstudents',
        }),
        pb.collection('timeslot').getFullList({
          sort: 'start',
          fields: 'id,start,end',
        }),
      ])

      subjects = subjectsData
      students = studentsData
      teachers = teachersData
      groupRooms = groupRoomsData
      timeslots = timeslotsData
      dataLoaded = true
    } catch (err) {
      console.error('Error loading reference data:', err)
      toast.error('Failed to load dropdown data')
    }
  }

  const checkForConflicts = async () => {
    const { teacher, timeslot } = advanceGroupBooking

    if (!teacher?.id || !timeslot?.id) return true // No conflicts yet

    try {
      // Check for teacher conflicts in BOTH collections
      let individualFilter = `timeslot = "${timeslot.id}" && teacher = "${teacher.id}"`

      const [individualBookings, groupBookings, studentRecords] = await Promise.all([
        pb.collection('advanceBooking').getFullList({
          filter: individualFilter,
          expand: 'teacher,student',
          $autoCancel: false,
        }),

        // Check group bookings for teacher conflict
        pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `timeslot = "${timeslot.id}" && teacher = "${teacher.id}"`,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => []),

        // Get student names for reference
        pb
          .collection('student')
          .getFullList({
            filter: 'id != ""',
            fields: 'id,englishName',
            $autoCancel: false,
          })
          .catch(() => []),
      ])

      // Create a map of student IDs to names for quick lookup
      const studentMap = new Map()
      studentRecords.forEach((s) => studentMap.set(s.id, s.englishName))

      // Check for teacher conflict
      // EXCLUDE the current booking when editing
      let teacherConflict = null
      for (const booking of individualBookings) {
        if (booking.teacher === teacher.id) {
          teacherConflict = booking
          break
        }
      }

      // Check group bookings for teacher conflict, exclude current booking
      if (!teacherConflict) {
        for (const booking of groupBookings) {
          if (
            booking.teacher === teacher.id &&
            !(advanceGroupBooking.mode === 'edit' && booking.id === advanceGroupBooking.id)
          ) {
            teacherConflict = booking
            break
          }
        }
      }

      if (teacherConflict) {
        const teacherName =
          teacherConflict.expand?.teacher?.name ||
          teachers.find((t) => t.id === teacherConflict.teacher)?.name ||
          'Unknown Teacher'

        // Determine if it's a group lesson
        const isGroupLesson =
          teacherConflict.collectionName === 'groupAdvanceBooking' ||
          teacherConflict.collectionId === 'groupAdvanceBooking' ||
          Array.isArray(teacherConflict.student)

        if (isGroupLesson) {
          const studentCount = Array.isArray(teacherConflict.student) ? teacherConflict.student.length : 0
          toast.error(`${teacherName} is already teaching a group lesson (${studentCount} students) for this timeslot`)
        } else {
          // For individual booking
          const studentId = teacherConflict.student
          const studentName =
            teacherConflict.expand?.student?.englishName || studentMap.get(studentId) || 'Unknown Student'
          toast.error(`${teacherName} is already booked with ${studentName} for this timeslot`)
        }
        return false
      }

      // Check for student conflicts (only check selected students)
      if (selectedStudents.length > 0) {
        // Check individual bookings for student conflicts
        const studentFilter = `timeslot = "${timeslot.id}" && (${selectedStudents.map((id) => `student = "${id}"`).join(' || ')})`

        const studentIndividualBookings = await pb
          .collection('advanceBooking')
          .getFullList({
            filter: studentFilter,
            expand: 'teacher,student',
            $autoCancel: false,
          })
          .catch(() => [])

        // Check group bookings for student conflicts
        const studentGroupBookings = await pb
          .collection('groupAdvanceBooking')
          .getFullList({
            filter: `timeslot = "${timeslot.id}"`,
            expand: 'teacher',
            $autoCancel: false,
          })
          .catch(() => [])

        // Find conflicted students
        for (const studentId of selectedStudents) {
          // Check individual bookings
          const individualConflict = studentIndividualBookings.find((b) => b.student === studentId)
          if (individualConflict) {
            const studentName = studentMap.get(studentId) || 'Unknown Student'
            const teacherName = individualConflict.expand?.teacher?.name || 'Unknown Teacher'
            toast.error(`${studentName} is already booked with ${teacherName} for this timeslot`)
            return false
          }

          // Check group bookings - EXCLUDE current booking when editing
          const groupConflict = studentGroupBookings.find(
            (b) =>
              Array.isArray(b.student) &&
              b.student.includes(studentId) &&
              // If editing, exclude the current booking from conflict check
              !(advanceGroupBooking.mode === 'edit' && b.id === advanceGroupBooking.id)
          )
          if (groupConflict) {
            const studentName = studentMap.get(studentId) || 'Unknown Student'
            const teacherName = groupConflict.expand?.teacher?.name || 'Unknown Teacher'
            toast.error(`${studentName} is already in a group lesson with ${teacherName} for this timeslot`)
            return false
          }
        }
      }

      return true
    } catch (error) {
      console.error('Error checking conflicts:', error)
      return true // Allow save on error
    }
  }

  const validateForm = () => {
    const { subject, groupRoom, teacher, timeslot } = advanceGroupBooking

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

    if (!Array.isArray(selectedStudents) || selectedStudents.length === 0) {
      toast.error('Please select at least one student')
      return false
    }

    return true
  }

  function closeModal() {
    show = false
    selectedStudents = []
    maxStudentsAllowed = 0
    searchTerm = ''
  }

  function setMaxStudentsAllowed() {
    if (advanceGroupBooking.groupRoom?.id && Array.isArray(groupRooms) && groupRooms.length > 0) {
      const selectedRoom = groupRooms.find((room) => room.id === advanceGroupBooking.groupRoom.id)
      maxStudentsAllowed = selectedRoom?.maxstudents || 0
    } else {
      maxStudentsAllowed = advanceGroupBooking.groupRoom?.maxstudents || 0
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
    // Check if student is graduated
    const student = students.find((s) => s.id === studentId)
    if (student?.status === 'graduated' && !selectedStudents.includes(studentId)) {
      toast.error('Cannot select graduated student')
      return
    }

    if (selectedStudents.includes(studentId)) {
      selectedStudents = selectedStudents.filter((id) => id !== studentId)
    } else {
      if (maxStudentsAllowed > 0 && selectedStudents.length >= maxStudentsAllowed) {
        toast.warning(`Maximum ${maxStudentsAllowed} students allowed for this room`)
        return
      }
      selectedStudents = [...selectedStudents, studentId]
    }
  }

  function selectAllStudents() {
    // Filter out graduated students only
    const availableStudents = students.filter((s) => s.status !== 'graduated')

    if (maxStudentsAllowed > 0) {
      selectedStudents = availableStudents.slice(0, maxStudentsAllowed).map((s) => s.id)
      if (availableStudents.length > maxStudentsAllowed) {
        toast.info(`Selected first ${maxStudentsAllowed} available students due to room limit`)
      }
    } else {
      selectedStudents = availableStudents.map((s) => s.id)
    }
  }

  function clearAllStudents() {
    selectedStudents = []
  }

  const saveSchedule = async () => {
    if (!validateForm()) return

    // Check for conflicts and show toast if found
    const noConflicts = await checkForConflicts()
    if (!noConflicts) return

    const { subject, groupRoom, teacher, timeslot, mode, id } = advanceGroupBooking

    const payload = {
      grouproom: groupRoom.id,
      timeslot: timeslot.id,
      subject: subject.id,
      teacher: teacher.id,
      student: selectedStudents,
    }

    toast.promise(
      async () => {
        let savedBooking
        if (mode === 'edit' && id) {
          savedBooking = await pb.collection('groupAdvanceBooking').update(id, payload)
          return 'Advance group schedule template updated!'
        } else {
          savedBooking = await pb.collection('groupAdvanceBooking').create(payload)
          return 'Advance group schedule template created!'
        }
      },
      {
        loading: 'Saving...',
        success: () => {
          closeModal()
          onSave()
          return 'Advance booking saved successfully!'
        },
        error: (error) => {
          console.error('Error:', error)
          return `Failed to save: ${error.message}`
        },
      }
    )
  }

  const deleteSchedule = async () => {
    if (!advanceGroupBooking.id) return

    const { subject, teacher, groupRoom, timeslot } = advanceGroupBooking

    const confirmMessage =
      `Are you sure you want to delete this advance booking?\n\n` +
      `Subject: ${subject.name}\n` +
      `Teacher: ${teacher.name}\n` +
      `Room: ${groupRoom.name}\n` +
      `Time: ${timeslot.start} - ${timeslot.end}\n` +
      `Students: ${selectedStudents.length} students\n\n` +
      `This action cannot be undone.`

    if (!confirm(confirmMessage)) return

    toast.promise(
      async () => {
        await pb.collection('groupAdvanceBooking').delete(advanceGroupBooking.id)
      },
      {
        loading: 'Deleting...',
        success: () => {
          closeModal()
          onSave()
          return 'Advance booking deleted successfully!'
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
        {advanceGroupBooking.mode === 'edit' ? 'Edit' : 'Create'} Advance Group Schedule Template
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Left column -->
        <div class="space-y-4">
          <!-- Subject -->
          <div class="form-control">
            <label class="label"><span class="label-text">Subject</span></label>
            <select
              bind:value={advanceGroupBooking.subject.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded || saving}
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
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={selectAllStudents}
                  disabled={!dataLoaded || saving}
                >
                  Select All
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={clearAllStudents}
                  disabled={!dataLoaded || saving}
                >
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
                disabled={!dataLoaded || saving}
              />
            </div>

            <div class="border border-base-300 rounded-lg p-4 max-h-80 overflow-y-auto">
              {#each filteredStudents as student (student.id)}
                {#if student.status !== 'graduated' || selectedStudents.includes(student.id)}
                  {@const isGraduated = student.status === 'graduated'}
                  {@const isDisabled =
                    isGraduated ||
                    (maxStudentsAllowed > 0 &&
                      !selectedStudents.includes(student.id) &&
                      selectedStudents.length >= maxStudentsAllowed) ||
                    saving}

                  <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        checked={selectedStudents.includes(student.id)}
                        disabled={isDisabled}
                        onchange={() => toggleStudent(student.id)}
                      />
                      <span class="label-text" class:italic={isDisabled}>
                        {student.englishName}
                        {#if isGraduated}
                          <span class="text-xs text-gray-400 ml-2">(Graduated)</span>
                        {/if}
                      </span>
                    </label>
                  </div>
                {/if}
              {/each}

              {#if filteredStudents.filter((s) => s.status !== 'graduated' || selectedStudents.includes(s.id)).length === 0}
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
              bind:value={advanceGroupBooking.teacher.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded || saving}
            >
              <option value="">-- Select Teacher --</option>
              {#each teachers as t}
                {#if t.status !== 'disabled' || t.id === advanceGroupBooking.teacher.id}
                  <option value={t.id} disabled={t.status === 'disabled'} class:italic={t.status === 'disabled'}>
                    {t.name}
                    {#if t.status === 'disabled'}(Disabled){/if}
                  </option>
                {/if}
              {/each}
            </select>
          </div>

          <!-- Group Room -->
          <div class="form-control">
            <label class="label"><span class="label-text">Group Room</span></label>
            <select
              bind:value={advanceGroupBooking.groupRoom.id}
              class="select select-bordered w-full"
              required
              onchange={onGroupRoomChange}
              disabled={!dataLoaded || saving}
            >
              <option value="">-- Select Group Room --</option>
              {#each groupRooms as gr}
                <option value={gr.id}>{gr.name} (Max: {gr.maxstudents} students)</option>
              {/each}
            </select>
          </div>

          <!-- Timeslot -->
          <div class="form-control">
            <label class="label"><span class="label-text">Timeslot</span></label>
            <select
              bind:value={advanceGroupBooking.timeslot.id}
              class="select select-bordered w-full"
              required
              disabled={!dataLoaded || saving}
            >
              <option value="">-- Select Timeslot --</option>
              {#each timeslots as ts}
                <option value={ts.id}>{ts.start} - {ts.end}</option>
              {/each}
            </select>
          </div>

          <!-- Info Display -->
          <div class="form-control">
            <label class="label"><span class="label-text">Template Info</span></label>
            <div class="bg-base-200 rounded-lg p-4 space-y-2">
              <div class="text-sm">
                <span class="font-medium">Room:</span>
                {advanceGroupBooking.groupRoom?.name || 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Timeslot:</span>
                {advanceGroupBooking.timeslot?.start && advanceGroupBooking.timeslot?.end
                  ? `${advanceGroupBooking.timeslot.start} - ${advanceGroupBooking.timeslot.end}`
                  : 'Not selected'}
              </div>
              <div class="text-sm">
                <span class="font-medium">Students:</span>
                {selectedStudents.length} selected
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
        {#if advanceGroupBooking.mode === 'edit'}
          <button class="btn btn-error mr-auto" onclick={deleteSchedule} disabled={saving}> Delete Template </button>
        {/if}

        <button class="btn btn-primary" onclick={saveSchedule} disabled={saving}>
          {advanceGroupBooking.mode === 'edit' ? 'Update' : 'Save'} Template
        </button>

        <button class="btn" onclick={closeModal} disabled={saving}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
