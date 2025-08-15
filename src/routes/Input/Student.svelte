<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../lib/Pocketbase.svelte'

  let name = ''
  let englishName = ''
  let course = ''
  let level = ''
  let editingId = null
  let showModal = false
  let grid

  async function loadStudent() {
    const records = await pb.collection('student').getFullList({
      sort: '-created',
    })

    const data = records.map((t) => [
      t.name,
      t.englishName,
      t.course,
      t.level,
      h('div', { className: 'flex gap-2' }, [
        h(
          'button',
          {
            className: 'btn btn-sm btn-accent',
            onClick: () => openEdit(t),
          },
          'Edit'
        ),
        h(
          'button',
          {
            className: 'btn btn-sm btn-error',
            onClick: () => deleteStudent(t.id),
          },
          'Delete'
        ),
      ]),
    ])

    if (grid) {
      grid.updateConfig({ data }).forceRender()
    } else {
      grid = new Grid({
        columns: ['Name', 'English Name', 'Course', 'Level', 'Actions'],
        data,
        className: {
          table: 'w-full text-sm',
          th: 'bg-slate-100 p-2 border text-center',
          td: 'p-2 border align-top text-center',
        },
        pagination: {
          enabled: true,
          limit: 10,
        },
        search: true,
        sort: true,
      }).render(document.getElementById('studentGrid'))
    }
  }

  async function saveStudent() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    try {
      const payload = { name, englishName, course, level }

      if (editingId) {
        await pb.collection('student').update(editingId, payload)
        toast.success('Student updated!')
      } else {
        await pb.collection('student').create(payload)
        toast.success('Student added!')
      }

      // Clear form
      name = ''
      englishName = ''
      course = ''
      level = ''
      editingId = null
      showModal = false
      await loadStudent()
    } catch (err) {
      console.error(err)
      toast.error('Error saving Student')
    }
  }

  function openEdit(student) {
    name = student.name
    englishName = student.englishName || ''
    course = student.course || ''
    level = student.level || ''
    editingId = student.id
    showModal = true
  }

  async function deleteStudent(id) {
    if (confirm('Are you sure you want to delete this student?')) {
      try {
        await pb.collection('student').delete(id)
        toast.success('Student deleted!')
        await loadStudent()
      } catch (err) {
        console.error(err)
        toast.error('Failed to delete Student')
      }
    }
  }

  function openAddModal() {
    name = ''
    englishName = ''
    course = ''
    level = ''
    editingId = null
    showModal = true
  }

  onMount(loadStudent)
</script>

<div class="p-6 max-w-5xl mx-auto bg-base-100 shadow-lg rounded-xl mt-10">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Student Management</h2>
    <button class="btn btn-primary" onclick={openAddModal}>Add Student</button>
  </div>

  <div id="studentGrid" class="overflow-x-auto"></div>
</div>

<!-- Modal -->
{#if showModal}
  <div class="modal modal-open modal-middle">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{editingId ? 'Edit' : 'Add'} Student</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Name</legend>
            <input type="text" bind:value={name} placeholder="Name" class="input input-bordered w-full mb-2" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Couse</legend>
            <input type="text" bind:value={course} placeholder="Course" class="input input-bordered w-full mb-2" />
          </fieldset>
        </div>

        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">English Name</legend>
            <input
              type="text"
              bind:value={englishName}
              placeholder="English Name"
              class="input input-bordered w-full mb-2"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Level</legend>
            <input type="text" bind:value={level} placeholder="Level" class="input input-bordered w-full mb-4" />
          </fieldset>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn btn-primary" onclick={saveStudent}>
          {editingId ? 'Update' : 'Save'}
        </button>
        <button class="btn" onclick={() => (showModal = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
