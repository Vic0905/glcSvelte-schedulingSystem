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

  async function loadTeachers() {
    const records = await pb.collection('teacher').getFullList({
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
            onClick: () => deleteTeacher(t.id),
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
          th: 'bg-slate-100 p-2 border text-center',
          td: 'p-2 border align-middle text-center',
        },
        pagination: {
          enabled: true,
          limit: 10,
        },
        search: true,
        sort: true,
      }).render(document.getElementById('teacherGrid'))
    }
  }

  async function saveTeacher() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    try {
      if (editingId) {
        await pb.collection('teacher').update(editingId, { name })
        toast.success('Teacher updated!')
      } else {
        await pb.collection('teacher').create({ name })
        toast.success('Teacher added!')
      }

      name = ''
      editingId = null
      showModal = false
      await loadTeachers()
    } catch (err) {
      console.error(err)
      toast.error('Error saving teacher')
    }
  }

  function openEdit(teacher) {
    name = teacher.name
    editingId = teacher.id
    showModal = true
  }

  async function deleteTeacher(id) {
    if (confirm('Are you sure you want to delete this teacher?')) {
      try {
        await pb.collection('teacher').delete(id)
        toast.success('Teacher deleted!')
        await loadTeachers()
      } catch (err) {
        console.error(err)
        toast.error('Failed to delete teacher')
      }
    }
  }

  function openAddModal() {
    name = ''
    editingId = null
    showModal = true
  }

  onMount(loadTeachers)
</script>

<div class="p-6 max-w-3xl mx-auto bg-base-100 shadow-lg rounded-xl">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Teacher Management</h2>
    <button class="btn btn-outline btn-primary" onclick={openAddModal}>Add Teacher</button>
  </div>

  <div id="table-wrapper" class="overflow-y-auto max-500px">
    <div id="teacherGrid"></div>
  </div>
</div>

<!-- Modal -->
{#if showModal}
  <dialog open class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{editingId ? 'Edit' : 'Add'} Teacher</h3>
      <input type="text" bind:value={name} placeholder="Teacher Name" class="input input-bordered w-full mb-4" />
      <div class="modal-action">
        <button class="btn btn-outline btn-primary" onclick={saveTeacher}>
          {editingId ? 'Update' : 'Save'}
        </button>
        <button class="btn btn-outline btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
      </div>
    </div>
  </dialog>
{/if}
