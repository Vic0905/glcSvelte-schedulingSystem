<script>
  import { onMount, untrack } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  // --- State Management (Svelte 5 Runes) ---
  let rooms = $state([])
  let teachers = $state([])
  let showModal = $state(false)
  let gridElement = $state(null)
  let gridInstance = null

  // Form State grouped into one object
  let formData = $state({
    id: null,
    name: '',
    roomType: 'mtm',
    maxStudents: 0,
    selectedTeacherId: '',
  })

  // --- Logic ---

  async function loadInitialData() {
    try {
      const [teacherList, roomList] = await Promise.all([
        pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('roomType').getFullList({ sort: '-created', sort: 'name', expand: 'teacher' }),
      ])
      teachers = teacherList
      rooms = roomList
    } catch (err) {
      toast.error('Failed to synchronize data')
    }
  }

  function checkTeacherOccupancy(teacherId) {
    if (!teacherId) return null
    const assigned = rooms.find((r) => r.teacher === teacherId && r.id !== formData.id)
    return assigned ? assigned.name : null
  }

  async function saveRoom() {
    const trimmedName = formData.name.trim()
    if (!trimmedName) return toast.error('Room name is required')

    // 1. Check if name already exists (Local Check)
    const nameExists = rooms.find((r) => r.name.toLowerCase() === trimmedName.toLowerCase() && r.id !== formData.id)
    if (nameExists) return toast.error(`A room named "${trimmedName}" already exists!`)

    // 2. Check Teacher Occupancy
    const occupiedByName = checkTeacherOccupancy(formData.selectedTeacherId)
    if (occupiedByName) return toast.error(`Teacher already assigned to ${occupiedByName}`)

    try {
      const payload = {
        name: trimmedName,
        roomType: formData.roomType,
        maxStudents: formData.maxStudents,
        teacher: formData.selectedTeacherId || null,
      }

      if (formData.id) {
        await pb.collection('roomType').update(formData.id, payload)
        toast.success('Room updated')
      } else {
        await pb.collection('roomType').create(payload)
        toast.success('Room created')
      }

      closeModal()
      await loadInitialData()
    } catch (err) {
      // 3. Handle Database Rejection (if the local check missed something)
      if (err.status === 400) {
        toast.error('Save failed: This room name is already in use.')
      } else {
        toast.error('An unexpected error occurred.')
      }
    }
  }

  function openEdit(room) {
    formData = {
      id: room.id,
      name: room.name,
      roomType: room.roomType,
      maxStudents: room.maxStudents,
      selectedTeacherId: room.teacher || '',
    }
    showModal = true
  }

  function closeModal() {
    showModal = false
    formData = { id: null, name: '', roomType: 'mtm', maxStudents: 0, selectedTeacherId: '' }
  }

  async function deleteRoom(id) {
    if (confirm('Are you sure you want to delete this room?')) {
      try {
        await pb.collection('roomType').delete(id)
        toast.success('Deleted')
        await loadInitialData()
      } catch (err) {
        toast.error('Delete failed')
      }
    }
  }

  // 1. Initialize the Grid ONLY ONCE
  $effect(() => {
    if (gridElement && !gridInstance) {
      gridInstance = new Grid({
        columns: ['Room Name', 'Type', 'Capacity', 'Teacher', { name: 'Actions', sort: false }],
        data: [], // Start empty
        search: true,
        pagination: { limit: 10 },
        className: { table: 'table w-full' },
      }).render(gridElement)
    }

    // This ONLY runs when the component is actually destroyed
    return () => {
      if (gridInstance) {
        gridElement.innerHTML = ''
        gridInstance = null
      }
    }
  })

  // 2. Update the data whenever 'rooms' changes
  $effect(() => {
    // We need to track 'rooms' so this effect re-runs when data updates
    const currentRooms = rooms

    if (gridInstance && currentRooms.length >= 0) {
      const data = currentRooms.map((r) => [
        r.name,
        r.roomType?.toUpperCase(),
        r.maxStudents,
        r.expand?.teacher?.name || 'Unassigned',
        h('div', { className: 'flex gap-2' }, [
          h(
            'button',
            {
              className: 'btn btn-xs btn-outline btn-info',
              onclick: () => openEdit(r),
            },
            'Edit'
          ),
          h(
            'button',
            {
              className: 'btn btn-xs btn-outline btn-error',
              onclick: () => deleteRoom(r.id),
            },
            'Delete'
          ),
        ]),
      ])

      gridInstance.updateConfig({ data }).forceRender()
    }
  })

  onMount(loadInitialData)
</script>

<main class="p-8 max-w-6xl mx-auto space-y-8">
  <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
    <div>
      <h1 class="text-3xl font-extrabold tracking-tight text-base-content">Room Management</h1>
    </div>
    <div class="flex items-center gap-4">
      <button class="btn btn-outline btn-primary shadow-sm" onclick={() => (showModal = true)}> Add Room </button>
    </div>
  </header>

  <section class="card bg-base-100 border border-base-200">
    <div class="card-body p-0">
      <div bind:this={gridElement}></div>
    </div>
  </section>
</main>

{#if showModal}
  <div class="modal modal-open bg-black/40">
    <div class="modal-box max-w-md border border-base-300">
      <div class="flex justify-between items-center mb-6">
        <h3 class="font-bold text-xl">{formData.id ? 'Update' : 'Create'} Room</h3>
        <button class="btn btn-sm btn-circle btn-ghost" onclick={closeModal}>✕</button>
      </div>

      <div class="space-y-5">
        <label class="form-control w-full">
          <span class="label-text font-semibold mb-1">Room Name</span>
          <input
            bind:value={formData.name}
            type="text"
            class="input input-bordered focus:input-primary"
            placeholder="e.g. A101, B202"
          />
        </label>

        <div class="grid grid-cols-2 gap-4">
          <label class="form-control w-full">
            <span class="label-text font-semibold mb-1">Room Type</span>
            <select bind:value={formData.roomType} class="select select-bordered focus:select-primary">
              <option value="mtm">1-on-1 (MTM)</option>
              <option value="grp">Group Session</option>
            </select>
          </label>
          <label class="form-control w-full">
            <span class="label-text font-semibold mb-1">Capacity</span>
            <input bind:value={formData.maxStudents} type="number" class="input input-bordered focus:input-primary" />
          </label>
        </div>

        <label class="form-control w-full">
          <span class="label-text font-semibold mb-1">Assigned Teacher</span>
          <select bind:value={formData.selectedTeacherId} class="select select-bordered focus:select-primary">
            <option value="">Unassigned</option>
            {#each teachers as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-outline btn-ghost px-8" onclick={closeModal}>Cancel</button>
        <button class="btn btn-outline btn-primary px-8" onclick={saveRoom}>
          {formData.id ? 'Save Changes' : 'Create Room'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Custom override for Grid.js theme to match professional look */
  :global(.gridjs-container) {
    border-radius: 0.75rem;
    overflow: hidden;
  }
  :global(.gridjs-search-input) {
    border-radius: 0.5rem !important;
  }
</style>
