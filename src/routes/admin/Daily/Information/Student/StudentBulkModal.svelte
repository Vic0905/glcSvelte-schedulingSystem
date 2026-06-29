<script>
  // ── Props ──────────────────────────────────────────────────────────────────
  let {
    students = [],
    bulkRawInput = $bindable(''),
    bulkDefaultStatus = $bindable('new'),
    isProcessing = false,
    onSave,
    onClose,
  } = $props()

  // ── Constants ──────────────────────────────────────────────────────────────
  const STATUS_BADGE = {
    new: 'badge-success',
    old: 'badge-info',
    graduated: 'badge-warning',
    extended: 'badge-secondary',
    changed: 'badge-error',
  }
  const BULK_DRAFT_KEY = 'student_bulk_draft'

  // ── Helpers ────────────────────────────────────────────────────────────────
  function parseDateToISO(str) {
    if (!str) return null
    const match = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (!match) return str
    let [, month, day, year] = match
    if (year.length === 2) year = '20' + year
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  // ── Derived ────────────────────────────────────────────────────────────────
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

  $effect(() => {
    bulkRawInput.trim() ? localStorage.setItem(BULK_DRAFT_KEY, bulkRawInput) : localStorage.removeItem(BULK_DRAFT_KEY)
  })
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
        onclick={() => onSave(bulkPreview)}
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
