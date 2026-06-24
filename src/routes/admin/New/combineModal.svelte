<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let { onrefresh, selectedDate = new Date().toISOString().split('T')[0] } = $props()

  // ═══════════════════════════════════
  // STATE
  // ═══════════════════════════════════

  // Modal
  let show = $state(false)
  let loading = $state(false)
  let showDeleteConfirm = $state(false)

  // Dropdown data
  let subjects = $state([])
  let students = $state([])
  let teachers = $state([])
  let rooms = $state([])
  let timeslots = $state([])
  let customSchedules = $state([])

  // Form
  let form = $state({
    mode: 'create',
    id: null,
    subject: null,
    teacher: null,
    room: null,
    timeslot: null,
    customSchedules: null,
    startDate: null,
    endDate: null,
  })

  let originalState = $state({ timeslotId: null, roomId: null, startDate: null })

  // Students
  let searchQuery = $state('')
  let selectedStudents = $state([])
  let filterChanged = $state(false)
  let filterExtended = $state(false)
  let skipDates = $state({})

  // ═══════════════════════════════════
  // DERIVED
  // ═══════════════════════════════════

  let maxCapacity = $derived(form.room?.maxStudents || 0)
  let currentCount = $derived(selectedStudents.length)
  let isOverCapacity = $derived(maxCapacity > 0 && currentCount > maxCapacity)

  let filteredStudents = $derived.by(() => {
    const query = searchQuery.toLowerCase()

    // Deduplicate: keep only the latest-starting record per name
    const latest = new Map()
    for (const s of students) {
      const existing = latest.get(s.englishName)
      if (!existing || s.start > existing.start) {
        latest.set(s.englishName, s)
      }
    }
    let filtered = [...latest.values()]

    return filtered
      .filter((s) => s.englishName?.toLowerCase().includes(query))
      .sort((a, b) => {
        const aSelected = selectedStudents.some((x) => x.id === a.id)
        const bSelected = selectedStudents.some((x) => x.id === b.id)
        return bSelected - aSelected
      })
  })

  // ═══════════════════════════════════
  // API HELPERS
  // ═══════════════════════════════════

  async function logActivity(action, details = {}) {
    try {
      await pb.collection('activityLog').create({
        action: action,
        performedBy: pb.authStore.model?.id,
        targetId: form.id || 'bulk-schedule', // Uses the schedule ID if available
        details: details,
      })
    } catch (err) {
      console.error('Failed to write activity log:', err)
    }
  }

  async function loadDropdowns() {
    try {
      const [subj, stu, teach, room, ts, cs] = await Promise.all([
        pb.collection('subject').getFullList({ sort: 'name' }),
        pb.collection('student').getFullList({
          sort: 'englishName',
          filter: `status != "graduated" && start <= "${selectedDate} 23:59:59" && end >= "${selectedDate} 00:00:00"`,
        }),
        pb.collection('teacher').getFullList({
          sort: 'name',
          filter: 'status != "disabled"',
        }),
        pb.collection('roomType').getFullList({ sort: 'name' }),
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('customSchedule').getFullList({ sort: 'name' }),
      ])
      subjects = subj
      students = stu
      teachers = teach
      rooms = room
      timeslots = ts
      customSchedules = cs
    } catch {
      toast.error('Failed to load dropdown options')
    }
  }

  function findById(list, id) {
    return list.find((item) => item.id === id) || null
  }

  // ═══════════════════════════════════
  // MODAL LIFECYCLE
  // ═══════════════════════════════════

  export async function open(data) {
    show = true
    if (!subjects.length) {
      loading = true
      await loadDropdowns()
      loading = false
    }

    const existing = data.schedule || data.schedules?.[0]

    form = {
      mode: data.mode,
      id: existing?.id || null,
      subject: findById(subjects, existing?.subject?.id || data.room?.expand?.subject?.id),
      teacher: findById(teachers, existing?.teacher?.id || data.teacher?.id),
      room: findById(rooms, existing?.roomId || data.room?.id),
      timeslot: findById(timeslots, existing?.timeslotId || data.timeslot?.id),
      customSchedule: findById(customSchedules, existing?.customSchedule?.id || existing?.customScheduleId),
      startDate: data.startDate,
      endDate: data.endDate,
    }

    originalState = {
      timeslotId: form.timeslot?.id,
      roomId: form.room?.id,
      startDate: data.startDate,
    }

    selectedStudents = data.mode === 'edit' && data.schedules ? extractStudentsFromSchedules(data.schedules, data) : []

    showDeleteConfirm = false
  }

  function close() {
    show = false
    loading = false
    showDeleteConfirm = false
    selectedStudents = []
    searchQuery = ''
    skipDates = {}
  }

  // ═══════════════════════════════════
  // STUDENT EXTRACTION
  // ═══════════════════════════════════

  function extractStudentsFromSchedules(schedules, data) {
    return schedules.flatMap((s) => {
      const startDate = s.start?.split(' ')[0] || data.startDate
      const endDate = s.end?.split(' ')[0] || data.endDate
      const getId = (stu) => (typeof stu === 'object' ? stu.id : stu)

      if (Array.isArray(s.students)) {
        return s.students.map((stu) => ({ id: getId(stu), startDate, endDate }))
      }

      const id = s.student?.id ?? s.student ?? s.studentId
      return id ? [{ id, startDate, endDate }] : []
    })
  }

  // ═══════════════════════════════════
  // STUDENT SELECTION
  // ═══════════════════════════════════

  // function toggleStatusFilter(filter) {
  //   if (filter === 'changed') {
  //     filterChanged = !filterChanged
  //     if (filterChanged) filterExtended = false
  //   } else {
  //     filterExtended = !filterExtended
  //     if (filterExtended) filterChanged = false
  //   }
  // }

  function toggleStudent(id) {
    const alreadySelected = selectedStudents.find((s) => s.id === id)

    if (alreadySelected) {
      selectedStudents = selectedStudents.filter((s) => s.id !== id)
      return
    }

    if (maxCapacity > 0 && currentCount >= maxCapacity) {
      toast.error(`Room capacity reached (${maxCapacity})`)
      return
    }

    selectedStudents = [...selectedStudents, { id, startDate: form.startDate, endDate: form.endDate }]
  }

  function updateStudentDate(id, field, value) {
    selectedStudents = selectedStudents.map((s) => (s.id === id ? { ...s, [field]: value } : s))
  }

  // ═══════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════

  function validateForm() {
    if (!form.subject || !form.teacher || !form.room || !form.timeslot) {
      return 'Please fill all required fields'
    }
    if (selectedStudents.length === 0) {
      return 'Select at least one student'
    }

    for (const stu of selectedStudents) {
      const name = students.find((s) => s.id === stu.id)?.englishName || 'A student'
      if (!stu.startDate || !stu.endDate) {
        return `${name} is missing a start or end date`
      }
      if (stu.endDate < stu.startDate) {
        return `${name}'s end date is before their start date`
      }
    }

    return null
  }

  // ═══════════════════════════════════
  // CONFLICT DETECTION
  // ═══════════════════════════════════

  async function fetchHolidaySet() {
    const holidays = await pb.collection('holiday').getFullList({ fields: 'date' })
    return new Set(holidays.map((h) => h.date?.split(' ')[0]))
  }

  function isHolidaySpan(record, holidaySet, studentDates) {
    const recStart = record.start?.split(' ')[0]
    const recEnd = record.end?.split(' ')[0]

    for (const hDate of holidaySet) {
      if (hDate >= recStart && hDate <= recEnd && hDate >= studentDates.start && hDate <= studentDates.end) {
        return true
      }
    }
    return false
  }

  function filterConflictRecords(records, holidaySet, studentDates) {
    return records.filter((record) => !isHolidaySpan(record, holidaySet, studentDates))
  }

  function filterEditModeRecords(records) {
    if (form.mode !== 'edit') return records

    return records.filter(
      (s) =>
        s.room !== originalState.roomId ||
        s.timeslot !== originalState.timeslotId ||
        s.start.split(' ')[0] !== originalState.startDate
    )
  }

  function checkConflictTypes(records) {
    const teacherBusy = records.find((s) => s.teacher === form.teacher.id)
    if (teacherBusy) {
      throw new Error(`${form.teacher.name} is busy in ${teacherBusy.expand?.room?.name || 'another room'}.`)
    }

    const roomTaken = records.find((s) => s.room === form.room.id && s.teacher !== form.teacher.id)
    if (roomTaken) {
      throw new Error(`${form.room.name} is occupied by ${roomTaken.expand?.teacher?.name || 'another teacher'}.`)
    }

    const studentBusy = records.find((s) => {
      const sid = typeof s.student === 'object' ? s.student.id : s.student
      return selectedStudents.some((stu) => stu.id === sid)
    })
    if (studentBusy) {
      const name =
        students.find((s) => s.id === studentBusy.student?.id || studentBusy.student)?.englishName || 'Student'
      throw new Error(`${name} already has a class in ${studentBusy.expand?.room?.name}.`)
    }
  }

  async function checkConflicts() {
    const holidaySet = await fetchHolidaySet()

    for (const stu of selectedStudents) {
      const startStr = `${stu.startDate} 00:00:00.000Z`
      const endStr = `${stu.endDate} 00:00:00.000Z`

      const records = await pb.collection('schedule').getFullList({
        filter: `timeslot = "${form.timeslot.id}" && start <= "${endStr}" && end >= "${startStr}"`,
        expand: 'room,teacher',
      })

      const filteredRecords = filterConflictRecords(records, holidaySet, {
        start: stu.startDate,
        end: stu.endDate,
      })

      const others = filterEditModeRecords(filteredRecords)
      checkConflictTypes(others)
    }
  }

  // ═══════════════════════════════════
  // SAVE
  // ═══════════════════════════════════

  async function deleteExistingRecords() {
    if (form.mode !== 'edit') return

    const records = await pb.collection('schedule').getFullList({
      filter: [
        `timeslot = "${originalState.timeslotId}"`,
        `room = "${originalState.roomId}"`,
        `start = "${originalState.startDate} 00:00:00.000Z"`,
      ].join(' && '),
      fields: 'id',
    })

    return records.map((rec) => rec.id)
  }

  async function save() {
    const error = validateForm()
    if (error) return toast.error(error)

    loading = true
    try {
      await checkConflicts()

      const batch = pb.createBatch()

      if (form.mode === 'edit') {
        const idsToDelete = await deleteExistingRecords()
        idsToDelete.forEach((id) => batch.collection('schedule').delete(id))
      }

      selectedStudents.forEach(({ id: studentId, startDate, endDate }) => {
        batch.collection('schedule').create({
          timeslot: form.timeslot.id,
          teacher: form.teacher.id,
          subject: form.subject.id,
          room: form.room.id,
          student: studentId,
          start: `${startDate} 00:00:00.000Z`,
          end: `${endDate} 00:00:00.000Z`,
          status: 'draft',
          customSchedule: form.customSchedule?.id ?? null,
        })
      })

      await batch.send()
      // --- ADDED LOGGING HERE ---
      await logActivity(form.mode === 'edit' ? 'update' : 'add', {
        subject: form.subject?.name,
        teacherName: form.teacher?.name,
        roomName: form.room?.name,
        timeslot: form.timeslot ? `${form.timeslot.start} - ${form.timeslot.end}` : null,
        rangeStart: selectedStudents[0]?.startDate || null, // ← add these
        rangeEnd: selectedStudents[selectedStudents.length - 1]?.endDate || null,
        students: selectedStudents.map((s) => ({
          id: s.id,
          name: students.find((st) => st.id === s.id)?.englishName || s.id,
          start: s.startDate,
          end: s.endDate,
        })),
      })
      // --------------------------
      toast.success(form.mode === 'edit' ? 'Schedule updated' : 'Schedule created')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'An error occurred')
    } finally {
      loading = false
    }
  }

  // ═══════════════════════════════════
  // SKIP DAY
  // ═══════════════════════════════════

  function getNextDay(dateStr) {
    const date = new Date(dateStr)
    date.setDate(date.getDate() + 1)
    return date.toISOString().split('T')[0]
  }

  function getPreviousDay(dateStr) {
    const date = new Date(dateStr)
    date.setDate(date.getDate() - 1)
    return date.toISOString().split('T')[0]
  }

  async function removeStudentForDay(studentId, targetDate) {
    const records = await pb.collection('schedule').getFullList({
      filter: [
        `timeslot = "${form.timeslot.id}"`,
        `room = "${form.room.id}"`,
        `student = "${studentId}"`,
        `start <= "${targetDate} 23:59:59"`,
        `end >= "${targetDate} 00:00:00"`,
      ].join(' && '),
      fields: 'id,start,end,timeslot,room,teacher,subject,student',
    })

    if (!records.length) {
      toast.info('No schedule record found for this student on that day.')
      return
    }

    const batch = pb.createBatch()

    for (const rec of records) {
      const recStart = rec.start.split(' ')[0]
      const recEnd = rec.end.split(' ')[0]

      if (recStart === recEnd) {
        // Single day record - delete entirely
        batch.collection('schedule').delete(rec.id)
      } else if (recStart === targetDate) {
        // Remove from start - push forward
        batch.collection('schedule').update(rec.id, {
          start: `${getNextDay(targetDate)} 00:00:00.000Z`,
        })
      } else if (recEnd === targetDate) {
        // Remove from end - pull back
        batch.collection('schedule').update(rec.id, {
          end: `${getPreviousDay(targetDate)} 00:00:00.000Z`,
        })
      } else {
        // Remove from middle - split into two
        batch.collection('schedule').update(rec.id, {
          end: `${getPreviousDay(targetDate)} 00:00:00.000Z`,
        })
        batch.collection('schedule').create({
          timeslot: rec.timeslot,
          room: rec.room,
          teacher: rec.teacher,
          subject: rec.subject,
          student: rec.student,
          start: `${getNextDay(targetDate)} 00:00:00.000Z`,
          end: `${recEnd} 00:00:00.000Z`,
          status: 'draft',
        })
      }
    }

    await batch.send()
  }

  async function handleSkipDay(studentId) {
    const targetDate = skipDates[studentId]
    if (!targetDate) return toast.error('Pick a date to remove first')

    loading = true
    try {
      await removeStudentForDay(studentId, targetDate)
      // --- ADDED LOGGING HERE ---
      await logActivity('update', {
        type: 'skip_day',
        studentId: studentId,
        skippedDate: targetDate,
        teacherName: form.teacher?.name,
        timeslot: form.timeslot ? `${form.timeslot.start} - ${form.timeslot.end}` : null,
        roomName: form.room?.name,
      })
      // --------------------------
      skipDates[studentId] = ''
      toast.success(`Removed student from ${targetDate}`)
      onrefresh?.()
    } catch (e) {
      toast.error(e.message || 'Failed to remove day')
    } finally {
      loading = false
    }
  }

  // ═══════════════════════════════════
  // DELETE
  // ═══════════════════════════════════

  async function deleteSchedule() {
    loading = true
    try {
      const records = await pb.collection('schedule').getFullList({
        filter: [
          `timeslot = "${originalState.timeslotId}"`,
          `room = "${originalState.roomId}"`,
          `start = "${originalState.startDate} 00:00:00.000Z"`,
        ].join(' && '),
        fields: 'id',
      })

      if (!records.length) return toast.error('No matching schedule records found')

      const batch = pb.createBatch()
      records.forEach((rec) => batch.collection('schedule').delete(rec.id))
      await batch.send()

      // --- ADDED LOGGING HERE ---
      await logActivity('delete', {
        roomName: form.room?.name,
        teacherName: form.teacher?.name,
        timeslot: form.timeslot ? `${form.timeslot.start} - ${form.timeslot.end}` : null,
        rangeStart: originalState.startDate, // ← was 'startDate', now consistent
        rangeEnd: originalState.startDate, // ← same since delete targets one start date
        students: selectedStudents.map((s) => ({
          id: s.id,
          name: students.find((st) => st.id === s.id)?.englishName || s.id,
        })),
      })
      // --------------------------

      toast.success('Schedule deleted')
      onrefresh?.()
      close()
    } catch (e) {
      toast.error(e.message || 'Failed to delete schedule')
    } finally {
      loading = false
      showDeleteConfirm = false
    }
  }
</script>

{#if show}
  <dialog class="modal modal-open">
    <div class="modal-box max-w-4xl border border-base-300 shadow-2xl">
      <!-- Header -->
      <header class="mb-6 text-center">
        <h3 class="text-xl font-bold">
          {form.mode === 'edit' ? 'Edit' : 'Create'}
          {maxCapacity > 1 ? 'Group' : 'MTM'} Schedule
        </h3>
        <p class="text-xs opacity-60 uppercase tracking-widest">
          {form.startDate} — {form.endDate}
        </p>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Left Column: Schedule Fields -->
        <div class="space-y-4">
          <div class="form-control">
            <label class="label text-xs font-bold" for="subject">Subject</label>
            <select id="subject" bind:value={form.subject} class="select select-bordered select-sm w-full">
              <option value={null}>Select Subject</option>
              {#each subjects as s (s.id)}
                <option value={s}>{s.name}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label text-xs font-bold" for="teacher">Teacher</label>
            <select id="teacher" bind:value={form.teacher} class="select select-bordered select-sm w-full">
              <option value={null}>Select Teacher</option>
              {#each teachers as t (t.id)}
                <option value={t}>{t.name}</option>
              {/each}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="form-control">
              <label class="label text-xs font-bold" for="room">Room</label>
              <select id="room" bind:value={form.room} class="select select-bordered select-sm w-full">
                {#each rooms as r (r.id)}
                  <option value={r}>{r.name}</option>
                {/each}
              </select>
            </div>
            <div class="form-control">
              <label class="label text-xs font-bold" for="timeslot">Timeslot</label>
              <select id="timeslot" bind:value={form.timeslot} class="select select-bordered select-sm w-full">
                {#each timeslots as ts (ts.id)}
                  <option value={ts}>{ts.start} - {ts.end}</option>
                {/each}
              </select>
            </div>
          </div>
          <div class="form-control">
            <label class="label text-xs font-bold" for="customSchedule">Custom Schedule</label>
            <select
              id="customSchedule"
              bind:value={form.customSchedule}
              class="select select-bordered select-sm w-full"
            >
              <option value={null}>Select Custom Schedule</option>
              {#each customSchedules as cs (cs.id)}
                <option value={cs}>{cs.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Right Column: Student Selection -->
        <div class="flex flex-col">
          <div class="flex justify-between items-center mb-2">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-xs font-bold uppercase">Students</label>
            <span class="badge {isOverCapacity ? 'badge-error' : 'badge-ghost'} badge-sm">
              {currentCount} / {maxCapacity || '∞'}
            </span>
          </div>

          <!-- <div class="flex gap-2 mb-2">
            <button
              class="btn btn-xs {filterChanged ? 'btn-error' : 'btn-ghost'}"
              onclick={() => toggleStatusFilter('changed')}
            >
              Changed
            </button>
            <button
              class="btn btn-xs {filterExtended ? 'btn-secondary' : 'btn-ghost'}"
              onclick={() => toggleStatusFilter('extended')}
            >
              Extended
            </button>
          </div> -->

          <input
            type="text"
            placeholder="Search students..."
            bind:value={searchQuery}
            class="input input-bordered input-sm w-full mb-3"
          />

          <div class="border rounded-lg overflow-y-auto bg-base-200/50 p-2 h-72">
            {#if loading}
              <p class="text-xs opacity-50 p-4 text-center">Loading...</p>
            {:else}
              {#each filteredStudents as s (s.id)}
                {@const entry = selectedStudents.find((x) => x.id === s.id)}
                {@const isSelected = !!entry}

                <div class="mb-1 rounded-md {isSelected ? 'bg-base-300/60' : ''}">
                  <label class="flex items-center gap-3 p-2 hover:bg-base-300 rounded-md cursor-pointer">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-primary checkbox-sm"
                      checked={isSelected}
                      onchange={() => toggleStudent(s.id)}
                      disabled={!isSelected && maxCapacity > 0 && currentCount >= maxCapacity}
                    />
                    <span class="text-sm {isSelected ? 'font-bold text-primary' : ''}">
                      {s.englishName}
                    </span>
                    {#if s.status === 'changed'}
                      <span class="badge badge-error badge-xs">changed</span>
                    {:else if s.status === 'extended'}
                      <span class="badge badge-secondary badge-xs">extended</span>
                    {/if}
                  </label>

                  {#if isSelected}
                    <div class="grid grid-cols-[1fr_1fr_auto] gap-1 px-2 pb-2 items-end">
                      <div class="form-control">
                        <label class="label py-0 text-[10px] opacity-60" for="stu-start-{s.id}">Start</label>
                        <input
                          id="stu-start-{s.id}"
                          type="date"
                          class="input input-bordered input-xs w-full"
                          value={entry.startDate}
                          onchange={(e) => updateStudentDate(s.id, 'startDate', e.target.value)}
                        />
                      </div>
                      <div class="form-control">
                        <label class="label py-0 text-[10px] opacity-60" for="stu-end-{s.id}">End</label>
                        <input
                          id="stu-end-{s.id}"
                          type="date"
                          class="input input-bordered input-xs w-full"
                          value={entry.endDate}
                          onchange={(e) => updateStudentDate(s.id, 'endDate', e.target.value)}
                        />
                      </div>

                      {#if form.mode === 'edit'}
                        <div class="form-control">
                          <label class="label py-0 text-[10px] opacity-60">Skip Day</label>
                          <input
                            type="date"
                            class="input input-bordered input-xs w-full"
                            bind:value={skipDates[s.id]}
                          />
                        </div>
                        <button
                          class="btn btn-xs btn-warning btn-soft"
                          disabled={!skipDates[s.id] || loading}
                          onclick={() => handleSkipDay(s.id)}
                        >
                          Remove Day
                        </button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {:else}
                <p class="text-xs opacity-50 p-4 text-center">No students match your search.</p>
              {/each}
            {/if}
          </div>

          {#if isOverCapacity}
            <p class="text-xs text-error mt-1">Over room capacity ({maxCapacity} max)</p>
          {/if}
        </div>
      </div>

      <!-- Delete Confirmation -->
      {#if showDeleteConfirm}
        <div class="alert alert-soft alert-error mt-6 flex items-center justify-between gap-4">
          <span class="text-sm font-medium"> Delete all records for this schedule? This cannot be undone. </span>
          <div class="flex gap-2 shrink-0">
            <button class="btn btn-sm btn-ghost" onclick={() => (showDeleteConfirm = false)} disabled={loading}>
              Cancel
            </button>
            <button class="btn btn-sm btn-ghost" onclick={deleteSchedule} disabled={loading}>
              {#if loading}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                Confirm Delete
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Actions -->
      <div class="modal-action mt-8">
        {#if form.mode === 'edit'}
          <button
            class="btn btn-error btn-soft mr-auto"
            onclick={() => (showDeleteConfirm = true)}
            disabled={loading || showDeleteConfirm}
          >
            Delete Schedule
          </button>
        {/if}

        <button class="btn btn-soft btn-ghost" onclick={close} disabled={loading}> Cancel </button>
        <button class="btn btn-soft btn-info min-w-[140px]" onclick={save} disabled={loading || isOverCapacity}>
          {#if loading}
            <span class="loading loading-spinner"></span>
          {:else}
            Save Schedule
          {/if}
        </button>
      </div>
    </div>

    <div class="modal-backdrop bg-black/40" role="presentation" onclick={close}></div>
  </dialog>
{/if}
