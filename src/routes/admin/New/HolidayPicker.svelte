<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // --- State Runes ---
  let holidays = $state([])
  let showModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null

  let formData = $state({
    id: null,
    name: '',
    date: '',
  })

  // --- Load ---
  async function loadInitialData() {
    try {
      const records = await pb.collection('holiday').getFullList({
        sort: '-created',
      })

      holidays = records.sort((a, b) => new Date(a.date) - new Date(b.date))
    } catch (err) {
      toast.error('Failed to load holidays')
    }
  }

  // --- Save ---
  async function saveHoliday() {
    const name = formData.name.trim()
    const date = formData.date

    if (!name) return toast.error('Holiday name is required')
    if (!date) return toast.error('Holiday date is required')

    // local duplicate check
    const exists = holidays.find((item) => item.name.toLowerCase() === name.toLowerCase() && item.id !== formData.id)

    if (exists) return toast.error('Holiday already exists')

    try {
      const payload = {
        name,
        date,
      }

      if (formData.id) {
        await pb.collection('holiday').update(formData.id, payload)
        toast.success('Holiday updated')
      } else {
        await pb.collection('holiday').create(payload)
        toast.success('Holiday created')
      }

      closeModal()
      await loadInitialData()
    } catch (err) {
      toast.error('Save failed')
    }
  }

  // --- Edit ---
  function openEdit(item) {
    formData = {
      id: item.id,
      name: item.name,
      date: item.date?.slice(0, 10), // YYYY-MM-DD for input[type=date]
    }
    showModal = true
  }

  function openCreate() {
    formData = { id: null, name: '', date: '' }
    showModal = true
  }

  function closeModal() {
    showModal = false
    formData = { id: null, name: '', date: '' }
  }

  // --- Delete ---
  async function deleteHoliday(id) {
    if (!confirm('Delete this holiday?')) return

    try {
      await pb.collection('holiday').delete(id)
      toast.success('Deleted')
      await loadInitialData()
    } catch {
      toast.error('Delete failed')
    }
  }

  // --- Grid Init ---
  $effect(() => {
    if (gridElement && !gridInstance) {
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
    }

    return () => {
      if (gridInstance) {
        gridElement.innerHTML = ''
        gridInstance = null
      }
    }
  })

  // --- Update Grid Data ---
  $effect(() => {
    if (!gridInstance) return

    // Standardized iteration name to item so it doesn't conflict with Grid.js 'h' helper
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
            onclick: () => deleteHoliday(item.id),
          },
          'Delete'
        ),
      ]),
    ])

    gridInstance.updateConfig({ data }).forceRender()
  })

  // Svelte 5 standard onMount replacement pattern via an initialization effect
  $effect(() => {
    loadInitialData()
  })
</script>

<main class="p-8 max-w-6xl mx-auto space-y-8">
  <header class="flex justify-between items-center border-b pb-6">
    <h1 class="text-3xl font-bold">Holiday Information</h1>

    <button class="btn btn-outline btn-primary" onclick={openCreate}> Add Holiday </button>
  </header>

  <section class="card bg-base-100">
    <div class="card-body p-0">
      <div bind:this={gridElement}></div>
    </div>
  </section>
</main>

{#if showModal}
  <div class="modal modal-open bg-black/40" onclick={(e) => e.target === e.currentTarget && closeModal()}>
    <div class="modal-box max-w-md p-6 border">
      <div class="flex justify-between mb-4">
        <h3 class="text-xl font-bold">
          {formData.id ? 'Edit Holiday' : 'Add Holiday'}
        </h3>
        <button class="btn btn-sm btn-circle" onclick={closeModal}>✕</button>
      </div>

      <div class="flex flex-col gap-4">
        <div>
          <label class="label">Name</label>
          <input class="input input-bordered w-full" bind:value={formData.name} placeholder="e.g. Christmas" />
        </div>

        <div>
          <label class="label">Date</label>
          <input type="date" class="input input-bordered w-full" bind:value={formData.date} />
        </div>
      </div>

      <div class="modal-action mt-6">
        <button class="btn" onclick={closeModal}>Cancel</button>
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
  }
</style>
