<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // ── State ─────────────────────────────────────────────────────────────────
  let students = $state([])
  let showModal = $state(false)
  let showBulkAddModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null
  let isProcessing = $state(false)
  let selectedStudents = $state(new Set())

  let formData = $state({
    id: null,
    name: '',
    englishName: '',
    course: '',
    level: '',
    status: 'new',
  })

  // ── Bulk add state ────────────────────────────────────────────────────────
  const BULK_DRAFT_KEY = 'student_bulk_draft'
  let bulkRawInput = $state('')
  let bulkDefaultStatus = $state('new')
  let bulkPreview = $derived(
    bulkRawInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line, i, arr) => arr.indexOf(line) === i)
  )
  let hasDraft = $derived(!!localStorage.getItem(BULK_DRAFT_KEY) && bulkRawInput.trim().length === 0)

  $effect(() => {
    if (bulkRawInput.trim()) {
      localStorage.setItem(BULK_DRAFT_KEY, bulkRawInput)
    } else {
      localStorage.removeItem(BULK_DRAFT_KEY)
    }
  })

  // ── Derived stats ─────────────────────────────────────────────────────────
  let stats = $derived({
    total: students.length,
    new: students.filter((s) => s.status === 'new').length,
    old: students.filter((s) => s.status === 'old').length,
    graduated: students.filter((s) => s.status === 'graduated').length,
  })

  const STATUS_OPTIONS = ['new', 'old', 'graduated']
  const STATUS_BADGE = { new: 'badge-success', old: 'badge-info', graduated: 'badge-warning' }

  // ── Grid ──────────────────────────────────────────────────────────────────
  function buildRows(records) {
    return records.map((s) => [
      h('input', {
        type: 'checkbox',
        className: 'checkbox checkbox-sm checkbox-neutral',
        checked: selectedStudents.has(s.id),
        onChange: (e) => toggleSelection(s.id, e.target.checked),
      }),
      s.englishName || '-',
      s.name || '-',
      s.course || '-',
      s.level || '-',
      h('span', { className: `badge badge-sm ${STATUS_BADGE[s.status] ?? 'badge-neutral'}` }, s.status ?? 'new'),
      h('div', { className: 'flex gap-2 justify-center' }, [
        h('button', { className: 'btn btn-xs btn-outline btn-info', onclick: () => openEdit(s) }, 'Edit'),
        h('button', { className: 'btn btn-xs btn-outline btn-error', onclick: () => deleteStudent(s.id) }, 'Delete'),
      ]),
    ])
  }

  function renderGrid(records) {
    if (!gridElement) return
    const data = buildRows(records)

    if (gridInstance) {
      gridInstance.updateConfig({ data }).forceRender()
    } else {
      gridInstance = new Grid({
        columns: [
          { name: 'Select', width: '70px', sort: false },
          { name: 'Engish Name', width: '100px' },
          { name: 'Name', width: '150px' },
          { name: 'Course', width: '120px' },
          { name: 'Level', width: '80px' },
          { name: 'Status', width: '80px' },
          { name: 'Actions', width: '130px', sort: false },
        ],
        data,
        search: true,
        pagination: { limit: 10 },
        className: { table: 'table w-full', th: 'text-center', td: 'text-center' },
      }).render(gridElement)
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadStudents() {
    try {
      let records = await pb.collection('student').getFullList({ sort: '-created' })

      // Auto-promote "new" students older than 7 days to "old"
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const toPromote = records.filter((s) => s.status === 'new' && new Date(s.created) < cutoff)

      if (toPromote.length > 0) {
        const batch = pb.createBatch()
        for (const s of toPromote) batch.collection('student').update(s.id, { status: 'old' })
        await batch.send()
        // Reload after promotion
        records = await pb.collection('student').getFullList({ sort: '-created' })
      }

      students = records
      await tick() // ensure bind:this={gridElement} has resolved
      renderGrid(students)
    } catch {
      toast.error('Failed to load students')
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function saveStudent() {
    const trimmed = formData.englishName.trim()
    if (!trimmed) return toast.error('English Name is required')

    const dupe = students.some((s) => s.englishName?.toLowerCase() === trimmed.toLowerCase() && s.id !== formData.id)
    if (dupe) return toast.error(`"${trimmed}" already exists`)

    isProcessing = true
    try {
      const payload = {
        name: formData.name.trim(),
        englishName: trimmed,
        course: formData.course.trim(),
        level: formData.level.trim(),
        status: formData.status,
      }

      if (formData.id) {
        await pb.collection('student').update(formData.id, payload)
        toast.success('Student updated')
      } else {
        await pb.collection('student').create(payload)
        toast.success('Student added')
      }
      closeModal()
      await loadStudents()
    } catch (err) {
      toast.error(err?.status === 400 ? 'English Name already in use' : 'Unexpected error')
    } finally {
      isProcessing = false
    }
  }

  // ── Delete (single) with history archiving ────────────────────────────────
  function getId(rel) {
    if (!rel) return null
    if (Array.isArray(rel)) return rel[0]
    if (typeof rel === 'object') return rel.id
    return rel
  }

  function groupSchedules(schedules) {
    const grouped = {}
    for (const s of schedules) {
      const studentId = getId(s.student)
      const teacherId = getId(s.teacher)
      const subjectId = getId(s.subject)
      const roomId = getId(s.room)
      const timeslotId = getId(s.timeslot)
      if (!studentId || !teacherId || !subjectId || !roomId || !timeslotId) continue

      const key = `${studentId}_${teacherId}_${timeslotId}_${subjectId}_${roomId}_${s.week_id}`
      if (!grouped[key]) {
        grouped[key] = {
          student: studentId,
          teacher: teacherId,
          timeslot: timeslotId,
          subject: subjectId,
          room: roomId,
          week_id: s.week_id,
          start_date: s.date,
          end_date: s.date,
        }
      } else {
        const cur = new Date(s.date)
        if (cur < new Date(grouped[key].start_date)) grouped[key].start_date = s.date
        if (cur > new Date(grouped[key].end_date)) grouped[key].end_date = s.date
      }
    }
    return Object.values(grouped)
  }

  async function archiveAndDelete(studentIds, nameMap) {
    const allSchedules = await pb.collection('lessonSchedule').getFullList()
    const targetSchedules = allSchedules.filter((s) => studentIds.includes(getId(s.student)))
    const grouped = groupSchedules(targetSchedules)

    await Promise.all(
      grouped.map((g) =>
        pb.collection('lessonScheduleHistory').create({
          start_date: g.start_date,
          end_date: g.end_date,
          timeslot: g.timeslot,
          teacher: g.teacher,
          student: g.student,
          student_name: nameMap[g.student],
          subject: g.subject,
          room: g.room,
          week_id: g.week_id,
        })
      )
    )

    await Promise.all(targetSchedules.map((s) => pb.collection('lessonSchedule').delete(s.id)))
    await Promise.all(studentIds.map((id) => pb.collection('student').delete(id)))
  }

  async function deleteStudent(id) {
    if (!confirm('Delete this student?')) return
    try {
      const s = await pb.collection('student').getOne(id)
      const nameMap = { [id]: s.englishName || s.name || 'Unknown' }
      await archiveAndDelete([id], nameMap)
      toast.success('Student deleted and schedules archived')
      await loadStudents()
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete student')
    }
  }

  // ── Bulk add ──────────────────────────────────────────────────────────────
  async function saveBulkStudents() {
    if (bulkPreview.length === 0) return toast.error('No names entered')

    isProcessing = true
    const existingNames = new Set(students.map((s) => s.englishName?.toLowerCase()))
    const toCreate = bulkPreview.filter((name) => !existingNames.has(name.toLowerCase()))
    const skipped = bulkPreview.length - toCreate.length

    if (toCreate.length === 0) {
      toast.error(`All ${skipped} name(s) are duplicates`)
      isProcessing = false
      return
    }

    try {
      const fd = new FormData()
      fd.append(
        '@jsonPayload',
        JSON.stringify({
          requests: toCreate.map((englishName) => ({
            method: 'POST',
            url: '/api/collections/student/records',
            body: { englishName, status: bulkDefaultStatus },
          })),
        })
      )

      const res = await fetch(`${pb.baseUrl}/api/batch`, {
        method: 'POST',
        headers: { Authorization: pb.authStore.token },
        body: fd,
      })

      const json = await res.json()
      const results = Array.isArray(json) ? json : []
      const added = results.filter((r) => r.status >= 200 && r.status < 300).length
      const failed = results.filter((r) => r.status < 200 || r.status >= 300).length

      const parts = [
        added > 0 && `${added} added`,
        skipped > 0 && `${skipped} skipped (duplicate)`,
        failed > 0 && `${failed} failed`,
      ]
        .filter(Boolean)
        .join(', ')

      toast.success(parts)
      localStorage.removeItem(BULK_DRAFT_KEY)
      bulkRawInput = ''
      closeBulkAddModal()
      await loadStudents()
    } catch (err) {
      console.error(err)
      toast.error('Batch request failed')
    } finally {
      isProcessing = false
    }
  }

  // ── Bulk selection actions ────────────────────────────────────────────────
  function toggleSelection(id, checked) {
    const next = new Set(selectedStudents)
    checked ? next.add(id) : next.delete(id)
    selectedStudents = next
  }

  function selectAll() {
    selectedStudents = new Set(students.map((s) => s.id))
    renderGrid(students)
  }

  function clearSelection() {
    selectedStudents = new Set()
    renderGrid(students)
  }

  async function bulkUpdateStatus(newStatus) {
    if (!selectedStudents.size) return toast.error('No students selected')
    const label = newStatus.charAt(0).toUpperCase() + newStatus.slice(1)
    if (!confirm(`Mark ${selectedStudents.size} student(s) as ${label}?`)) return

    isProcessing = true
    try {
      const fd = new FormData()
      fd.append(
        '@jsonPayload',
        JSON.stringify({
          requests: Array.from(selectedStudents).map((id) => ({
            method: 'PATCH',
            url: `/api/collections/student/records/${id}`,
            body: { status: newStatus },
          })),
        })
      )
      const res = await fetch(`${pb.baseUrl}/api/batch`, {
        method: 'POST',
        headers: { Authorization: pb.authStore.token },
        body: fd,
      })
      const json = await res.json()
      const results = Array.isArray(json) ? json : []
      const ok = results.filter((r) => r.status >= 200 && r.status < 300).length
      const fail = results.filter((r) => r.status < 200 || r.status >= 300).length
      toast.success(`${ok} updated to ${label}${fail ? `, ${fail} failed` : ''}`)
      selectedStudents = new Set()
      await loadStudents()
    } catch {
      toast.error('Bulk update failed')
    } finally {
      isProcessing = false
    }
  }

  async function bulkDeleteStudents() {
    if (!selectedStudents.size) return toast.error('No students selected')
    if (!confirm(`Delete ${selectedStudents.size} student(s)? This will archive their schedules.`)) return

    isProcessing = true
    try {
      const ids = Array.from(selectedStudents)
      const records = await pb.collection('student').getFullList({
        filter: ids.map((id) => `id="${id}"`).join(' || '),
      })
      const nameMap = Object.fromEntries(records.map((r) => [r.id, r.englishName || r.name || 'Unknown']))
      await archiveAndDelete(ids, nameMap)
      toast.success(`${ids.length} student(s) deleted and archived`)
      selectedStudents = new Set()
      await loadStudents()
    } catch (err) {
      console.error(err)
      toast.error('Bulk delete failed')
    } finally {
      isProcessing = false
    }
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openAdd() {
    formData = { id: null, name: '', englishName: '', course: '', level: '', status: 'new' }
    showModal = true
  }

  function openEdit(student) {
    formData = {
      id: student.id,
      name: student.name || '',
      englishName: student.englishName || '',
      course: student.course || '',
      level: student.level || '',
      status: student.status || 'new',
    }
    showModal = true
  }

  function closeModal() {
    showModal = false
    formData = { id: null, name: '', englishName: '', course: '', level: '', status: 'new' }
  }

  function openBulkAddModal() {
    bulkRawInput = localStorage.getItem(BULK_DRAFT_KEY) ?? ''
    bulkDefaultStatus = 'new'
    showBulkAddModal = true
  }

  function closeBulkAddModal() {
    showBulkAddModal = false
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  $effect(() => {
    return () => {
      if (gridInstance && gridElement) {
        gridElement.innerHTML = ''
        gridInstance = null
      }
    }
  })

  onMount(loadStudents)
</script>

<main class="p-8 max-w-7xl mx-auto space-y-6">
  <!-- Header -->
  <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
    <div>
      <h1 class="text-3xl font-extrabold tracking-tight text-base-content">Student Information</h1>
      <div class="flex gap-4 mt-2 text-sm text-base-content/60">
        <span>Total <strong class="text-base-content">{stats.total}</strong></span>
        <span>New <strong class="text-success">{stats.new}</strong></span>
        <span>Old <strong class="text-info">{stats.old}</strong></span>
        <span>Graduated <strong class="text-warning">{stats.graduated}</strong></span>
      </div>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-outline shadow-sm relative" onclick={openBulkAddModal}>
        Add Multiple
        {#if hasDraft}
          <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-warning rounded-full border-2 border-base-100"></span>
        {/if}
      </button>
      <button class="btn btn-outline btn-primary shadow-sm" onclick={openAdd}>Add Student</button>
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
          <button
            class="btn btn-xs btn-outline btn-success"
            onclick={() => bulkUpdateStatus('new')}
            disabled={isProcessing}>Mark New</button
          >
          <button
            class="btn btn-xs btn-outline btn-info"
            onclick={() => bulkUpdateStatus('old')}
            disabled={isProcessing}>Mark Old</button
          >
          <button
            class="btn btn-xs btn-outline btn-warning"
            onclick={() => bulkUpdateStatus('graduated')}
            disabled={isProcessing}>Mark Graduated</button
          >
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

<!-- Single Add / Edit Modal -->
{#if showModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="modal modal-open bg-black/40" role="dialog" onclick={(e) => e.target === e.currentTarget && closeModal()}>
    <div class="modal-box max-w-lg border border-base-300 p-6">
      <div class="flex justify-between items-center mb-6">
        <h3 class="font-bold text-xl text-base-content">{formData.id ? 'Update' : 'Add'} Student</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeModal}>✕</button>
      </div>

      <div class="flex flex-col gap-5">
        <!-- Section: Primary -->
        <div>
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Primary Information</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="form-control w-full">
              <label class="label py-1" for="english-name">
                <span class="label-text font-semibold"
                  >English Name <span class="opacity-40 font-normal text-xs">(required)</span></span
                >
              </label>
              <input
                id="english-name"
                bind:value={formData.englishName}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. John"
              />
            </div>
            <div class="form-control w-full">
              <label class="label py-1" for="student-name">
                <span class="label-text font-semibold"
                  >Name <span class="opacity-40 font-normal text-xs">(optional)</span></span
                >
              </label>
              <input
                id="student-name"
                bind:value={formData.name}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. Juan Dela Cruz"
              />
            </div>
          </div>
        </div>

        <!-- Section: Academic -->
        <div>
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Academic Information</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="form-control w-full">
              <label class="label py-1" for="course">
                <span class="label-text font-semibold">Course</span>
              </label>
              <input
                id="course"
                bind:value={formData.course}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. BSIT"
              />
            </div>
            <div class="form-control w-full">
              <label class="label py-1" for="level">
                <span class="label-text font-semibold">Level</span>
              </label>
              <input
                id="level"
                bind:value={formData.level}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. 2"
              />
            </div>
          </div>
        </div>

        <!-- Status -->
        <div class="form-control w-full">
          <label class="label py-1" for="student-status">
            <span class="label-text font-semibold">Status</span>
          </label>
          <select
            id="student-status"
            bind:value={formData.status}
            class="select select-bordered w-full focus:select-primary"
          >
            {#each STATUS_OPTIONS as opt}
              <option value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
            {/each}
          </select>
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
{#if showBulkAddModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="modal modal-open bg-black/40"
    role="dialog"
    onclick={(e) => e.target === e.currentTarget && closeBulkAddModal()}
  >
    <div class="modal-box max-w-lg border border-base-300 p-6">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h3 class="font-bold text-xl text-base-content">Add Multiple Students</h3>
          <p class="text-sm text-base-content/50 mt-0.5">
            One English Name per line. Duplicates are skipped automatically.
          </p>
          {#if bulkRawInput.trim()}
            <p class="text-xs text-warning mt-1">● Draft restored — your previous input was saved.</p>
          {/if}
        </div>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeBulkAddModal}>✕</button>
      </div>

      <div class="flex flex-col gap-5">
        <div class="form-control w-full">
          <label class="label py-1" for="bulk-names">
            <span class="label-text font-semibold text-base-content">English Names</span>
            <span class="label-text-alt flex items-center gap-2">
              {#if bulkPreview.length > 0}
                <span class="text-base-content/50">{bulkPreview.length} detected</span>
              {/if}
              {#if bulkRawInput.trim()}
                <button
                  class="text-error text-xs underline underline-offset-2"
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
            placeholder="John&#10;Jane&#10;Mike"
          ></textarea>
        </div>

        <div class="form-control w-full">
          <label class="label py-1" for="bulk-status">
            <span class="label-text font-semibold text-base-content">Default Status</span>
            <span class="label-text-alt text-base-content/50">Applied to all</span>
          </label>
          <select
            id="bulk-status"
            bind:value={bulkDefaultStatus}
            class="select select-bordered w-full focus:select-primary"
          >
            {#each STATUS_OPTIONS as opt}
              <option value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
            {/each}
          </select>
        </div>

        {#if bulkPreview.length > 0}
          <div class="bg-base-200 rounded-lg p-3">
            <p class="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-2">Preview</p>
            <ul class="space-y-1 max-h-36 overflow-y-auto pr-1">
              {#each bulkPreview as name}
                {@const isDupe = students.some((s) => s.englishName?.toLowerCase() === name.toLowerCase())}
                <li class="flex items-center justify-between text-sm">
                  <span class={isDupe ? 'line-through text-base-content/40' : ''}>{name}</span>
                  {#if isDupe}
                    <span class="badge badge-xs badge-warning">duplicate</span>
                  {:else}
                    <span class="badge badge-xs {STATUS_BADGE[bulkDefaultStatus]}">{bulkDefaultStatus}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      <div class="modal-action mt-8 gap-2">
        <button class="btn btn-ghost px-6" onclick={closeBulkAddModal} disabled={isProcessing}>Cancel</button>
        <button
          class="btn btn-primary px-6 shadow-sm"
          onclick={saveBulkStudents}
          disabled={bulkPreview.length === 0 || isProcessing}
        >
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            {@const toAdd = bulkPreview.filter(
              (n) => !students.some((s) => s.englishName?.toLowerCase() === n.toLowerCase())
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
