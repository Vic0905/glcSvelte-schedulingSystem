<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  // --- State ---
  let holidays = $state([])
  let isLoading = $state(false)
  let showModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null

  let formData = $state({
    id: null,
    name: '',
    date: '',
  })

  // --- Update Grid Data ---
  function updateGrid() {
    if (!gridInstance) return

    const data = holidays.map((item) => [
      item.name,
      new Date(item.date).toLocaleDateString(),
      h('div', { className: 'flex gap-2 justify-center' }, [
        h(
          'button',
          {
            className: 'btn btn-xs btn-outline btn-info',
            onclick: () => openEdit(item),
          },
          'Edit'
        ),
        h(
          'button',
          {
            className: 'btn btn-xs btn-outline btn-error',
            onclick: () => deleteHoliday(item),
          },
          'Delete'
        ),
      ]),
    ])

    gridInstance.updateConfig({ data }).forceRender()
  }

  // --- Data Loading ---
  async function loadHolidays() {
    if (isLoading) return

    isLoading = true
    try {
      const records = await pb.collection('holiday').getFullList({ sort: '-created' })
      holidays = records.sort((a, b) => new Date(a.date) - new Date(b.date))

      // Update grid after data loads
      updateGrid()
    } catch (err) {
      console.error('Load failed:', err)
      toast.error('Failed to load holidays')
    } finally {
      isLoading = false
    }
  }

  // --- Save Holiday (Create/Update) ---
  async function saveHoliday() {
    const name = formData.name.trim()
    const date = formData.date

    if (!name || !date) {
      toast.error('Please fill in all fields')
      return
    }

    // Check for duplicates
    const exists = holidays.find((h) => h.name.toLowerCase() === name.toLowerCase() && h.id !== formData.id)
    if (exists) {
      toast.error('Holiday already exists')
      return
    }

    try {
      if (formData.id) {
        await pb.collection('holiday').update(formData.id, { name, date })
        toast.success('Holiday updated')
      } else {
        await pb.collection('holiday').create({ name, date })
        toast.success('Holiday created')
      }

      showModal = false
      formData = { id: null, name: '', date: '' }
      await loadHolidays()
    } catch (err) {
      console.error('Save failed:', err)
      toast.error('Save failed')
    }
  }

  // --- Delete Holiday ---
  async function deleteHoliday(holiday) {
    if (!confirm(`Delete "${holiday.name}"?`)) return

    try {
      await pb.collection('holiday').delete(holiday.id)
      toast.success('Deleted')
      await loadHolidays()
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error('Delete failed')
    }
  }

  // --- UI Helpers ---
  function openEdit(holiday) {
    formData = {
      id: holiday.id,
      name: holiday.name,
      date: holiday.date?.slice(0, 10),
    }
    showModal = true
  }

  function openCreate() {
    formData = { id: null, name: '', date: '' }
    showModal = true
  }

  // --- Grid Setup ---
  onMount(() => {
    if (gridElement) {
      gridInstance = new Grid({
        columns: [
          { name: 'Holiday Name', width: '300px' },
          { name: 'Date', width: '200px' },
          { name: 'Actions', width: '200px', sort: false },
        ],
        data: [],
        search: true,
        pagination: { limit: 10 },
        className: {
          table: 'table w-full',
          th: 'text-center',
          td: 'text-center',
        },
      }).render(gridElement)

      // Load data AFTER grid is initialized
      loadHolidays()
    }

    return () => {
      if (gridInstance) {
        gridInstance.destroy()
        gridInstance = null
      }
    }
  })
</script>

<main class="p-8 max-w-[90rem] mx-auto space-y-6">
  <header class="flex justify-between items-center border-b pb-6">
    <div>
      <h1 class="text-3xl font-bold">Holiday/Special Class Information</h1>
      {#if isLoading}<p class="text-sm text-gray-500 mt-2">Loading...</p>{/if}
    </div>
    <button class="btn btn-outline btn-primary" onclick={openCreate} disabled={isLoading}> Add Holiday </button>
  </header>

  <section class="card bg-base-100 shadow-lg">
    <div class="card-body p-0">
      <!-- Always show the grid container, even when empty -->
      <div bind:this={gridElement}></div>

      <!-- Optional: Show message when no data AND not loading -->
      {#if holidays.length === 0 && !isLoading && gridInstance}
        <div class="text-center py-8 text-gray-500">
          <p>No holidays found. Click "Add Holiday" to create one.</p>
        </div>
      {/if}
    </div>
  </section>
</main>

{#if showModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal modal-open bg-black/50" onclick={(e) => e.target === e.currentTarget && (showModal = false)}>
    <div class="modal-box max-w-md p-6">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-bold">{formData.id ? 'Edit Holiday' : 'Add Holiday'}</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={() => (showModal = false)}>✕</button>
      </div>

      <div class="flex flex-col gap-4">
        <input
          type="text"
          class="input input-bordered w-full"
          bind:value={formData.name}
          placeholder="Holiday name (e.g., Christmas)"
          onkeypress={(e) => e.key === 'Enter' && saveHoliday()}
        />

        <input
          type="date"
          class="input input-bordered w-full"
          bind:value={formData.date}
          onkeypress={(e) => e.key === 'Enter' && saveHoliday()}
        />
      </div>

      <div class="modal-action mt-6">
        <button class="btn btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveHoliday}>
          {formData.id ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.gridjs-container) {
    border-radius: 0.75rem;
    overflow: hidden;
  }
  :global(.gridjs-search-input) {
    border-radius: 0.5rem !important;
    padding: 0.5rem;
  }
  :global(.gridjs-pagination) {
    padding: 1rem;
  }
  :global(.gridjs-th) {
    background-color: #f8fafc;
    font-weight: 600;
  }
  :global(.gridjs-td) {
    padding: 0.75rem;
  }
</style>
