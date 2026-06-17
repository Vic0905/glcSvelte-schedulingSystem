<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { onMount } from 'svelte'

  // --- State ---
  let specialDays = $state([])
  let isLoading = $state(false)
  let showModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null

  let formData = $state({
    id: null,
    name: '',
    date: '',
    status: 'No Class',
  })

  // --- Update Grid Data ---
  function updateGrid() {
    if (!gridInstance) return

    const data = specialDays.map((item) => [
      item.name,
      new Date(item.date).toLocaleDateString(),
      h(
        'span',
        {
          className:
            item.Status === 'No Class'
              ? 'badge badge-secondary'
              : item.Status === 'Special Class'
                ? 'badge badge-warning'
                : 'badge badge-success',
        },
        item.Status
      ),
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
            onclick: () => deleteSpecialDay(item),
          },
          'Delete'
        ),
      ]),
    ])

    gridInstance.updateConfig({ data }).forceRender()
  }

  // --- Data Loading ---
  async function loadSpecialDays() {
    if (isLoading) return

    isLoading = true
    try {
      const records = await pb.collection('holiday').getFullList({ sort: '-created' })
      specialDays = records.sort((a, b) => new Date(a.date) - new Date(b.date))

      updateGrid()
    } catch (err) {
      console.error('Load failed:', err)
      toast.error('Failed to load special days')
    } finally {
      isLoading = false
    }
  }

  // --- Save (Create/Update) ---
  async function saveSpecialDay() {
    const name = formData.name.trim()
    const date = formData.date

    if (!name || !date) {
      toast.error('Please fill in all fields')
      return
    }

    // Check for duplicates
    const exists = specialDays.find((d) => d.name.toLowerCase() === name.toLowerCase() && d.id !== formData.id)
    if (exists) {
      toast.error('Entry already exists')
      return
    }

    try {
      if (formData.id) {
        await pb.collection('holiday').update(formData.id, {
          name,
          date,
          Status: formData.status,
        })
        toast.success('Updated')
      } else {
        await pb.collection('holiday').create({
          name,
          date,
          Status: formData.status,
        })
        toast.success('Created')
      }

      showModal = false
      formData = {
        id: null,
        name: '',
        date: '',
        status: 'No Class',
      }
      await loadSpecialDays()
    } catch (err) {
      console.error('Save failed:', err)
      toast.error('Save failed')
    }
  }

  // --- Delete ---
  async function deleteSpecialDay(item) {
    if (!confirm(`Delete "${item.name}"?`)) return

    try {
      await pb.collection('holiday').delete(item.id)
      toast.success('Deleted')
      await loadSpecialDays()
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error('Delete failed')
    }
  }

  // --- UI Helpers ---
  function openEdit(item) {
    formData = {
      id: item.id,
      name: item.name,
      date: item.date?.slice(0, 10),
      status: item.Status || 'No Class',
    }
    showModal = true
  }

  function openCreate() {
    formData = {
      id: null,
      name: '',
      date: '',
      status: 'No Class',
    }
    showModal = true
  }

  // --- Grid Setup ---
  onMount(() => {
    if (gridElement) {
      gridInstance = new Grid({
        columns: [
          { name: 'Name', width: '300px' },
          { name: 'Date', width: '200px' },
          { name: 'Status', width: '180px' },
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

      loadSpecialDays()
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
      <h1 class="text-3xl font-bold">Special Days</h1>
      <p class="text-sm text-gray-500 mt-1">Manage holidays, no-class days, and weekends</p>
      {#if isLoading}<p class="text-sm text-gray-400 mt-1">Loading...</p>{/if}
    </div>
    <button class="btn btn-outline btn-primary" onclick={openCreate} disabled={isLoading}> Add Special Day </button>
  </header>

  <section class="card bg-base-100 shadow-lg">
    <div class="card-body p-0">
      <div bind:this={gridElement}></div>

      {#if specialDays.length === 0 && !isLoading && gridInstance}
        <div class="text-center py-8 text-gray-500">
          <p>No entries found. Click "Add Special Day" to create one.</p>
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
        <h3 class="text-xl font-bold">{formData.id ? 'Edit Special Day' : 'Add Special Day'}</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={() => (showModal = false)}>✕</button>
      </div>

      <div class="flex flex-col gap-4">
        <input
          type="text"
          class="input input-bordered w-full"
          bind:value={formData.name}
          placeholder="Name (e.g., Christmas, Foundation Day)"
          onkeypress={(e) => e.key === 'Enter' && saveSpecialDay()}
        />

        <select class="select select-bordered w-full" bind:value={formData.status}>
          <option value="No Class">No Class</option>
          <option value="Special Class">Special Class</option>
          <option value="Weekend">Weekend</option>
        </select>

        <input
          type="date"
          class="input input-bordered w-full"
          bind:value={formData.date}
          onkeypress={(e) => e.key === 'Enter' && saveSpecialDay()}
        />
      </div>

      <div class="modal-action mt-6">
        <button class="btn btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveSpecialDay}>
          {formData.id ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(html) {
    overflow-y: scroll;
  }
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
