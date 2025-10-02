<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let name = ''
  let editingId = null
  let showModal = false
  let showCSVModal = false
  let csvFile = null
  let csvPreview = []
  let isProcessing = false
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
          table: 'w-full text-sm',
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

  function openCSVModal() {
    csvFile = null
    csvPreview = []
    showCSVModal = true
  }

  function handleFileSelect(event) {
    const file = event.target.files[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file')
      return
    }

    csvFile = file
    parseCSVPreview(file)
  }

  function parseCSVPreview(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const lines = text.split('\n').filter((line) => line.trim())

      // Skip header row and parse names
      const teachers = lines
        .slice(1)
        .map((line) => {
          // Handle quoted fields and commas
          const match = line.match(/^"?([^",]+)"?/)
          return match ? match[1].trim() : line.split(',')[0].trim()
        })
        .filter((name) => name.length > 0)

      csvPreview = teachers
    }
    reader.readAsText(file)
  }

  async function importCSV() {
    if (csvPreview.length === 0) {
      toast.error('No valid teachers found in CSV')
      return
    }

    isProcessing = true
    let successCount = 0
    let skippedCount = 0
    let errorCount = 0

    try {
      // Get all existing teachers
      const existingTeachers = await pb.collection('teacher').getFullList()
      const existingNames = existingTeachers.map((t) => t.name.toLowerCase().trim())

      for (const teacherName of csvPreview) {
        try {
          // Check if teacher already exists (case-insensitive)
          if (existingNames.includes(teacherName.toLowerCase().trim())) {
            console.log(`Skipping duplicate: ${teacherName}`)
            skippedCount++
            continue
          }

          await pb.collection('teacher').create({ name: teacherName })
          successCount++
        } catch (err) {
          console.error(`Error adding ${teacherName}:`, err)
          errorCount++
        }
      }

      const message = `Added ${successCount} teachers!${skippedCount > 0 ? ` Skipped ${skippedCount} duplicates.` : ''}${errorCount > 0 ? ` ${errorCount} failed.` : ''}`
      toast.success(message)

      showCSVModal = false
      csvFile = null
      csvPreview = []
      await loadTeachers()
    } catch (err) {
      console.error(err)
      toast.error('Error importing CSV')
    } finally {
      isProcessing = false
    }
  }

  function downloadTemplate() {
    const csv = 'Name\nJohn Doe\nJane Smith\nMike Johnson'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'teacher_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  onMount(loadTeachers)
</script>

<div class="p-6 max-w-3xl mx-auto bg-base-100 shadow-lg rounded-xl">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Teacher Management</h2>
    <div class="flex gap-2">
      <button class="btn btn-outline btn-secondary" onclick={openCSVModal}> Import CSV </button>
      <button class="btn btn-outline btn-primary" onclick={openAddModal}> Add Teacher </button>
    </div>
  </div>

  <div id="table-wrapper" class="overflow-y-auto max-500px">
    <div id="teacherGrid"></div>
  </div>
</div>

<!-- Add/Edit Modal -->
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

<!-- CSV Import Modal -->
{#if showCSVModal}
  <dialog open class="modal modal-open">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">Import Teachers from CSV</h3>

      <div class="mb-4">
        <p class="text-sm text-gray-600 mb-2">
          Upload a CSV file with teacher names. The first row should be a header.
        </p>
        <button class="btn btn-sm btn-link" onclick={downloadTemplate}> Download Template </button>
      </div>

      <input type="file" accept=".csv" onchange={handleFileSelect} class="file-input file-input-bordered w-full mb-4" />

      {#if csvPreview.length > 0}
        <div class="mb-4">
          <h4 class="font-semibold mb-2">Preview ({csvPreview.length} teachers):</h4>
          <div class="max-h-60 overflow-y-auto border rounded p-2 bg-base-200">
            <ul class="list-disc list-inside">
              {#each csvPreview as teacher}
                <li class="text-sm">{teacher}</li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}

      <div class="modal-action">
        <button
          class="btn btn-outline btn-primary"
          onclick={importCSV}
          disabled={csvPreview.length === 0 || isProcessing}
        >
          {isProcessing ? 'Importing...' : `Import ${csvPreview.length} Teachers`}
        </button>
        <button class="btn btn-outline btn-ghost" onclick={() => (showCSVModal = false)} disabled={isProcessing}>
          Cancel
        </button>
      </div>
    </div>
  </dialog>
{/if}
