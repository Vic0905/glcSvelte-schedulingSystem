<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

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
        toast.success('Teacher updated successfully!')
      } else {
        await pb.collection('teacher').create({ name })
        toast.success('Teacher added successfully!')
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
        toast.success('Teacher deleted successfully!')
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

      const teachers = lines
        .slice(1)
        .map((line) => {
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
      const existingTeachers = await pb.collection('teacher').getFullList()
      const existingNames = existingTeachers.map((t) => t.name.toLowerCase().trim())

      for (const teacherName of csvPreview) {
        try {
          if (existingNames.includes(teacherName.toLowerCase().trim())) {
            console.log(`Skipping duplicate: ${teacherName}`)
            skippedCount++
            continue
          }

          await pb.collection('teacher').create({ name: teacherName })
          successCount++

          existingNames.push(teacherName.toLowerCase().trim())
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

<div class="min-h-screen bg-base-200 py-8 px-4">
  <div class="max-w-7xl mx-auto">
    <!-- Header Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-3xl font-bold text-primary mb-2">Teacher Management</h1>
        </div>
        <div class="flex gap-3">
          <button class="btn btn-secondary gap-2" onclick={openCSVModal}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            Import CSV
          </button>
          <button class="btn btn-primary gap-2" onclick={openAddModal}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Teacher
          </button>
        </div>
      </div>
    </div>

    <!-- Data Grid Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6">
      <div id="teacherGrid" class="overflow-x-auto"></div>
    </div>
  </div>
</div>

<!-- Add/Edit Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-lg">
      <h3 class="font-bold text-2xl mb-6 text-base-content">{editingId ? 'Edit Teacher' : 'Add New Teacher'}</h3>

      <div class="space-y-6">
        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Teacher Information</h4>
          <div class="form-control">
            <label class="label">
              <span class="label-text font-medium">Full Name <span class="text-error">*</span></span>
            </label>
            <input type="text" bind:value={name} class="input input-bordered w-full" required />
            <label class="label">
              <span class="label-text-alt text-base-content/60">This name will appear in all > </span></label
            >
          </div>
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveTeacher}>
          {editingId ? 'Update Teacher' : 'Add Teacher'}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" onclick={() => (showModal = false)}></div>
  </div>
{/if}

<!-- CSV Import Modal -->
{#if showCSVModal}
  <dialog open class="modal">
    <div class="modal-box max-w-3xl">
      <h3 class="font-bold text-2xl mb-6 text-base-content">Import Teachers from CSV</h3>

      <div class="space-y-6">
        <!-- Instructions -->
        <div class="alert alert-info">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <div>
            <div class="font-semibold">CSV Format Requirements</div>
            <div class="text-sm">
              Upload a CSV file with teacher names. The first row should be a header (e.g., "Name").
            </div>
          </div>
        </div>

        <div class="alert">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info shrink-0 w-6 h-6">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <span class="text-sm">Duplicate names (case-insensitive) will be automatically skipped during import.</span>
        </div>

        <div class="flex items-center gap-4">
          <button class="btn btn-outline btn-sm gap-2" onclick={downloadTemplate}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Download Template
          </button>
        </div>

        <!-- File Upload -->
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text font-medium">Select CSV File</span>
          </label>
          <input type="file" accept=".csv" onchange={handleFileSelect} class="file-input file-input-bordered w-full" />
        </div>

        <!-- Preview -->
        {#if csvPreview.length > 0}
          <div class="bg-base-200 p-4 rounded-lg">
            <div class="flex items-center justify-between mb-3">
              <h4 class="font-semibold text-base-content">Preview</h4>
              <span class="badge badge-primary">{csvPreview.length} teachers found</span>
            </div>
            <div class="max-h-80 overflow-y-auto border rounded-lg bg-base-100 p-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                {#each csvPreview as teacher}
                  <div class="flex items-center gap-2 p-2 rounded hover:bg-base-200 transition-colors">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5 text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <span class="text-sm font-medium">{teacher}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" onclick={() => (showCSVModal = false)} disabled={isProcessing}> Cancel </button>
        <button class="btn btn-primary" onclick={importCSV} disabled={csvPreview.length === 0 || isProcessing}>
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
            Importing...
          {:else}
            Import {csvPreview.length} Teachers
          {/if}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" onclick={() => !isProcessing && (showCSVModal = false)}></div>
  </dialog>
{/if}
