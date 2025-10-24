<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let name = ''
  let editingId = null
  let showModal = false
  let grid

  async function loadSubject() {
    const records = await pb.collection('subject').getFullList({
      sort: '-created',
    })

    const data = records.map((t) => [
      t.name,
      h('div', { className: 'flex gap-2 justify-center' }, [
        h(
          'button',
          {
            className: 'btn btn-outline btn-sm btn-accent',
            onClick: () => openEdit(t),
          },
          'Edit'
        ),
        h(
          'button',
          {
            className: 'btn btn-outline btn-sm btn-error',
            onClick: () => deleteSubject(t.id),
          },
          'Delete'
        ),
      ]),
    ])

    if (grid) {
      grid.updateConfig({ data }).forceRender()
    } else {
      grid = new Grid({
        columns: ['Name', 'Actions'],
        data,
        className: {
          table: 'w-full text-xs',
          th: 'bg-base-200 p-3 border text-center font-semibold',
          td: 'p-3 border align-middle text-center',
        },
        pagination: {
          enabled: true,
          limit: 10,
        },
        search: true,
        sort: true,
      }).render(document.getElementById('subjectGrid'))
    }
  }

  async function saveSubject() {
    if (!name.trim()) {
      toast.error('Subject name is required')
      return
    }

    try {
      if (editingId) {
        await pb.collection('subject').update(editingId, { name })
        toast.success('Subject updated successfully!')
      } else {
        await pb.collection('subject').create({ name })
        toast.success('Subject added successfully!')
      }

      name = ''
      editingId = null
      showModal = false
      await loadSubject()
    } catch (err) {
      console.error(err)
      toast.error('Error saving subject')
    }
  }

  function openEdit(subject) {
    name = subject.name
    editingId = subject.id
    showModal = true
  }

  async function deleteSubject(id) {
    if (confirm('Are you sure you want to delete this subject?')) {
      try {
        await pb.collection('subject').delete(id)
        toast.success('Subject deleted successfully!')
        await loadSubject()
      } catch (err) {
        console.error(err)
        toast.error('Failed to delete subject')
      }
    }
  }

  function openAddModal() {
    name = ''
    editingId = null
    showModal = true
  }

  onMount(loadSubject)
</script>

<div class="min-h-screen bg-base-200 py-8 px-4">
  <div class="max-w-7xl mx-auto">
    <!-- Header Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-3xl font-bold text-primary mb-2">Subject Management</h1>
        </div>
        <div class="flex gap-3">
          <button class="btn btn-primary gap-2" on:click={openAddModal}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Subject
          </button>
        </div>
      </div>
    </div>

    <!-- Data Grid Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6">
      <div id="subjectGrid" class="overflow-x-auto"></div>
    </div>
  </div>
</div>

<!-- Add/Edit Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-2xl mb-6 text-base-content">{editingId ? 'Edit Subject' : 'Add New Subject'}</h3>

      <div class="space-y-6">
        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Subject Information</h4>
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text font-medium">Subject Name <span class="text-error">*</span></span>
            </label>
            <input type="text" bind:value={name} class="input input-bordered w-full" required />
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text-alt text-base-content/60">This will appear in all schedules</span>
            </label>
          </div>
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" on:click={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-primary" on:click={saveSubject}>
          {editingId ? 'Update Subject' : 'Add Subject'}
        </button>
      </div>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-backdrop" on:click={() => (showModal = false)}></div>
  </div>
{/if}
