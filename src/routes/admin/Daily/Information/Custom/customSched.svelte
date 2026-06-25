<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../../lib/Pocketbase.svelte'

  let schedules = $state([])
  let showModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null

  let formData = $state({
    id: null,
    name: '',
    color: '#4f8ef7',
  })

  async function loadInitialData() {
    try {
      const records = await pb.collection('customSchedule').getFullList({
        sort: '-created',
      })
      schedules = records.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
    } catch (err) {
      toast.error('Failed to synchronize data')
    }
  }

  async function saveSchedule() {
    const trimmedName = formData.name.trim()
    if (!trimmedName) return toast.error('Schedule name is required')

    const nameExists = schedules.find((s) => s.name.toLowerCase() === trimmedName.toLowerCase() && s.id !== formData.id)
    if (nameExists) return toast.error(`A schedule named "${trimmedName}" already exists!`)

    try {
      const payload = {
        name: trimmedName,
        color: formData.color,
      }

      if (formData.id) {
        await pb.collection('customSchedule').update(formData.id, payload)
        toast.success('Schedule updated')
      } else {
        await pb.collection('customSchedule').create(payload)
        toast.success('Schedule created')
      }

      closeModal()
      await loadInitialData()
    } catch (err) {
      if (err.status === 400) {
        toast.error('Save failed: This schedule name is already in use.')
      } else {
        toast.error('An unexpected error occurred.')
      }
    }
  }

  function openEdit(schedule) {
    formData = {
      id: schedule.id,
      name: schedule.name,
      color: schedule.color || '#4f8ef7',
    }
    showModal = true
  }

  function closeModal() {
    showModal = false
    formData = { id: null, name: '', color: '#4f8ef7' }
  }

  async function deleteSchedule(id) {
    if (confirm('Are you sure you want to delete this custom schedule?')) {
      try {
        await pb.collection('customSchedule').delete(id)
        toast.success('Deleted')
        await loadInitialData()
      } catch (err) {
        toast.error('Delete failed')
      }
    }
  }

  $effect(() => {
    if (gridElement && !gridInstance) {
      gridInstance = new Grid({
        columns: [
          { name: 'Schedule Name', width: '260px' },
          { name: 'Color', width: '160px', sort: false },
          { name: 'Actions', width: '180px', sort: false },
        ],
        data: [],
        search: true,
        pagination: { limit: 10 },
        className: { table: 'table w-full', th: 'text-center', td: 'text-center' },
      }).render(gridElement)
    }

    return () => {
      if (gridInstance) {
        gridElement.innerHTML = ''
        gridInstance = null
      }
    }
  })

  $effect(() => {
    const currentSchedules = schedules

    if (gridInstance && currentSchedules.length >= 0) {
      const data = currentSchedules.map((s) => {
        const color = s.color || '#cccccc'

        return [
          // Name cell — colored badge
          h(
            'span',
            {
              style: `display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:500;background:${color}20;color:${color};`,
            },
            [
              h('span', {
                style: `width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;`,
              }),
              s.name,
            ]
          ),

          // Color cell — swatch + hex
          h('div', { style: 'display:flex;align-items:center;gap:8px;justify-content:center;' }, [
            h('span', {
              style: `width:18px;height:18px;border-radius:50%;background:${color};border:1px solid rgba(0,0,0,.12);display:inline-block;flex-shrink:0;`,
            }),
            h('span', { style: 'font-size:12px;opacity:.65;font-family:monospace;' }, color),
          ]),

          // Actions cell
          h('div', { className: 'flex gap-2 justify-center' }, [
            h('button', { className: 'btn btn-xs btn-outline btn-info', onclick: () => openEdit(s) }, 'Edit'),
            h(
              'button',
              { className: 'btn btn-xs btn-outline btn-error', onclick: () => deleteSchedule(s.id) },
              'Delete'
            ),
          ]),
        ]
      })

      gridInstance.updateConfig({ data }).forceRender()
    }
  })

  onMount(loadInitialData)
</script>

<main class="p-8 max-w-[90rem] mx-auto space-y-6">
  <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
    <div>
      <h1 class="text-3xl font-extrabold tracking-tight text-base-content">Custom Schedule Information</h1>
    </div>
    <div class="flex items-center gap-4">
      <button class="btn btn-outline btn-primary shadow-sm" onclick={() => (showModal = true)}>
        Add Custom Schedule
      </button>
    </div>
  </header>

  <section class="card bg-base-100 border border-base-200">
    <div class="card-body p-0">
      <div bind:this={gridElement}></div>
    </div>
  </section>
</main>

{#if showModal}
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal modal-open bg-black/40" role="dialog" onclick={(e) => e.target === e.currentTarget && closeModal()}>
    <div class="modal-box max-w-md border border-base-300 p-6">
      <div class="flex justify-between items-center mb-6">
        <h3 class="font-bold text-xl text-base-content">
          {formData.id ? 'Update' : 'Create'} Custom Schedule
        </h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeModal}>✕</button>
      </div>

      <div class="flex flex-col gap-5">
        <div class="form-control w-full">
          <label class="label py-1" for="schedule-name">
            <span class="label-text font-semibold text-base-content">Schedule Name</span>
          </label>
          <input
            id="schedule-name"
            bind:value={formData.name}
            type="text"
            class="input input-bordered w-full focus:input-primary"
            placeholder="e.g. Morning Shift"
          />
        </div>

        <div class="form-control w-full">
          <label class="label py-1" for="schedule-color">
            <span class="label-text font-semibold text-base-content">Color</span>
          </label>
          <div class="flex items-center gap-3">
            <input
              id="schedule-color"
              bind:value={formData.color}
              type="color"
              class="w-12 h-10 rounded-lg border border-base-300 cursor-pointer p-0.5 bg-base-100"
            />
            <span
              class="badge badge-lg font-medium"
              style="background:{formData.color}20; color:{formData.color}; border:none;"
            >
              <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style="background:{formData.color};"></span>
              {formData.name || 'Preview'}
            </span>
            <span class="text-xs text-base-content/50 font-mono">{formData.color}</span>
          </div>
        </div>
      </div>

      <div class="modal-action mt-8 gap-2">
        <button class="btn btn-ghost px-6" onclick={closeModal}>Cancel</button>
        <button class="btn btn-primary px-6 shadow-sm" onclick={saveSchedule}>
          {formData.id ? 'Save Changes' : 'Create Schedule'}
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
