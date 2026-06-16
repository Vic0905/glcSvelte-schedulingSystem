<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import Papa from 'papaparse'

  // ── Constants ─────────────────────────────────────────────────────────────
  const STATUS_OPTIONS = ['new', 'old', 'graduated', 'changed', 'extended']
  const STATUS_BADGE = {
    new: 'badge-success',
    old: 'badge-info',
    graduated: 'badge-warning',
    extended: 'badge-secondary',
    changed: 'badge-error',
  }
  const BULK_DRAFT_KEY = 'student_bulk_draft'
  const BLANK_FORM = {
    id: null,
    name: '',
    englishName: '',
    course: '',
    level: '',
    remarks: '',
    status: 'new',
    start: '',
    end: '',
    isChanged: false,
    isExtended: false,
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let students = $state([])
  let showModal = $state(false)
  let showBulkModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null
  let isProcessing = $state(false)
  let selectedStudents = $state(new Set())
  let formData = $state({ ...BLANK_FORM })
  let bulkRawInput = $state('')
  let bulkDefaultStatus = $state('new')

  // ── Derived for edit mode ──────────────────────────────────────────────────
  let editMode = $derived(formData.isChanged ? 'changed' : formData.isExtended ? 'extended' : 'normal')

  // ── Derived ───────────────────────────────────────────────────────────────
  let stats = $derived({
    total: students.length,
    new: students.filter((s) => s.status === 'new').length,
    old: students.filter((s) => s.status === 'old').length,
    graduated: students.filter((s) => s.status === 'graduated').length,
    extended: students.filter((s) => s.status === 'extended').length,
    changed: students.filter((s) => s.status === 'changed').length,
  })

  let bulkPreview = $derived(
    bulkRawInput
      .split('\n')
      .map((line) => {
        const delimiter = line.includes('\t') ? '\t' : ','
        const [name = '', englishName = '', course = '', level = '', remarks = '', start = '', end = ''] = line
          .split(delimiter)
          .map((s) => s.trim())
        return { englishName, name, course, level, remarks, start: parseDateToISO(start), end: parseDateToISO(end) }
      })
      .filter(
        (row, i, arr) =>
          row.englishName.length > 0 &&
          arr.findIndex((r) => r.englishName.toLowerCase() === row.englishName.toLowerCase()) === i
      )
  )

  let hasDraft = $derived(!!localStorage.getItem(BULK_DRAFT_KEY) && !bulkRawInput.trim())

  $effect(() => {
    bulkRawInput.trim() ? localStorage.setItem(BULK_DRAFT_KEY, bulkRawInput) : localStorage.removeItem(BULK_DRAFT_KEY)
  })

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getId = (rel) => (!rel ? null : Array.isArray(rel) ? rel[0] : typeof rel === 'object' ? rel.id : rel)
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

  function parseDateToISO(str) {
    if (!str) return null
    const match = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (!match) return str
    let [, month, day, year] = match
    if (year.length === 2) year = '20' + year
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  async function batchFetch(requests) {
    const res = await fetch(`${pb.baseUrl}/api/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pb.authStore.token}`,
      },
      body: JSON.stringify({ requests }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(text)
    return JSON.parse(text)
  }

  // ── ADDED: User account helper ─────────────────────────────────────────────
  async function createStudentUser(englishName) {
    const trimmedName = englishName.trim()

    // Check if a user already exists for this student name
    try {
      const existing = await pb.collection('users').getFirstListItem(`firstName="${trimmedName}"`)
      return existing.id
    } catch {
      // not found, continue to create
    }

    const base = trimmedName.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!base) return null
    let username = base
    let suffix = 1
    while (true) {
      try {
        await pb.collection('users').getFirstListItem(`username="${username}"`)
        username = `${base}${suffix++}`
      } catch {
        break
      }
    }

    try {
      const user = await pb.collection('users').create({
        username,
        email: `${username}@student.local`,
        emailVisibility: true,
        password: '00000000',
        passwordConfirm: '00000000',
        firstName: trimmedName,
        role: 'student',
      })
      return user.id
    } catch (err) {
      console.error('Failed to create user for', englishName, err)
      toast.error(`User creation failed: ${err?.response?.message || err.message}`)
      if (err?.response?.data) console.error(JSON.stringify(err.response.data))
      return null
    }
  }

  // ── Student ID helper ──────────────────────────────────────────────────────
  async function getNextStudentId() {
    try {
      const records = await pb.collection('student').getFullList({ fields: 'studentId' })
      const max = records.reduce((m, r) => Math.max(m, Number(r.studentId) || 0), 0)
      return max + 1
    } catch {
      return 1
    }
  }
  const padId = (n) => String(n).padStart(5, '0')

  // ── Grid ──────────────────────────────────────────────────────────────────
  function renderGrid(records) {
    if (!gridElement) return

    if (gridInstance) {
      gridInstance.destroy()
      gridInstance = null
      gridElement.innerHTML = ''
    }

    const data = records.map((s) => [
      h('input', {
        type: 'checkbox',
        className: 'checkbox checkbox-sm checkbox-neutral',
        checked: selectedStudents.has(s.id),
        onChange: (e) => {
          const next = new Set(selectedStudents)
          e.target.checked ? next.add(s.id) : next.delete(s.id)
          selectedStudents = next
        },
      }),
      s.studentId || '-',
      s.englishName || '-',
      s.name || '-',
      s.course || '-',
      s.level || '-',
      s.remarks || '-',
      s.start ? s.start.slice(0, 10) : '-',
      s.end ? s.end.slice(0, 10) : '-',
      h('span', { className: `badge badge-sm ${STATUS_BADGE[s.status] ?? 'badge-neutral'}` }, s.status ?? 'new'),
      h('div', { className: 'flex gap-2 justify-center' }, [
        h('button', { className: 'btn btn-xs btn-outline btn-info', onclick: () => openEdit(s) }, 'Edit'),
        h('button', { className: 'btn btn-xs btn-outline btn-error', onclick: () => deleteStudent(s.id) }, 'Delete'),
      ]),
    ])

    gridInstance = new Grid({
      columns: [
        { name: '', width: '50px', sort: false },
        { name: 'Student ID', width: '80px' },
        { name: 'English Name', width: '100px' },
        { name: 'Name', width: '120px' },
        { name: 'Course', width: '90px' },
        { name: 'Level', width: '90px' },
        { name: 'Remarks', width: '90px' },
        { name: 'Start', width: '90px' },
        { name: 'End', width: '90px' },
        { name: 'Status', width: '90px' },
        { name: 'Actions', width: '110px', sort: false },
      ],
      data,
      search: true,
      pagination: { limit: 10 },
      className: { table: 'table w-full', th: 'text-center' },
      style: {
        th: { 'font-size': '0.7rem' },
        td: { 'font-size': '0.75rem', 'white-space': 'normal' },
      },
    }).render(gridElement)
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadStudents() {
    try {
      let records = await pb.collection('student').getFullList({ sort: '-studentId' })
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const toPromote = records.filter((s) => s.status === 'new' && s.start && new Date(s.start) < cutoff)
      const toGraduate = records.filter((s) => s.end && new Date(s.end) < today && s.status !== 'graduated')

      if (toPromote.length || toGraduate.length) {
        await Promise.allSettled([
          ...toPromote.map(({ id }) => pb.collection('student').update(id, { status: 'old' })),
          ...toGraduate.map(({ id }) => pb.collection('student').update(id, { status: 'graduated' })),
        ])
        records = await pb.collection('student').getFullList({ sort: '-studentId' })
      }

      students = records
      await tick()
      renderGrid(students)
    } catch {
      toast.error('Failed to load students')
    }
  }

  // ── Archive & delete ──────────────────────────────────────────────────────
  // async function archiveAndDelete(studentIds, nameMap) {
  //   const allSchedules = await pb.collection('lessonSchedule').getFullList()
  //   const targets = allSchedules.filter((s) => studentIds.includes(getId(s.student)))

  //   const grouped = {}
  //   for (const s of targets) {
  //     const [sid, tid, slid, subid, rid] = [
  //       getId(s.student),
  //       getId(s.teacher),
  //       getId(s.timeslot),
  //       getId(s.subject),
  //       getId(s.room),
  //     ]
  //     if (!sid || !tid || !slid || !subid || !rid) continue
  //     const key = `${sid}_${tid}_${slid}_${subid}_${rid}_${s.week_id}`
  //     if (!grouped[key]) {
  //       grouped[key] = {
  //         student: sid,
  //         teacher: tid,
  //         timeslot: slid,
  //         subject: subid,
  //         room: rid,
  //         week_id: s.week_id,
  //         start_date: s.date,
  //         end_date: s.date,
  //       }
  //     } else {
  //       const d = new Date(s.date)
  //       if (d < new Date(grouped[key].start_date)) grouped[key].start_date = s.date
  //       if (d > new Date(grouped[key].end_date)) grouped[key].end_date = s.date
  //     }
  //   }

  //   await Promise.all(
  //     Object.values(grouped).map((g) =>
  //       pb.collection('lessonScheduleHistory').create({ ...g, student_name: nameMap[g.student] })
  //     )
  //   )
  //   await Promise.all(targets.map((s) => pb.collection('lessonSchedule').delete(s.id)))
  //   await Promise.all(studentIds.map((id) => pb.collection('student').delete(id)))
  // }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function saveStudent() {
    const trimmed = formData.englishName.trim()
    if (!trimmed) return toast.error('English Name is required')

    isProcessing = true
    try {
      if (formData.id && formData.isChanged) {
        const original = students.find((s) => s.id === formData.id)
        const nextId = await getNextStudentId()
        await pb.collection('student').create({
          studentId: padId(nextId),
          name: original.name,
          englishName: original.englishName,
          course: formData.course.trim(),
          level: original.level,
          remarks: original.remarks,
          status: 'changed',
          start: formData.start || null,
          end: original.end || null,
          user: original.user,
        })
        toast.success('New record created with changed course')
      } else if (formData.id && formData.isExtended) {
        const original = students.find((s) => s.id === formData.id)
        const nextId = await getNextStudentId()
        await pb.collection('student').create({
          studentId: padId(nextId),
          name: original.name,
          englishName: original.englishName,
          course: formData.course.trim(),
          level: original.level,
          remarks: original.remarks,
          status: 'extended',
          start: formData.start || null,
          end: formData.end || null,
          user: original.user,
        })
        toast.success('New record created with extended course and dates')
      } else {
        if (!formData.id && students.some((s) => s.englishName?.toUpperCase() === trimmed.toUpperCase()))
          return toast.error(`"${trimmed}" already exists`)
        const nextId = !formData.id ? await getNextStudentId() : null
        const payload = {
          ...(nextId !== null && { studentId: padId(nextId) }),
          name: formData.name.trim(),
          englishName: trimmed,
          course: formData.course.trim(),
          level: formData.level.trim(),
          remarks: formData.remarks.trim(),
          status: formData.status,
          start: formData.start || null,
          end: formData.end || null,
        }
        if (formData.id) {
          await pb.collection('student').update(formData.id, payload)

          const original = students.find((s) => s.id === formData.id)
          if (original?.user && original.englishName?.toLowerCase() !== trimmed.toLowerCase()) {
            const newBase = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
            if (newBase) {
              try {
                await pb.collection('users').update(original.user, {
                  firstName: trimmed,
                  username: newBase,
                })
              } catch (userErr) {
                console.warn('Could not sync username:', userErr)
                toast.warning('Student updated but username sync failed — username may already be taken')
              }
            }
          }
        } else {
          const newStudent = await pb.collection('student').create(payload)
          const userId = await createStudentUser(trimmed)
          if (userId) await pb.collection('student').update(newStudent.id, { user: userId })
        }
        toast.success(formData.id ? 'Student updated' : 'Student added')
      }
      closeModal()
      await loadStudents()
    } catch (err) {
      toast.error(err?.status === 400 ? 'English Name already in use' : 'Unexpected error')
    } finally {
      isProcessing = false
    }
  }

  async function deleteStudent(id) {
    if (!confirm('Delete this student?')) return

    try {
      const student = await pb.collection('student').getOne(id)

      // delete schedules first (if still needed)
      const allSchedules = await pb.collection('lessonSchedule').getFullList()
      const targets = allSchedules.filter((item) => getId(item.student) === id)
      await Promise.all(targets.map((item) => pb.collection('lessonSchedule').delete(item.id)))

      // delete student
      await pb.collection('student').delete(id)

      // ✅ delete linked user (same as teacher)
      if (student.user) {
        await pb.collection('users').delete(student.user)
      }

      toast.success('Student deleted')
      await loadStudents()
    } catch {
      toast.error('Failed to delete student')
    }
  }

  async function saveBulkStudents() {
    if (!bulkPreview.length) return toast.error('No names entered')

    isProcessing = true
    const existingNames = new Set(students.map((s) => s.englishName?.toLowerCase()))
    const toCreate = bulkPreview.filter((row) => !existingNames.has(row.englishName.toLowerCase()))
    const skipped = bulkPreview.length - toCreate.length

    if (!toCreate.length) {
      toast.error(`All ${skipped} name(s) are duplicates`)
      isProcessing = false
      return
    }
    const nextId = await getNextStudentId()

    try {
      const results = await batchFetch(
        toCreate.map((row, i) => ({
          method: 'POST',
          url: '/api/collections/student/records',
          body: { ...row, status: bulkDefaultStatus, studentId: padId(nextId + i) },
        }))
      )
      const added = results.filter((r) => r.status >= 200 && r.status < 300).length
      const failed = results.filter((r) => r.status < 200 || r.status >= 300).length

      // ── ADDED: create a user account for each successfully created student
      const successful = toCreate
        .map((row, i) => ({ row, result: results[i] }))
        .filter(({ result }) => result.status >= 200 && result.status < 300)

      await Promise.allSettled(
        successful.map(async ({ row, result }) => {
          const userId = await createStudentUser(row.englishName)
          if (userId) await pb.collection('student').update(result.body.id, { user: userId })
        })
      )

      toast.success(
        [added && `${added} added`, skipped && `${skipped} skipped`, failed && `${failed} failed`]
          .filter(Boolean)
          .join(', ')
      )
      bulkRawInput = ''
      closeBulkModal()
      await loadStudents()
    } catch {
      toast.error('Batch request failed')
    } finally {
      isProcessing = false
    }
  }

  // ── Bulk selection ────────────────────────────────────────────────────────
  const selectAll = () => {
    selectedStudents = new Set(students.map((s) => s.id))
    renderGrid(students)
  }
  const clearSelection = () => {
    selectedStudents = new Set()
    renderGrid(students)
  }

  async function bulkDeleteStudents() {
    if (!selectedStudents.size) return toast.error('No students selected')
    if (!confirm(`Delete ${selectedStudents.size} student(s)?`)) return

    isProcessing = true

    try {
      const ids = Array.from(selectedStudents)

      const records = await pb.collection('student').getFullList({
        filter: ids.map((id) => `id="${id}"`).join(' || '),
      })

      const nameMap = Object.fromEntries(records.map((r) => [r.id, r.englishName || r.name || 'Unknown']))

      // delete schedules
      const allSchedules = await pb.collection('lessonSchedule').getFullList()
      const targets = allSchedules.filter((item) => ids.includes(getId(item.student)))

      await Promise.all(targets.map((item) => pb.collection('lessonSchedule').delete(item.id)))

      // delete students
      await Promise.all(ids.map((id) => pb.collection('student').delete(id)))

      // ✅ delete linked users (same pattern as teacher)
      await Promise.allSettled(records.filter((s) => s.user).map((s) => pb.collection('users').delete(s.user)))

      toast.success(`${ids.length} student(s) deleted`)
      selectedStudents = new Set()
      await loadStudents()
    } catch {
      toast.error('Bulk delete failed')
    } finally {
      isProcessing = false
    }
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  function downloadTemplate() {
    const csv = Papa.unparse({
      fields: ['English Name', 'Name', 'Course', 'Level', 'Remarks', 'Start', 'End', 'Status'],
      data: [],
    })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'students_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function triggerCSVImport() {
    document.getElementById('csv-import-input').click()
  }

  async function handleCSVImport(e) {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const rows = result.data
          .map((row) => {
            const normalized = {}
            for (const key in row) {
              normalized[key.trim().toLowerCase()] = row[key]
            }
            return {
              englishName: (normalized['english name'] || normalized['englishname'] || '').trim(),
              name: (normalized['name'] || '').trim(),
              course: (normalized['course'] || '').trim(),
              level: (normalized['level'] || '').trim(),
              remarks: (normalized['remarks'] || '').trim(),
              start: parseDateToISO((normalized['start'] || '').trim()),
              end: parseDateToISO((normalized['end'] || '').trim()),
              status: (normalized['status'] || 'new').trim(),
            }
          })
          .filter((r) => r.englishName)

        if (!rows.length) return toast.error('No valid rows found in CSV')

        const existingNames = new Set(students.map((s) => s.englishName?.toLowerCase()))
        const toCreate = rows.filter((r) => !existingNames.has(r.englishName.toLowerCase()))
        const skipped = rows.length - toCreate.length

        if (!toCreate.length) {
          toast.error(`All ${skipped} row(s) already exist`)
          e.target.value = ''
          return
        }
        const nextId = await getNextStudentId()

        isProcessing = true
        try {
          const results = await batchFetch(
            toCreate.map((row, i) => ({
              method: 'POST',
              url: '/api/collections/student/records',
              body: { ...row, studentId: padId(nextId + i) },
            }))
          )
          const added = results.filter((r) => r.status >= 200 && r.status < 300).length
          const failed = results.filter((r) => r.status < 200 || r.status >= 300).length

          // ── ADDED: create a user account for each successfully created student
          const successful = toCreate
            .map((row, i) => ({ row, result: results[i] }))
            .filter(({ result }) => result.status >= 200 && result.status < 300)

          await Promise.allSettled(
            successful.map(async ({ row, result }) => {
              const userId = await createStudentUser(row.englishName)
              if (userId) await pb.collection('student').update(result.body.id, { user: userId })
            })
          )

          toast.success(
            [added && `${added} imported`, skipped && `${skipped} skipped`, failed && `${failed} failed`]
              .filter(Boolean)
              .join(', ')
          )
          await loadStudents()
        } catch {
          toast.error('CSV import failed')
        } finally {
          isProcessing = false
          e.target.value = ''
        }
      },
      error: () => toast.error('Failed to parse CSV'),
    })
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openEdit = (s) => {
    formData = {
      id: s.id,
      name: s.name || '',
      englishName: s.englishName || '',
      course: s.course || '',
      level: s.level || '',
      remarks: s.remarks || '',
      status: s.status || 'new',
      start: s.start ? s.start.slice(0, 10) : '',
      end: s.end ? s.end.slice(0, 10) : '',
      isChanged: false,
      isExtended: false,
    }
    showModal = true
  }
  const closeModal = () => {
    showModal = false
    formData = { ...BLANK_FORM }
  }
  const openBulkModal = () => {
    bulkRawInput = localStorage.getItem(BULK_DRAFT_KEY) ?? ''
    bulkDefaultStatus = 'new'
    showBulkModal = true
  }
  const closeBulkModal = () => {
    showBulkModal = false
  }

  $effect(() => () => {
    if (gridInstance && gridElement) {
      gridElement.innerHTML = ''
      gridInstance = null
    }
  })
  onMount(loadStudents)
</script>

<main class="p-8 max-w-[90rem] mx-auto space-y-6">
  <!-- Header -->
  <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
    <div>
      <h1 class="text-3xl font-extrabold tracking-tight text-base-content">Student Information</h1>
      <div class="flex gap-4 mt-2 text-sm text-base-content/60">
        <span>Total <strong class="text-base-content">{stats.total}</strong></span>
        <span>New <strong class="text-success">{stats.new}</strong></span>
        <span>Old <strong class="text-info">{stats.old}</strong></span>
        <span>Graduated <strong class="text-warning">{stats.graduated}</strong></span>
        <span>Extended <strong class="text-secondary">{stats.extended}</strong></span>
        <span>Changed <strong class="text-error">{stats.changed}</strong></span>
      </div>
    </div>
    <div class="flex gap-2">
      <input id="csv-import-input" type="file" accept=".csv" class="hidden" onchange={handleCSVImport} />
      <button class="btn btn-outline shadow-sm" onclick={downloadTemplate}> Download Template </button>
      <button class="btn btn-outline shadow-sm" onclick={triggerCSVImport} disabled={isProcessing}> Import CSV </button>
      <button class="btn btn-outline shadow-sm relative" onclick={openBulkModal}>
        Add Multiple
        {#if hasDraft}<span
            class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-warning rounded-full border-2 border-base-100"
          ></span>{/if}
      </button>
    </div>
  </header>

  <!-- Bulk action bar -->
  {#if selectedStudents.size > 0}
    <div class="card bg-base-100 border border-base-200 px-5 py-3">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <p class="text-sm font-medium">
          <strong>{selectedStudents.size}</strong> student{selectedStudents.size > 1 ? 's' : ''} selected
        </p>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-xs btn-ghost" onclick={selectAll}>Select All</button>
          <button class="btn btn-xs btn-ghost" onclick={clearSelection}>Clear</button>
          <div class="divider divider-horizontal my-0 mx-1"></div>
          <button class="btn btn-xs btn-error" onclick={bulkDeleteStudents} disabled={isProcessing}>
            {isProcessing ? 'Processing…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Grid -->
  <section class="card bg-base-100 border border-base-200">
    <div class="card-body p-0">
      <div bind:this={gridElement}></div>
    </div>
  </section>
</main>

<!-- Add / Edit Modal -->
{#if showModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="modal modal-open bg-black/40" role="dialog" onclick={(e) => e.target === e.currentTarget && closeModal()}>
    <div class="modal-box max-w-lg border border-base-300 p-6">
      <div class="flex justify-between items-center mb-6">
        <h3 class="font-bold text-xl">{formData.id ? 'Update' : 'Add'} Student</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeModal}>✕</button>
      </div>

      <div class="flex flex-col gap-5">
        <!-- Primary Information -->
        <div>
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Primary Information</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label py-1" for="english-name">
                <span class="label-text font-semibold">
                  English Name <span class="opacity-40 font-normal text-xs">(required)</span>
                </span>
              </label>
              <input
                id="english-name"
                bind:value={formData.englishName}
                type="text"
                disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
                class="input input-bordered w-full focus:input-primary disabled:opacity-50"
              />
            </div>
            <div class="form-control">
              <label class="label py-1" for="student-name">
                <span class="label-text font-semibold">
                  Name <span class="opacity-40 font-normal text-xs">(optional)</span>
                </span>
              </label>
              <input
                id="student-name"
                bind:value={formData.name}
                type="text"
                disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
                class="input input-bordered w-full focus:input-primary disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <!-- Academic Information -->
        <div>
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Academic Information</p>
          <div class="grid grid-cols-3 gap-4">
            <div class="form-control">
              <label class="label py-1" for="course"><span class="label-text font-semibold">Course</span></label>
              <input
                id="course"
                bind:value={formData.course}
                type="text"
                class="input input-bordered w-full focus:input-primary"
              />
            </div>
            <div class="form-control">
              <label class="label py-1" for="level"><span class="label-text font-semibold">Level</span></label>
              <input
                id="level"
                bind:value={formData.level}
                type="text"
                disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
                class="input input-bordered w-full focus:input-primary disabled:opacity-50"
              />
            </div>
            <div class="form-control">
              <label class="label py-1" for="remarks"><span class="label-text font-semibold">Remarks</span></label>
              <input
                id="remarks"
                bind:value={formData.remarks}
                type="text"
                disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
                class="input input-bordered w-full focus:input-primary disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <!-- Status -->
        <!-- <div class="form-control">
          <label class="label py-1" for="student-status"><span class="label-text font-semibold">Status</span></label>
          <select
            id="student-status"
            bind:value={formData.status}
            disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
            class="select select-bordered w-full focus:select-primary disabled:opacity-50"
          >
            {#each STATUS_OPTIONS as opt}<option value={opt}>{capitalize(opt)}</option>{/each}
          </select>
        </div> -->

        <!-- Edit Mode (only in edit, not add) -->
        {#if formData.id}
          <div class="rounded-lg border border-base-300 bg-base-200/50 px-4 py-3 flex flex-col gap-3">
            <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide">Edit Mode</p>
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                class="checkbox checkbox-sm checkbox-error mt-0.5"
                checked={formData.isChanged}
                onchange={(e) => {
                  formData.isChanged = e.target.checked
                  if (e.target.checked) formData.isExtended = false
                }}
              />
              <div>
                <p class="font-semibold text-sm">Change</p>
                <p class="text-xs text-base-content/50">
                  Creates a new record with an updated Course. Original is preserved.
                </p>
              </div>
            </label>
            <label class="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                class="checkbox checkbox-sm checkbox-secondary mt-0.5"
                checked={formData.isExtended}
                onchange={(e) => {
                  formData.isExtended = e.target.checked
                  if (e.target.checked) formData.isChanged = false
                }}
              />
              <div>
                <p class="font-semibold text-sm">Extend</p>
                <p class="text-xs text-base-content/50">
                  Creates a new record with updated Course, Start & End dates. Original is preserved.
                </p>
              </div>
            </label>
          </div>
        {/if}

        <!-- Start & End Dates -->
        <div class="grid grid-cols-2 gap-4">
          <div class="form-control">
            <label class="label py-1" for="start-date"><span class="label-text font-semibold">Start Date</span></label>
            <input
              id="start-date"
              bind:value={formData.start}
              type="date"
              disabled={false}
              class="input input-bordered w-full focus:input-primary disabled:opacity-50"
            />
          </div>
          <div class="form-control">
            <label class="label py-1" for="end-date"><span class="label-text font-semibold">End Date</span></label>
            <input
              id="end-date"
              bind:value={formData.end}
              type="date"
              disabled={!!formData.id && formData.isChanged}
              class="input input-bordered w-full focus:input-primary disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div class="modal-action mt-8 gap-2">
        <button class="btn btn-ghost px-6" onclick={closeModal} disabled={isProcessing}>Cancel</button>
        <button class="btn btn-primary px-6 shadow-sm" onclick={saveStudent} disabled={isProcessing}>
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            {formData.id ? 'Save Changes' : 'Add Student'}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Bulk Add Modal -->
{#if showBulkModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="modal modal-open bg-black/40"
    role="dialog"
    onclick={(e) => e.target === e.currentTarget && closeBulkModal()}
  >
    <div class="modal-box max-w-2xl border border-base-300 p-6">
      <div class="flex justify-between items-center mb-1">
        <h3 class="font-bold text-xl">Add Multiple Students</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeBulkModal}>✕</button>
      </div>
      <p class="text-sm text-base-content/50 mb-2">One student per line. Duplicates are skipped automatically.</p>
      <div class="alert alert-info py-2 px-3 mb-4 text-xs">
        Paste from <strong>Google Sheets</strong> or type manually with commas. Column order:
        <code class="font-mono font-bold mx-1">Name · EnglishName · Course · Level · Remarks · Start · End</code>
        — only <strong>English Name</strong> is required.
      </div>

      <div class="flex flex-col gap-5">
        <div class="form-control">
          <label class="label py-1" for="bulk-names">
            <span class="label-text font-semibold">Student Lines</span>
            <span class="label-text-alt flex gap-2">
              {#if bulkPreview.length}<span class="text-base-content/50">{bulkPreview.length} detected</span>{/if}
              {#if bulkRawInput.trim()}
                <button
                  class="text-error text-xs underline"
                  onclick={() => {
                    bulkRawInput = ''
                    localStorage.removeItem(BULK_DRAFT_KEY)
                  }}>Clear</button
                >
              {/if}
            </span>
          </label>
          <textarea
            id="bulk-names"
            bind:value={bulkRawInput}
            class="textarea textarea-bordered w-full h-40 resize-none focus:textarea-primary font-mono text-sm"
            placeholder="Full name&#9;English name&#9;Course&#9;Level&#9;Remarks&#9;"
          ></textarea>
        </div>

        <div class="bg-base-200 rounded-lg p-3">
          <p class="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-2">Preview</p>
          <div class="overflow-x-auto max-h-48 overflow-y-auto">
            {#if bulkPreview.length > 0}
              <table class="table table-xs w-full">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>English Name</th>
                    <th>Course</th>
                    <th>Level</th>
                    <th>Remarks</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each bulkPreview as row}
                    {@const isDupe = students.some(
                      (s) => s.englishName?.toLowerCase() === row.englishName.toLowerCase()
                    )}
                    <tr class={isDupe ? 'opacity-40' : ''}>
                      <td class="text-base-content/70">{row.name || '—'}</td>
                      <td class={isDupe ? 'line-through' : 'font-medium'}>{row.englishName}</td>
                      <td class="text-base-content/70">{row.course || '—'}</td>
                      <td class="text-base-content/70">{row.level || '—'}</td>
                      <td class="text-base-content/70">{row.remarks || '—'}</td>
                      <td class="text-base-content/70">{row.start || '—'}</td>
                      <td class="text-base-content/70">{row.end || '—'}</td>
                      <td>
                        {#if isDupe}
                          <span class="badge badge-xs badge-warning">duplicate</span>
                        {:else}
                          <span class="badge badge-xs {STATUS_BADGE[bulkDefaultStatus]}">{bulkDefaultStatus}</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else}
              <div class="text-center text-base-content/40 py-8 text-sm">
                Enter student data above — preview will appear here
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="modal-action mt-8 gap-2">
        <button class="btn btn-ghost px-6" onclick={closeBulkModal} disabled={isProcessing}>Cancel</button>
        <button
          class="btn btn-primary px-6 shadow-sm"
          onclick={saveBulkStudents}
          disabled={!bulkPreview.length || isProcessing}
        >
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            {@const toAdd = bulkPreview.filter(
              (row) => !students.some((s) => s.englishName?.toLowerCase() === row.englishName.toLowerCase())
            ).length}
            Add {toAdd} Student{toAdd !== 1 ? 's' : ''}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(html) {
    scrollbar-gutter: stable;
  }
  :global(.gridjs-container) {
    border-radius: 0.75rem;
    overflow: hidden;
  }
  :global(.gridjs-search-input) {
    border-radius: 0.5rem !important;
  }
</style>
