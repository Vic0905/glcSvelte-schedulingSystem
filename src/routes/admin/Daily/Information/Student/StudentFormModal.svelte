<script>
  // ── Props ──────────────────────────────────────────────────────────────────
  let { formData = $bindable(), isProcessing = false, onSave, onClose } = $props()

  // ── Derived for edit mode ──────────────────────────────────────────────────
  let editMode = $derived(formData.isChanged ? 'changed' : formData.isExtended ? 'extended' : 'normal')
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="modal modal-open bg-black/40" role="dialog" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal-box max-w-lg border border-base-300 p-6">
    <div class="flex justify-between items-center mb-6">
      <h3 class="font-bold text-xl">{formData.id ? 'Update' : 'Add'} Student</h3>
      <button class="btn btn-sm btn-circle btn-ghost" onclick={onClose}>✕</button>
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
      <button class="btn btn-ghost px-6" onclick={onClose} disabled={isProcessing}>Cancel</button>
      <button class="btn btn-primary px-6 shadow-sm" onclick={onSave} disabled={isProcessing}>
        {#if isProcessing}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          {formData.id ? 'Save Changes' : 'Add Student'}
        {/if}
      </button>
    </div>
  </div>
</div>
