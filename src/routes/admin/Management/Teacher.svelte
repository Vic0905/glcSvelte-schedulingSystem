<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let name = ''
  let status = 'enabled'
  let editingId = null
  let showModal = false
  let showCSVModal = false
  let csvFile = null
  let csvPreview = []
  let isProcessing = false
  let grid
  let selectedTeachers = new Set()
  let showBulkActions = false

  const statusOptions = ['enabled', 'disabled']
  const statusColors = {
    enabled: 'badge-success',
    disabled: 'badge-error',
  }

  async function loadTeachers() {
    const records = await pb.collection('teacher').getFullList({
      sort: '-created',
    })

    const data = records.map((t) => [
      h('input', {
        type: 'checkbox',
        className: 'checkbox checkbox-neutral',
        checked: selectedTeachers.has(t.id),
        onChange: (e) => toggleTeacherSelection(t.id, e.target.checked),
      }),
      t.name,
      h('span', { className: `badge ${statusColors[t.status] || 'badge-neutral'}` }, t.status || 'enabled'),
      h('div', { className: 'flex gap-2 justify-center' }, [
        h(
          'button',
          {
            className: 'btn btn-ghost btn-sm btn-neutral',
            onClick: () => openEdit(t),
          },
          'Edit'
        ),
        h(
          'button',
          {
            className: 'btn btn-ghost btn-sm btn-neutral',
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
        columns: [
          { name: 'Select', width: '50px' },
          { name: 'Name', width: '150px' },
          { name: 'Status', width: '120px' },
          { name: 'Actions', width: '120px' },
        ],
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
        sort: true,
        search: {
          enabled: true,
          selector: (cell, rowIndex, cellIndex) => {
            if (typeof cell === 'string') return cell
            if (cell && cell.props && cell.props.children) {
              return cell.props.children
            }
            return ''
          },
        },
      }).render(document.getElementById('teacherGrid'))
    }

    showBulkActions = selectedTeachers.size > 0
  }

  async function saveTeacher() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    try {
      const payload = { name, status }

      if (editingId) {
        await pb.collection('teacher').update(editingId, payload)
        toast.success('Teacher updated successfully!')
      } else {
        await pb.collection('teacher').create(payload)
        toast.success('Teacher added successfully!')
      }

      name = ''
      status = 'enabled'
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
    status = teacher.status || 'enabled'
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
    status = 'enabled'
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

      const teachers = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const values = parseCSVLine(line)

        if (values.length >= 1) {
          teachers.push({
            name: values[0] || '',
            status: values[1] || 'enabled',
          })
        }
      }

      csvPreview = teachers.filter((t) => t.name.trim())
    }
    reader.readAsText(file)
  }

  function parseCSVLine(line) {
    const result = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())

    return result
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

      for (const teacher of csvPreview) {
        try {
          if (existingNames.includes(teacher.name.toLowerCase().trim())) {
            console.log(`Skipping duplicate: ${teacher.name}`)
            skippedCount++
            continue
          }

          await pb.collection('teacher').create(teacher)
          successCount++

          existingNames.push(teacher.name.toLowerCase().trim())
        } catch (err) {
          console.error(`Error adding ${teacher.name}:`, err)
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
    const csv = 'Name,Status\nJohn,enabled\nJane,disabled\nMike,enabled'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'teacher_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleTeacherSelection(id, checked) {
    if (checked) {
      selectedTeachers.add(id)
    } else {
      selectedTeachers.delete(id)
    }
    selectedTeachers = selectedTeachers
    showBulkActions = selectedTeachers.size > 0
  }

  function selectAll() {
    pb.collection('teacher')
      .getFullList()
      .then((records) => {
        selectedTeachers = new Set(records.map((r) => r.id))
        loadTeachers()
      })
  }

  function deselectAll() {
    selectedTeachers = new Set()
    loadTeachers()
  }

  async function bulkUpdateStatus(newStatus) {
    if (selectedTeachers.size === 0) {
      toast.error('No teachers selected')
      return
    }

    const statusLabel = newStatus.charAt(0).toUpperCase() + newStatus.slice(1)
    if (!confirm(`Are you sure you want to change ${selectedTeachers.size} teacher(s) to ${statusLabel}?`)) {
      return
    }

    isProcessing = true
    let successCount = 0
    let errorCount = 0

    try {
      for (const teacherId of selectedTeachers) {
        try {
          await pb.collection('teacher').update(teacherId, { status: newStatus })
          successCount++
        } catch (err) {
          console.error(`Error updating teacher ${teacherId}:`, err)
          errorCount++
        }
      }

      const message = `${successCount} teacher(s) updated to ${statusLabel}!${errorCount > 0 ? ` ${errorCount} failed.` : ''}`
      toast.success(message)

      selectedTeachers = new Set()
      showBulkActions = false
      await loadTeachers()
    } catch (err) {
      console.error(err)
      toast.error('Error updating teachers')
    } finally {
      isProcessing = false
    }
  }

  onMount(loadTeachers)
</script>

<div class="min-h-screen bg-base-200 py-8 px-4">
  <div class="max-w-7xl mx-auto">
    <!-- Header Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-2xl font-bold mb-2">Teacher Management</h1>
        </div>
        <div class="flex gap-3">
          <button class="btn btn-ghost gap-2" onclick={openCSVModal}>
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
          <button class="btn btn-ghost gap-2" onclick={openAddModal}>
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

    <!-- Bulk Actions Bar -->
    {#if showBulkActions}
      <div class="bg-base-100 shadow-lg rounded-xl p-4 mb-6 border-l-4 border-neutral">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div class="flex items-center gap-3">
            <div class="bg-neutral/10 p-2 rounded-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p class="font-semibold text-base-content">
                <strong>{selectedTeachers.size}</strong> teacher(s) selected
              </p>
              <p class="text-sm text-base-content/60">Choose an action to apply to all selected teachers</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm btn-ghost" onclick={selectAll}>Select All</button>
            <button class="btn btn-sm btn-ghost" onclick={deselectAll}>Clear</button>
            <div class="divider divider-horizontal"></div>
            <button class="btn btn-sm btn-ghost" onclick={() => bulkUpdateStatus('enabled')} disabled={isProcessing}>
              Mark as Enabled
            </button>
            <button class="btn btn-sm btn-ghost" onclick={() => bulkUpdateStatus('disabled')} disabled={isProcessing}>
              {isProcessing ? 'Processing...' : 'Mark as Disabled'}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Data Grid Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6">
      <div id="teacherGrid" class="overflow-x-auto"></div>
    </div>
  </div>
</div>

<!-- Add/Edit Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md p-0">
      <!-- Header -->
      <div class="p-6 pb-2">
        <h3 class="text-lg font-medium">
          {editingId ? 'Edit Teacher' : 'Add Teacher'}
        </h3>
      </div>

      <!-- Form -->
      <div class="p-6 space-y-4">
        <!-- Name Input -->
        <div>
          <div class="text-sm mb-1">
            Name <span class="opacity-50">(required)</span>
          </div>
          <input
            type="text"
            bind:value={name}
            class="w-full px-3 py-2 rounded border border-gray-300"
            placeholder="Enter name"
            required
          />
        </div>

        <!-- Status -->
        <div>
          <div class="text-sm mb-1">Status</div>
          <select bind:value={status} class="w-full px-3 py-2 rounded border border-gray-300">
            {#each statusOptions as option}
              <option value={option}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            {/each}
          </select>
        </div>
      </div>

      <!-- Actions -->
      <div class="p-6 pt-0">
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded btn btn-ghost" onclick={() => (showModal = false)}> Cancel </button>
          <button class="px-4 py-2 rounded btn btn-ghost" onclick={saveTeacher}>
            {editingId ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>

    <!-- Backdrop -->
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
        <div class="alert alert-neutral">
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
              <strong>Required:</strong> Name &nbsp;|&nbsp; <strong>Optional:</strong> Status (enabled/disabled)
            </div>
          </div>
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
              <span class="badge badge-neutral">{csvPreview.length} teachers found</span>
            </div>
            <div class="max-h-80 overflow-y-auto border rounded-lg bg-base-100">
              <table class="table table-sm table-pin-rows">
                <thead>
                  <tr class="bg-base-200">
                    <th class="font-semibold">Name</th>
                    <th class="font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each csvPreview as teacher}
                    <tr class="hover">
                      <td class="font-medium">{teacher.name}</td>
                      <td>
                        <span class={`badge badge-sm ${statusColors[teacher.status] || 'badge-neutral'}`}>
                          {teacher.status || 'enabled'}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" onclick={() => (showCSVModal = false)} disabled={isProcessing}> Cancel </button>
        <button class="btn btn-neutral" onclick={importCSV} disabled={csvPreview.length === 0 || isProcessing}>
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
