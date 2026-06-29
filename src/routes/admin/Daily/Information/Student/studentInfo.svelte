<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import Papa from 'papaparse'
  import { pb } from '../../../../../lib/Pocketbase.svelte'
  import StudentFormModal from './StudentFormModal.svelte'
  import StudentBulkModal from './StudentBulkModal.svelte'

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
  let importProgress = $state({ current: 0, total: 0 })
  let selectedStudents = $state(new Set())
  let formData = $state({ ...BLANK_FORM })
  let bulkRawInput = $state('')
  let bulkDefaultStatus = $state('new')

  // ── State ─────────────────────────────────────────────────────────────────
  let viewedStudent = $state(null)
  let viewSchedules = $state([])
  let isLoadingSchedule = $state(false)

  let scheduleDate = $derived(getScheduleEndDate(viewedStudent))

  // ── Derived: schedule for the student's END DATE only ──────────────────────
  let dayPeriods = $derived(() => {
    const map = new Map()
    for (const s of viewSchedules) {
      const ts = s.expand?.timeslot
      if (!ts) continue
      if (!map.has(ts.id)) {
        map.set(ts.id, { start: ts.start, end: ts.end, entries: [] })
      }
      map.get(ts.id).entries.push({
        subject: s.expand?.subject?.name ?? '—',
        teacher: s.expand?.teacher?.name ?? '—',
        room: s.expand?.room?.name ?? '—',
      })
    }
    return [...map.values()].sort((a, b) => a.start.localeCompare(b.start))
  })

  // ── Derived ───────────────────────────────────────────────────────────────
  let stats = $derived({
    total: students.length,
    new: students.filter((s) => s.status === 'new').length,
    old: students.filter((s) => s.status === 'old').length,
    graduated: students.filter((s) => s.status === 'graduated').length,
    extended: students.filter((s) => s.status === 'extended').length,
    changed: students.filter((s) => s.status === 'changed').length,
  })

  let hasDraft = $derived(!!localStorage.getItem(BULK_DRAFT_KEY) && !bulkRawInput.trim())

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

  async function batchFetchChunked(requests, chunkSize = 5000, onProgress) {
    const allResults = []
    for (let i = 0; i < requests.length; i += chunkSize) {
      const chunk = requests.slice(i, i + chunkSize)
      const res = await batchFetch(chunk)
      allResults.push(...res)
      onProgress?.(allResults.length, requests.length)
    }
    return allResults
  }

  function getScheduleEndDate(student) {
    if (!student?.end) return null
    const d = new Date(student.end)
    const startD = new Date(student.start)
    while (d.getDay() !== 5) {
      d.setDate(d.getDate() - 1)
    }
    if (d < startD) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // ── User account helper ────────────────────────────────────────────────────
  async function createStudentUser(englishName) {
    const trimmedName = englishName.trim()
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
      h('div', { className: 'flex gap-1 justify-center flex-wrap' }, [
        h(
          'button',
          {
            className: `btn btn-xs btn-outline ${viewedStudent?.id === s.id ? 'btn-primary' : 'btn-ghost'}`,
            onclick: (e) => {
              const btn = e.target
              loadStudentSchedules(s)
              if (viewedStudent?.id === s.id) {
                btn.textContent = 'Hide'
              } else {
                btn.textContent = 'View'
              }
            },
          },
          viewedStudent?.id === s.id ? 'Hide' : 'View'
        ),
        h('button', { className: 'btn btn-xs btn-outline btn-info', onclick: () => openEdit(s) }, 'Edit'),
        h('button', { className: 'btn btn-xs btn-outline btn-error', onclick: () => deleteStudent(s.id) }, 'Delete'),
      ]),
    ])

    gridInstance = new Grid({
      columns: [
        { name: '-', width: '50px', sort: false },
        { name: 'Student ID', width: '80px' },
        { name: 'English Name', width: '100px' },
        { name: 'Name', width: '120px' },
        { name: 'Course', width: '90px' },
        { name: 'Level', width: '90px' },
        { name: 'Remarks', width: '90px' },
        { name: 'Start', width: '90px' },
        { name: 'End', width: '90px' },
        { name: 'Status', width: '90px' },
        { name: 'Actions', width: '150px', sort: false },
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

      const allSchedules = await pb.collection('lessonSchedule').getFullList()
      const targets = allSchedules.filter((item) => getId(item.student) === id)
      await Promise.all(targets.map((item) => pb.collection('lessonSchedule').delete(item.id)))

      await pb.collection('student').delete(id)

      if (student.user) {
        await pb.collection('users').delete(student.user)
      }

      toast.success('Student deleted')
      await loadStudents()
    } catch {
      toast.error('Failed to delete student')
    }
  }

  async function saveBulkStudents(bulkPreview) {
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
      const results = await batchFetchChunked(
        toCreate.map((row, i) => ({
          method: 'POST',
          url: '/api/collections/student/records',
          body: { ...row, status: bulkDefaultStatus, studentId: padId(nextId + i) },
        }))
      )
      const added = results.filter((r) => r.status >= 200 && r.status < 300).length
      const failed = results.filter((r) => r.status < 200 || r.status >= 300).length

      const successful = toCreate
        .map((row, i) => ({ row, result: results[i] }))
        .filter(({ result }) => result.status >= 200 && result.status < 300)

      for (const { row, result } of successful) {
        const userId = await createStudentUser(row.englishName)
        if (userId) await pb.collection('student').update(result.body.id, { user: userId })
      }

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

      const allSchedules = await pb.collection('lessonSchedule').getFullList()
      const targets = allSchedules.filter((item) => ids.includes(getId(item.student)))

      await Promise.all(targets.map((item) => pb.collection('lessonSchedule').delete(item.id)))
      await Promise.all(ids.map((id) => pb.collection('student').delete(id)))
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
        importProgress = { current: 0, total: toCreate.length }
        try {
          const results = await batchFetchChunked(
            toCreate.map((row, i) => ({
              method: 'POST',
              url: '/api/collections/student/records',
              body: { ...row, studentId: padId(nextId + i) },
            })),
            50,
            (current, total) => (importProgress = { current, total })
          )
          const added = results.filter((r) => r.status >= 200 && r.status < 300).length
          const failed = results.filter((r) => r.status < 200 || r.status >= 300).length

          const successful = toCreate
            .map((row, i) => ({ row, result: results[i] }))
            .filter(({ result }) => result.status >= 200 && result.status < 300)

          for (const { row, result } of successful) {
            const userId = await createStudentUser(row.englishName)
            if (userId) await pb.collection('student').update(result.body.id, { user: userId })
          }

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

  // ── Formatting helpers for the printable day-schedule ───────────────────────
  function fmtTime(t) {
    if (!t) return '—'
    const [h, m = '00'] = t.split(':')
    return `${parseInt(h, 10)}:${m}`
  }

  function fmtFullDate(d) {
    return new Date(d + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .toUpperCase()
  }

  async function loadStudentSchedules(student) {
    if (viewedStudent?.id === student.id) {
      viewedStudent = null
      viewSchedules = []
      return
    }

    viewedStudent = student
    viewSchedules = []
    isLoadingSchedule = true

    const targetDate = getScheduleEndDate(student)
    if (!targetDate) {
      isLoadingSchedule = false
      return
    }

    try {
      viewSchedules = await pb.collection('dailySchedule').getFullList({
        filter: `student = "${student.id}" && date >= "${targetDate} 00:00:00.000Z" && date <= "${targetDate} 23:59:59.999Z"`,
        expand: 'timeslot,room,teacher,subject',
        sort: 'date',
      })
    } catch {
      toast.error('Failed to load schedules')
    } finally {
      isLoadingSchedule = false
    }
  }

  $effect(() => () => {
    if (gridInstance && gridElement) {
      gridElement.innerHTML = ''
      gridInstance = null
    }
  })
  onMount(loadStudents)
</script>

<main class="p-8 max-w-[100rem] mx-auto space-y-6">
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
      <button
        class="btn btn-primary shadow-sm"
        onclick={() => {
          formData = { ...BLANK_FORM }
          showModal = true
        }}
      >
        Add Student
      </button>
    </div>
  </header>

  {#if isProcessing && importProgress.total > 0}
    <div class="space-y-1">
      <div class="w-full bg-base-200 rounded-full h-2 overflow-hidden">
        <div
          class="bg-primary h-2 transition-all duration-300"
          style="width: {Math.round((importProgress.current / importProgress.total) * 100)}%"
        ></div>
      </div>
      <p class="text-xs text-base-content/60 text-right">
        Importing {importProgress.current} / {importProgress.total}
      </p>
    </div>
  {/if}

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

  <!-- Printable end-date schedule -->
  {#if viewedStudent}
    <section class="card bg-base-100 border-2 border-black overflow-hidden">
      <div class="card-body p-0">
        <!-- Title bar -->
        <div class="flex items-center justify-between border-b-2 border-black px-6 py-4">
          <h2 class="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase">Student's Schedule</h2>
          <button
            class="btn btn-sm btn-ghost btn-circle"
            onclick={() => {
              viewedStudent = null
              viewSchedules = []
            }}>✕</button
          >
        </div>

        <!-- Info row -->
        <div class="grid grid-cols-1 sm:grid-cols-3 border-b-2 border-black text-sm">
          <div class="border-b sm:border-b-0 sm:border-r-2 border-black px-4 py-3">
            <span class="font-bold uppercase">Name: </span>{viewedStudent.name || '—'}
          </div>
          <div class="border-b sm:border-b-0 sm:border-r-2 border-black px-4 py-3">
            <span class="font-bold uppercase">English Name: </span>{viewedStudent.englishName || '—'}
          </div>
          <div class="px-4 py-3 font-bold text-error">
            {#if scheduleDate}
              DATE: {fmtFullDate(scheduleDate)} ONLY
            {:else}
              No schedule date for this student
            {/if}
          </div>
        </div>

        {#if isLoadingSchedule}
          <div class="flex justify-center py-10">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        {:else if !scheduleDate}
          <div class="text-center text-base-content/40 py-10 text-sm">
            This student has no start date set, so no schedule day can be shown.
          </div>
        {:else if dayPeriods().length === 0}
          <div class="text-center text-base-content/40 py-10 text-sm">
            No schedule found for {fmtFullDate(scheduleDate)}.
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table w-full text-center border-collapse">
              <thead>
                <tr class="text-sm font-bold uppercase">
                  <th class="border-2 border-black py-2">Period</th>
                  <th class="border-2 border-black py-2">Time</th>
                  <th class="border-2 border-black py-2">Teacher</th>
                  <th class="border-2 border-black py-2">Cubicle/Room</th>
                  <th class="border-2 border-black py-2">Class/Subject</th>
                </tr>
              </thead>
              <tbody>
                {#each dayPeriods() as p, i}
                  <tr>
                    <td class="border-2 border-black font-bold py-2">{i + 1}</td>
                    <td class="border-2 border-black py-2 whitespace-nowrap">
                      {fmtTime(p.start)} - {fmtTime(p.end)}
                    </td>
                    <td class="border-2 border-black py-2">{p.entries.map((e) => e.teacher).join(', ')}</td>
                    <td class="border-2 border-black py-2">{p.entries.map((e) => e.room).join(', ')}</td>
                    <td class="border-2 border-black py-2">{p.entries.map((e) => e.subject).join(', ')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</main>

<!-- Add / Edit Modal -->
{#if showModal}
  <StudentFormModal bind:formData {isProcessing} onSave={saveStudent} onClose={closeModal} />
{/if}

<!-- Bulk Add Modal -->
{#if showBulkModal}
  <StudentBulkModal
    {students}
    bind:bulkRawInput
    bind:bulkDefaultStatus
    {isProcessing}
    onSave={saveBulkStudents}
    onClose={closeBulkModal}
  />
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
