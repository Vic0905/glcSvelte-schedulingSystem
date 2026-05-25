<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // ── State ─────────────────────────────────────────────────────────────────
  let teachers = $state([])
  let showModal = $state(false)
  let showBulkAddModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null
  let isProcessing = $state(false)
  let selectedTeachers = $state(new Set())

  let formData = $state({ id: null, name: '', status: 'enabled' })

  // Bulk add state
  const BULK_DRAFT_KEY = 'teacher_bulk_draft'
  let bulkRawInput = $state('')
  let bulkDefaultStatus = $state('enabled')
  let bulkPreview = $derived(
    bulkRawInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line, i, arr) => arr.indexOf(line) === i) // dedupe within input
  )
  let hasDraft = $derived(!!localStorage.getItem(BULK_DRAFT_KEY) && bulkRawInput.trim().length === 0)

  // Persist draft to localStorage on every change, clear when empty
  $effect(() => {
    if (bulkRawInput.trim()) {
      localStorage.setItem(BULK_DRAFT_KEY, bulkRawInput)
    } else {
      localStorage.removeItem(BULK_DRAFT_KEY)
    }
  })

  let stats = $derived({
    total: teachers.length,
    enabled: teachers.filter((t) => t.status === 'enabled').length,
    disabled: teachers.filter((t) => t.status === 'disabled').length,
  })

  const STATUS_OPTIONS = ['enabled', 'disabled']
  const STATUS_BADGE = { enabled: 'badge-success', disabled: 'badge-error' }

  // ── Grid ──────────────────────────────────────────────────────────────────
  function buildRows(records) {
    return records.map((t) => [
      h('input', {
        type: 'checkbox',
        className: 'checkbox checkbox-sm checkbox-neutral',
        checked: selectedTeachers.has(t.id),
        onChange: (e) => toggleSelection(t.id, e.target.checked),
      }),
      t.name,
      h('span', { className: `badge badge-sm ${STATUS_BADGE[t.status] ?? 'badge-neutral'}` }, t.status ?? 'enabled'),
      h('div', { className: 'flex gap-2 justify-center' }, [
        h('button', { className: 'btn btn-xs btn-outline btn-info', onclick: () => openEdit(t) }, 'Edit'),
        h('button', { className: 'btn btn-xs btn-outline btn-error', onclick: () => deleteTeacher(t.id) }, 'Delete'),
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
          { name: 'Select', width: '52px', sort: false },
          { name: 'Name' },
          { name: 'Status', width: '110px' },
          { name: 'Actions', width: '130px', sort: false },
        ],
        data,
        search: true,
        pagination: { limit: 10 },
        className: { table: 'table w-full' },
      }).render(gridElement)
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadTeachers() {
    try {
      teachers = await pb.collection('teacher').getFullList({ sort: '-created' })
      renderGrid(teachers)
    } catch {
      toast.error('Failed to load teachers')
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function saveTeacher() {
    const trimmed = formData.name.trim()
    if (!trimmed) return toast.error('Name is required')

    const dupe = teachers.some((t) => t.name.toLowerCase() === trimmed.toLowerCase() && t.id !== formData.id)
    if (dupe) return toast.error(`"${trimmed}" already exists`)

    isProcessing = true
    try {
      const payload = { name: trimmed, status: formData.status }
      if (formData.id) {
        await pb.collection('teacher').update(formData.id, payload)
        toast.success('Teacher updated')
      } else {
        await pb.collection('teacher').create(payload)
        toast.success('Teacher added')
      }
      closeModal()
      await loadTeachers()
    } catch (err) {
      toast.error(err?.status === 400 ? 'Name already in use' : 'Unexpected error')
    } finally {
      isProcessing = false
    }
  }

  async function deleteTeacher(id) {
    if (!confirm('Delete this teacher?')) return
    try {
      await pb.collection('teacher').delete(id)
      toast.success('Teacher deleted')
      await loadTeachers()
    } catch {
      toast.error('Delete failed')
    }
  }

  // ── Bulk add ──────────────────────────────────────────────────────────────
  async function saveBulkTeachers() {
    if (bulkPreview.length === 0) return toast.error('No names entered')

    isProcessing = true
    const existingNames = new Set(teachers.map((t) => t.name.toLowerCase()))

    const toCreate = bulkPreview.filter((name) => !existingNames.has(name.toLowerCase()))
    const skipped = bulkPreview.length - toCreate.length

    if (toCreate.length === 0) {
      toast.error(`All ${skipped} name(s) are duplicates`)
      isProcessing = false
      return
    }

    try {
      // PocketBase v0.23+ batch API — single round-trip for all creates
      const formData = new FormData()
      formData.append(
        '@jsonPayload',
        JSON.stringify({
          requests: toCreate.map((name) => ({
            method: 'POST',
            url: '/api/collections/teacher/records',
            body: { name, status: bulkDefaultStatus },
          })),
        })
      )

      const res = await fetch(`${pb.baseUrl}/api/batch`, {
        method: 'POST',
        headers: { Authorization: pb.authStore.token },
        body: formData,
      })

      const json = await res.json()

      // Each item in json is { status, body } — 2xx = success
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
      await loadTeachers()
    } catch (err) {
      console.error(err)
      toast.error('Batch request failed')
    } finally {
      isProcessing = false
    }
  }

  // ── Bulk status ───────────────────────────────────────────────────────────
  function toggleSelection(id, checked) {
    const next = new Set(selectedTeachers)
    checked ? next.add(id) : next.delete(id)
    selectedTeachers = next
  }

  async function selectAll() {
    selectedTeachers = new Set(teachers.map((t) => t.id))
    renderGrid(teachers)
  }

  async function clearSelection() {
    selectedTeachers = new Set()
    renderGrid(teachers)
  }

  async function bulkUpdateStatus(newStatus) {
    if (!selectedTeachers.size) return toast.error('No teachers selected')
    const label = newStatus === 'enabled' ? 'Enabled' : 'Disabled'
    if (!confirm(`Mark ${selectedTeachers.size} teacher(s) as ${label}?`)) return

    isProcessing = true
    let ok = 0,
      fail = 0
    for (const id of selectedTeachers) {
      try {
        await pb.collection('teacher').update(id, { status: newStatus })
        ok++
      } catch {
        fail++
      }
    }
    toast.success(`${ok} updated${fail ? `, ${fail} failed` : ''}`)
    selectedTeachers = new Set()
    isProcessing = false
    await loadTeachers()
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openAdd() {
    formData = { id: null, name: '', status: 'enabled' }
    showModal = true
  }

  function openEdit(teacher) {
    formData = { id: teacher.id, name: teacher.name, status: teacher.status ?? 'enabled' }
    showModal = true
  }

  function closeModal() {
    showModal = false
    formData = { id: null, name: '', status: 'enabled' }
  }

  function openBulkAddModal() {
    // Restore draft if one exists, otherwise start fresh
    bulkRawInput = localStorage.getItem(BULK_DRAFT_KEY) ?? ''
    bulkDefaultStatus = 'enabled'
    showBulkAddModal = true
  }

  function closeBulkAddModal() {
    showBulkAddModal = false
    // Don't clear bulkRawInput — it's already persisted in localStorage
    // so it will be restored next time the modal opens
  }

  // ── Cleanup on destroy ────────────────────────────────────────────────────
  $effect(() => {
    return () => {
      if (gridInstance && gridElement) {
        gridElement.innerHTML = ''
        gridInstance = null
      }
    }
  })

  onMount(loadTeachers)
</script>

<main class="p-8 max-w-7xl mx-auto space-y-6">
  <!-- Header -->
  <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
    <div>
      <h1 class="text-3xl font-extrabold tracking-tight text-base-content">Teacher Management</h1>
      <div class="flex gap-4 mt-2 text-sm text-base-content/60">
        <span>Total <strong class="text-base-content">{stats.total}</strong></span>
        <span>Enabled <strong class="text-success">{stats.enabled}</strong></span>
        <span>Disabled <strong class="text-error">{stats.disabled}</strong></span>
      </div>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-outline shadow-sm relative" onclick={openBulkAddModal}>
        Add Multiple
        {#if hasDraft}
          <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-warning rounded-full border-2 border-base-100"></span>
        {/if}
      </button>
      <button class="btn btn-outline btn-primary shadow-sm" onclick={openAdd}>Add Teacher</button>
    </div>
  </header>

  <!-- Bulk action bar -->
  {#if selectedTeachers.size > 0}
    <div class="card bg-base-100 border border-base-200 px-5 py-3">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <p class="text-sm font-medium">
          <strong>{selectedTeachers.size}</strong> teacher{selectedTeachers.size > 1 ? 's' : ''} selected
        </p>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-xs btn-ghost" onclick={selectAll}>Select All</button>
          <button class="btn btn-xs btn-ghost" onclick={clearSelection}>Clear</button>
          <div class="divider divider-horizontal my-0 mx-1"></div>
          <button
            class="btn btn-xs btn-outline btn-success"
            onclick={() => bulkUpdateStatus('enabled')}
            disabled={isProcessing}>Enable</button
          >
          <button
            class="btn btn-xs btn-outline btn-error"
            onclick={() => bulkUpdateStatus('disabled')}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing…' : 'Disable'}
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
    <div class="modal-box max-w-md border border-base-300 p-6">
      <div class="flex justify-between items-center mb-6">
        <h3 class="font-bold text-xl text-base-content">{formData.id ? 'Update' : 'Add'} Teacher</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeModal}>✕</button>
      </div>

      <div class="flex flex-col gap-5">
        <div class="form-control w-full">
          <label class="label py-1" for="teacher-name">
            <span class="label-text font-semibold text-base-content">
              Name <span class="opacity-40 font-normal text-xs">(required)</span>
            </span>
          </label>
          <input
            id="teacher-name"
            bind:value={formData.name}
            type="text"
            class="input input-bordered w-full focus:input-primary"
            placeholder="Enter teacher name"
            onkeydown={(e) => e.key === 'Enter' && saveTeacher()}
          />
        </div>

        <div class="form-control w-full">
          <label class="label py-1" for="teacher-status">
            <span class="label-text font-semibold text-base-content">Status</span>
          </label>
          <select
            id="teacher-status"
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
        <button class="btn btn-primary px-6 shadow-sm" onclick={saveTeacher} disabled={isProcessing}>
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            {formData.id ? 'Save Changes' : 'Add Teacher'}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Bulk Add Modal -->
{#if showBulkAddModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="modal modal-open bg-black/40"
    role="dialog"
    onclick={(e) => e.target === e.currentTarget && closeBulkAddModal()}
  >
    <div class="modal-box max-w-lg border border-base-300 p-6">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h3 class="font-bold text-xl text-base-content">Add Multiple Teachers</h3>
          <p class="text-sm text-base-content/50 mt-0.5">One name per line. Duplicates are skipped automatically.</p>
          {#if bulkRawInput.trim()}
            <p class="text-xs text-warning mt-1">● Draft restored — your previous input was saved.</p>
          {/if}
        </div>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeBulkAddModal}>✕</button>
      </div>

      <div class="flex flex-col gap-5">
        <!-- Textarea -->
        <div class="form-control w-full">
          <label class="label py-1" for="bulk-names">
            <span class="label-text font-semibold text-base-content">Names</span>
            <span class="label-text-alt flex items-center gap-2">
              {#if bulkPreview.length > 0}
                <span class="text-base-content/50"
                  >{bulkPreview.length} name{bulkPreview.length > 1 ? 's' : ''} detected</span
                >
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
            placeholder="John Smith&#10;Jane Doe&#10;Mike Johnson"
          ></textarea>
        </div>

        <!-- Default status -->
        <div class="form-control w-full">
          <label class="label py-1" for="bulk-status">
            <span class="label-text font-semibold text-base-content">Default Status</span>
            <span class="label-text-alt text-base-content/50">Applied to all teachers</span>
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

        <!-- Preview list -->
        {#if bulkPreview.length > 0}
          <div class="bg-base-200 rounded-lg p-3">
            <p class="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-2">Preview</p>
            <ul class="space-y-1 max-h-36 overflow-y-auto pr-1">
              {#each bulkPreview as name}
                {@const isDupe = teachers.some((t) => t.name.toLowerCase() === name.toLowerCase())}
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
          onclick={saveBulkTeachers}
          disabled={bulkPreview.length === 0 || isProcessing}
        >
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            Add {bulkPreview.filter((n) => !teachers.some((t) => t.name.toLowerCase() === n.toLowerCase())).length} Teacher{bulkPreview.filter(
              (n) => !teachers.some((t) => t.name.toLowerCase() === n.toLowerCase())
            ).length !== 1
              ? 's'
              : ''}
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
