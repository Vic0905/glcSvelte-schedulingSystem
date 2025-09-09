<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../lib/Pocketbase.svelte'

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
          table: 'w-full text-sm relative',
          th: 'bg-slate-100 p-2 border text-center',
          td: 'p-2 border align-middle text-center',
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
      toast.error('Name is required')
      return
    }

    try {
      if (editingId) {
        await pb.collection('subject').update(editingId, { name })
        toast.success('Subject updated!')
      } else {
        await pb.collection('subject').create({ name })
        toast.success('Subject added!')
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
        toast.success('Subject deleted!')
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

<div class="p-6 max-w-4xl mx-auto bg-base-100 shadow-lg rounded-xl mt-10">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Subject Management</h2>
    <button class="btn btn-outline btn-primary" on:click={openAddModal}>Add Subject</button>
  </div>

  <div id="subjectGrid"></div>
</div>

<!-- Modal -->
{#if showModal}
  <dialog open class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{editingId ? 'Edit' : 'Add'} Subject</h3>
      <input type="text" bind:value={name} placeholder="Subject Name" class="input w-full mb-4" />
      <div class="modal-action">
        <button class="btn btn-outline btn-neutral" on:click={saveSubject}>
          {editingId ? 'Update' : 'Save'}
        </button>
        <button class="btn btn-outline btn-neutral" on:click={() => (showModal = false)}>Cancel</button>
      </div>
    </div>
  </dialog>
{/if}
