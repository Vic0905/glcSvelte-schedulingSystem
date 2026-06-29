<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'

  // ── Props ──────────────────────────────────────────────────────────────────
  let { students = [], pb, onSaved, onClose } = $props()

  // ── Constants ──────────────────────────────────────────────────────────────
  const STATUS_OPTIONS = ['new', 'old', 'graduated', 'changed', 'extended']
  const STATUS_BADGE = {
    new: 'badge-success',
    old: 'badge-info',
    graduated: 'badge-warning',
    extended: 'badge-secondary',
    changed: 'badge-error',
  }
  const BULK_DRAFT_KEY = 'student_bulk_draft'

  // ── State ──────────────────────────────────────────────────────────────────
  let bulkRawInput = $state('')
  let bulkDefaultStatus = $state('new')
  let isProcessing = $state(false)

  // ── Init: restore draft on open ───────────────────────────────────────────
  onMount(() => {
    bulkRawInput = localStorage.getItem(BULK_DRAFT_KEY) ?? ''
  })

  // ── Helpers ────────────────────────────────────────────────────────────────
  function parseDateToISO(str) {
    if (!str) return null
    const match = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (!match) return str
    let [, month, day, year] = match
    if (year.length === 2) year = '20' + year
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  function parseColor(str) {
    const val = (str || '').trim()
    return /^#[0-9a-fA-F]{6}$/.test(val) ? val : null
  }

  const padId = (n) => String(n).padStart(5, '0')

  async function getNextStudentId() {
    try {
      const records = await pb.collection('student').getFullList({ fields: 'studentId' })
      const max = records.reduce((m, r) => Math.max(m, Number(r.studentId) || 0), 0)
      return max + 1
    } catch {
      return 1
    }
  }

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

  // ── Derived ────────────────────────────────────────────────────────────────
  let bulkPreview = $derived(
    bulkRawInput
      .split('\n')
      .map((line) => {
        const delimiter = line.includes('\t') ? '\t' : ','
        const [name = '', englishName = '', course = '', level = '', remarks = '', start = '', end = '', color = ''] =
          line.split(delimiter).map((s) => s.trim())
        return {
          englishName,
          name,
          course,
          level,
          remarks,
          start: parseDateToISO(start),
          end: parseDateToISO(end),
          color: parseColor(color),
        }
      })
      .filter(
        (row, i, arr) =>
          row.englishName.length > 0 &&
          arr.findIndex((r) => r.englishName.toLowerCase() === row.englishName.toLowerCase()) === i
      )
  )

  // ── Persist draft ─────────────────────────────────────────────────────────
  $effect(() => {
    bulkRawInput.trim() ? localStorage.setItem(BULK_DRAFT_KEY, bulkRawInput) : localStorage.removeItem(BULK_DRAFT_KEY)
  })

  // ── Save ───────────────────────────────────────────────────────────────────
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
      localStorage.removeItem(BULK_DRAFT_KEY)
      await onSaved?.()
    } catch {
      toast.error('Batch request failed')
    } finally {
      isProcessing = false
    }
  }

  function clearDraft() {
    bulkRawInput = ''
    localStorage.removeItem(BULK_DRAFT_KEY)
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="modal modal-open bg-black/40" role="dialog" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal-box max-w-2xl border border-base-300 p-6">
    <div class="flex justify-between items-center mb-1">
      <h3 class="font-bold text-xl">Add Multiple Students</h3>
      <button class="btn btn-sm btn-circle btn-ghost" onclick={onClose}>✕</button>
    </div>
    <p class="text-sm text-base-content/50 mb-2">One student per line. Duplicates are skipped automatically.</p>
    <div class="alert alert-info py-2 px-3 mb-4 text-xs">
      Paste from <strong>Google Sheets</strong> or type manually with commas. Column order:
      <code class="font-mono font-bold mx-1">Name · EnglishName · Course · Level · Remarks · Start · End · Color</code>
      — only <strong>English Name</strong> is required. <strong>Color</strong> must be a hex value
      <code class="font-mono">#rrggbb</code> or leave blank.
    </div>

    <div class="flex flex-col gap-5">
      <!-- Default Status -->
      <div class="form-control">
        <label class="label py-1" for="bulk-status">
          <span class="label-text font-semibold">Default Status</span>
        </label>
        <select
          id="bulk-status"
          bind:value={bulkDefaultStatus}
          class="select select-bordered w-full max-w-xs focus:select-primary"
        >
          {#each STATUS_OPTIONS as opt}
            <option value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
          {/each}
        </select>
      </div>

      <div class="form-control">
        <label class="label py-1" for="bulk-names">
          <span class="label-text font-semibold">Student Lines</span>
          <span class="label-text-alt flex gap-2">
            {#if bulkPreview.length}<span class="text-base-content/50">{bulkPreview.length} detected</span>{/if}
            {#if bulkRawInput.trim()}
              <button class="text-error text-xs underline" onclick={clearDraft}>Clear</button>
            {/if}
          </span>
        </label>
        <textarea
          id="bulk-names"
          bind:value={bulkRawInput}
          class="textarea textarea-bordered w-full h-40 resize-none focus:textarea-primary font-mono text-sm"
          placeholder="Full name&#9;English name&#9;Course&#9;Level&#9;Remarks&#9;Start&#9;End&#9;#4f8ef7"
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
                  <th>Color</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {#each bulkPreview as row}
                  {@const isDupe = students.some((s) => s.englishName?.toLowerCase() === row.englishName.toLowerCase())}
                  <tr class={isDupe ? 'opacity-40' : ''}>
                    <td class="text-base-content/70">{row.name || '—'}</td>
                    <td class={isDupe ? 'line-through' : 'font-medium'}>{row.englishName}</td>
                    <td class="text-base-content/70">{row.course || '—'}</td>
                    <td class="text-base-content/70">{row.level || '—'}</td>
                    <td class="text-base-content/70">{row.remarks || '—'}</td>
                    <td class="text-base-content/70">{row.start || '—'}</td>
                    <td class="text-base-content/70">{row.end || '—'}</td>
                    <td>
                      {#if row.color}
                        <span class="inline-flex items-center gap-1.5">
                          <span
                            style="width:10px;height:10px;border-radius:50%;background:{row.color};display:inline-block;border:1px solid rgba(0,0,0,.15);"
                          ></span>
                          <span class="font-mono text-[10px] opacity-70">{row.color}</span>
                        </span>
                      {:else}
                        <span class="text-base-content/30">—</span>
                      {/if}
                    </td>
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
      <button class="btn btn-ghost px-6" onclick={onClose} disabled={isProcessing}>Cancel</button>
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
