<script>
  import { onMount, tick } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // ── Constants ─────────────────────────────────────────────────────────────
  const STATUS_OPTIONS = ['new', 'old', 'graduated']
  const STATUS_BADGE = { new: 'badge-success', old: 'badge-info', graduated: 'badge-warning' }
  const BULK_DRAFT_KEY = 'student_bulk_draft'
  const BLANK_FORM = { id: null, name: '', englishName: '', course: '', level: '', groupName: '', status: 'new' }

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

  // ── Derived ───────────────────────────────────────────────────────────────
  let stats = $derived({
    total: students.length,
    new: students.filter((s) => s.status === 'new').length,
    old: students.filter((s) => s.status === 'old').length,
    graduated: students.filter((s) => s.status === 'graduated').length,
  })

  let bulkPreview = $derived(
    bulkRawInput
      .split('\n')
      .map((line) => {
        const delimiter = line.includes('\t') ? '\t' : ','
        const [name = '', englishName = '', course = '', level = ''] = line.split(delimiter).map((s) => s.trim())
        return { englishName, name, course, level }
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

    // console.log('Batch status:', res.status)
    // console.log('Batch response:', text)
    // console.log('Batch size:', requests.length)

    if (!res.ok) {
      throw new Error(text)
    }

    return JSON.parse(text)
  }

  // ── Grid ──────────────────────────────────────────────────────────────────
  function renderGrid(records) {
    if (!gridElement) return
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
      s.englishName || '-',
      s.name || '-',
      s.course || '-',
      s.level || '-',
      s.groupName || '-',
      h('span', { className: `badge badge-sm ${STATUS_BADGE[s.status] ?? 'badge-neutral'}` }, s.status ?? 'new'),
      h('div', { className: 'flex gap-2 justify-center' }, [
        h('button', { className: 'btn btn-xs btn-outline btn-info', onclick: () => openEdit(s) }, 'Edit'),
        h('button', { className: 'btn btn-xs btn-outline btn-error', onclick: () => deleteStudent(s.id) }, 'Delete'),
      ]),
    ])

    if (gridInstance) {
      gridInstance.updateConfig({ data }).forceRender()
    } else {
      gridInstance = new Grid({
        columns: [
          { name: 'Select', width: '70px', sort: false },
          { name: 'English Name', width: '100px' },
          { name: 'Name', width: '150px' },
          { name: 'Course', width: '120px' },
          { name: 'Level', width: '80px' },
          { name: 'Group Name', width: '120px' },
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
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const toPromote = records.filter((s) => s.status === 'new' && new Date(s.created) < cutoff)

      if (toPromote.length) {
        await Promise.allSettled(toPromote.map(({ id }) => pb.collection('student').update(id, { status: 'old' })))
        records = await pb.collection('student').getFullList({ sort: '-created' })
      }
      students = records
      await tick()
      renderGrid(students)
    } catch {
      toast.error('Failed to load students')
    }
  }

  // ── Archive & delete ──────────────────────────────────────────────────────
  async function archiveAndDelete(studentIds, nameMap) {
    const allSchedules = await pb.collection('lessonSchedule').getFullList()
    const targets = allSchedules.filter((s) => studentIds.includes(getId(s.student)))

    const grouped = {}
    for (const s of targets) {
      const [sid, tid, slid, subid, rid] = [
        getId(s.student),
        getId(s.teacher),
        getId(s.timeslot),
        getId(s.subject),
        getId(s.room),
      ]
      if (!sid || !tid || !slid || !subid || !rid) continue
      const key = `${sid}_${tid}_${slid}_${subid}_${rid}_${s.week_id}`
      if (!grouped[key]) {
        grouped[key] = {
          student: sid,
          teacher: tid,
          timeslot: slid,
          subject: subid,
          room: rid,
          week_id: s.week_id,
          start_date: s.date,
          end_date: s.date,
        }
      } else {
        const d = new Date(s.date)
        if (d < new Date(grouped[key].start_date)) grouped[key].start_date = s.date
        if (d > new Date(grouped[key].end_date)) grouped[key].end_date = s.date
      }
    }

    await Promise.all(
      Object.values(grouped).map((g) =>
        pb.collection('lessonScheduleHistory').create({ ...g, student_name: nameMap[g.student] })
      )
    )
    await Promise.all(targets.map((s) => pb.collection('lessonSchedule').delete(s.id)))
    await Promise.all(studentIds.map((id) => pb.collection('student').delete(id)))
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function saveStudent() {
    const trimmed = formData.englishName.trim()
    if (!trimmed) return toast.error('English Name is required')
    if (students.some((s) => s.englishName?.toLowerCase() === trimmed.toLowerCase() && s.id !== formData.id))
      return toast.error(`"${trimmed}" already exists`)

    isProcessing = true
    try {
      const payload = {
        name: formData.name.trim(),
        englishName: trimmed,
        course: formData.course.trim(),
        level: formData.level.trim(),
        groupName: formData.groupName.trim(),
        status: formData.status,
      }
      formData.id
        ? await pb.collection('student').update(formData.id, payload)
        : await pb.collection('student').create(payload)
      toast.success(formData.id ? 'Student updated' : 'Student added')
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
      const s = await pb.collection('student').getOne(id)
      await archiveAndDelete([id], { [id]: s.englishName || s.name || 'Unknown' })
      toast.success('Student deleted and schedules archived')
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

    try {
      const results = await batchFetch(
        toCreate.map((row) => ({
          method: 'POST',
          url: '/api/collections/student/records',
          body: { ...row, status: bulkDefaultStatus },
        }))
      )
      const added = results.filter((r) => r.status >= 200 && r.status < 300).length
      const failed = results.filter((r) => r.status < 200 || r.status >= 300).length
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

  async function bulkUpdateStatus(newStatus) {
    if (!selectedStudents.size) return toast.error('No students selected')
    if (!confirm(`Mark ${selectedStudents.size} student(s) as ${capitalize(newStatus)}?`)) return
    isProcessing = true
    try {
      const results = await batchFetch(
        Array.from(selectedStudents).map((id) => ({
          method: 'PATCH',
          url: `/api/collections/student/records/${id}`,
          body: { status: newStatus },
        }))
      )
      const ok = results.filter((r) => r.status >= 200 && r.status < 300).length
      const fail = results.filter((r) => r.status < 200 || r.status >= 300).length
      toast.success(`${ok} updated to ${capitalize(newStatus)}${fail ? `, ${fail} failed` : ''}`)
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
      const records = await pb.collection('student').getFullList({ filter: ids.map((id) => `id="${id}"`).join(' || ') })
      const nameMap = Object.fromEntries(records.map((r) => [r.id, r.englishName || r.name || 'Unknown']))
      await archiveAndDelete(ids, nameMap)
      toast.success(`${ids.length} student(s) deleted and archived`)
      selectedStudents = new Set()
      await loadStudents()
    } catch {
      toast.error('Bulk delete failed')
    } finally {
      isProcessing = false
    }
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  const openEdit = (s) => {
    formData = {
      id: s.id,
      name: s.name || '',
      englishName: s.englishName || '',
      course: s.course || '',
      level: s.level || '',
      groupName: s.groupName || '',
      status: s.status || 'new',
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
          <button class="btn btn-xs btn-error" onclick={bulkDeleteStudents} disabled={isProcessing}
            >{isProcessing ? 'Processing…' : 'Delete'}</button
          >
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
        <div>
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Primary Information</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label py-1" for="english-name"
                ><span class="label-text font-semibold"
                  >English Name <span class="opacity-40 font-normal text-xs">(required)</span></span
                ></label
              >
              <input
                id="english-name"
                bind:value={formData.englishName}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. John"
              />
            </div>
            <div class="form-control">
              <label class="label py-1" for="student-name"
                ><span class="label-text font-semibold"
                  >Name <span class="opacity-40 font-normal text-xs">(optional)</span></span
                ></label
              >
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
                placeholder="e.g. BSIT"
              />
            </div>
            <div class="form-control">
              <label class="label py-1" for="level"><span class="label-text font-semibold">Level</span></label>
              <input
                id="level"
                bind:value={formData.level}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. 2"
              />
            </div>
            <div class="form-control">
              <label class="label py-1" for="groupname"><span class="label-text font-semibold">Group</span></label>
              <input
                id="groupname"
                bind:value={formData.groupName}
                type="text"
                class="input input-bordered w-full focus:input-primary"
                placeholder="e.g. Group A"
              />
            </div>
          </div>
        </div>

        <div class="form-control">
          <label class="label py-1" for="student-status"><span class="label-text font-semibold">Status</span></label>
          <select
            id="student-status"
            bind:value={formData.status}
            class="select select-bordered w-full focus:select-primary"
          >
            {#each STATUS_OPTIONS as opt}<option value={opt}>{capitalize(opt)}</option>{/each}
          </select>
        </div>
      </div>

      <div class="modal-action mt-8 gap-2">
        <button class="btn btn-ghost px-6" onclick={closeModal} disabled={isProcessing}>Cancel</button>
        <button class="btn btn-primary px-6 shadow-sm" onclick={saveStudent} disabled={isProcessing}>
          {#if isProcessing}<span class="loading loading-spinner loading-sm"></span>
          {:else}{formData.id ? 'Save Changes' : 'Add Student'}{/if}
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
        <code class="font-mono font-bold mx-1">Name · EnglishName · Course · Level</code>
        — only <strong>English Name</strong> is required.
      </div>

      <div class="flex flex-col gap-5">
        <div class="form-control">
          <label class="label py-1" for="bulk-names">
            <span class="label-text font-semibold">Student Lines</span>
            <span class="label-text-alt flex gap-2">
              {#if bulkPreview.length}<span class="text-base-content/50">{bulkPreview.length} detected</span>{/if}
              {#if bulkRawInput.trim()}<button
                  class="text-error text-xs underline"
                  onclick={() => {
                    bulkRawInput = ''
                    localStorage.removeItem(BULK_DRAFT_KEY)
                  }}>Clear</button
                >{/if}
            </span>
          </label>
          <textarea
            id="bulk-names"
            bind:value={bulkRawInput}
            class="textarea textarea-bordered w-full h-40 resize-none focus:textarea-primary font-mono text-sm"
            placeholder="Full name&#9;English name&#9;Course&#9;Level&#9;&#9"
          ></textarea>
        </div>

        <div class="form-control">
          <label class="label py-1" for="bulk-status">
            <span class="label-text font-semibold">Default Status</span>
            <span class="label-text-alt text-base-content/50">Applied to all</span>
          </label>
          <select
            id="bulk-status"
            bind:value={bulkDefaultStatus}
            class="select select-bordered w-full focus:select-primary"
          >
            {#each STATUS_OPTIONS as opt}<option value={opt}>{capitalize(opt)}</option>{/each}
          </select>
        </div>

        {#if bulkPreview.length > 0}
          <div class="bg-base-200 rounded-lg p-3">
            <p class="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-2">Preview</p>
            <div class="overflow-x-auto max-h-48 overflow-y-auto">
              <table class="table table-xs w-full">
                <thead><tr><th>Name</th><th>English Name</th><th>Course</th><th>Level</th><th>Status</th></tr></thead>
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
                      <td>
                        {#if isDupe}<span class="badge badge-xs badge-warning">duplicate</span>
                        {:else}<span class="badge badge-xs {STATUS_BADGE[bulkDefaultStatus]}">{bulkDefaultStatus}</span
                          >{/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      </div>

      <div class="modal-action mt-8 gap-2">
        <button class="btn btn-ghost px-6" onclick={closeBulkModal} disabled={isProcessing}>Cancel</button>
        <button
          class="btn btn-primary px-6 shadow-sm"
          onclick={saveBulkStudents}
          disabled={!bulkPreview.length || isProcessing}
        >
          {#if isProcessing}<span class="loading loading-spinner loading-sm"></span>
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
