<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let name = ''
  let englishName = ''
  let course = ''
  let level = ''
  let status = 'new'
  let editingId = null
  let showModal = false
  let showCSVModal = false
  let csvFile = null
  let csvPreview = []
  let isProcessing = false
  let grid
  let selectedStudents = new Set()
  let showBulkActions = false

  const statusOptions = ['new', 'old', 'graduated']
  const statusColors = {
    new: 'badge-success',
    old: 'badge-info',
    graduated: 'badge-warning',
  }

  async function loadStudent() {
    const records = await pb.collection('student').getFullList({
      sort: '-created',
    })

    const data = records.map((t) => [
      h('input', {
        type: 'checkbox',
        className: 'checkbox checkbox-primary',
        checked: selectedStudents.has(t.id),
        onChange: (e) => toggleStudentSelection(t.id, e.target.checked),
      }),
      t.name || '-',
      t.englishName,
      t.course,
      t.level,
      h('span', { className: `badge ${statusColors[t.status] || 'badge-neutral'}` }, t.status || 'new'),
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
        columns: [
          { name: 'Select', width: '120px' },
          { name: 'Name', width: '150px' },
          { name: 'Engish Name', width: '150px' },
          { name: 'Course', width: '120px' },
          { name: 'Level', width: '120px' },
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
      }).render(document.getElementById('studentGrid'))
    }

    showBulkActions = selectedStudents.size > 0
  }

  async function saveStudent() {
    if (!englishName.trim()) {
      toast.error('English Name is required')
      return
    }

    try {
      const payload = { name, englishName, course, level, status }

      if (editingId) {
        await pb.collection('student').update(editingId, payload)
        toast.success('Student updated successfully!')
      } else {
        await pb.collection('student').create(payload)
        toast.success('Student added successfully!')
      }

      name = ''
      englishName = ''
      course = ''
      level = ''
      status = 'new'
      editingId = null
      showModal = false
      await loadStudent()
    } catch (err) {
      console.error(err)
      toast.error('Error saving student')
    }
  }

  function openEdit(student) {
    name = student.name || ''
    englishName = student.englishName || ''
    course = student.course || ''
    level = student.level || ''
    status = student.status || 'new'
    editingId = student.id
    showModal = true
  }

  async function deleteStudent(id) {
    if (confirm('Are you sure you want to delete this student?')) {
      try {
        await pb.collection('student').delete(id)
        toast.success('Student deleted successfully!')
        await loadStudent()
      } catch (err) {
        console.error(err)
        toast.error('Failed to delete student')
      }
    }
  }

  function openAddModal() {
    name = ''
    englishName = ''
    course = ''
    level = ''
    status = 'new'
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

      const students = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const values = parseCSVLine(line)

        if (values.length >= 1) {
          students.push({
            englishName: values[0] || '',
            name: values[1] || '',
            course: values[2] || '',
            level: values[3] || '',
            status: values[4] || 'new',
          })
        }
      }

      csvPreview = students.filter((s) => s.englishName.trim())
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
      toast.error('No valid students found in CSV')
      return
    }

    isProcessing = true
    let successCount = 0
    let skippedCount = 0
    let errorCount = 0

    try {
      const existingStudents = await pb.collection('student').getFullList()
      const existingEnglishNames = existingStudents
        .map((s) => (s.englishName ? s.englishName.toLowerCase().trim() : ''))
        .filter((name) => name)

      for (const student of csvPreview) {
        try {
          if (student.englishName && existingEnglishNames.includes(student.englishName.toLowerCase().trim())) {
            console.log(`Skipping duplicate English Name: ${student.englishName}`)
            skippedCount++
            continue
          }

          await pb.collection('student').create(student)
          successCount++

          if (student.englishName) {
            existingEnglishNames.push(student.englishName.toLowerCase().trim())
          }
        } catch (err) {
          console.error(`Error adding ${student.englishName}:`, err)
          errorCount++
        }
      }

      const message = `Added ${successCount} students!${skippedCount > 0 ? ` Skipped ${skippedCount} duplicates.` : ''}${errorCount > 0 ? ` ${errorCount} failed.` : ''}`
      toast.success(message)

      showCSVModal = false
      csvFile = null
      csvPreview = []
      await loadStudent()
    } catch (err) {
      console.error(err)
      toast.error('Error importing CSV')
    } finally {
      isProcessing = false
    }
  }

  function downloadTemplate() {
    const csv =
      'English Name,Name,Course,Level,Status\nJuan Dela Cruz,John,BSIT,1,new\nMary Smith,Mary,BSCS,2,old\nPedro Reyes,Peter,BSED,3,graduated'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'student_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleStudentSelection(id, checked) {
    if (checked) {
      selectedStudents.add(id)
    } else {
      selectedStudents.delete(id)
    }
    selectedStudents = selectedStudents
    showBulkActions = selectedStudents.size > 0
  }

  function selectAll() {
    pb.collection('student')
      .getFullList()
      .then((records) => {
        selectedStudents = new Set(records.map((r) => r.id))
        loadStudent()
      })
  }

  function deselectAll() {
    selectedStudents = new Set()
    loadStudent()
  }

  async function bulkUpdateStatus(newStatus) {
    if (selectedStudents.size === 0) {
      toast.error('No students selected')
      return
    }

    const statusLabel = newStatus.charAt(0).toUpperCase() + newStatus.slice(1)
    if (!confirm(`Are you sure you want to change ${selectedStudents.size} student(s) to ${statusLabel}?`)) {
      return
    }

    isProcessing = true
    let successCount = 0
    let errorCount = 0

    try {
      for (const studentId of selectedStudents) {
        try {
          await pb.collection('student').update(studentId, { status: newStatus })
          successCount++
        } catch (err) {
          console.error(`Error updating student ${studentId}:`, err)
          errorCount++
        }
      }

      const message = `${successCount} student(s) updated to ${statusLabel}!${errorCount > 0 ? ` ${errorCount} failed.` : ''}`
      toast.success(message)

      selectedStudents = new Set()
      showBulkActions = false
      await loadStudent()
    } catch (err) {
      console.error(err)
      toast.error('Error updating students')
    } finally {
      isProcessing = false
    }
  }

  onMount(loadStudent)
</script>

<div class="min-h-screen bg-base-200 py-8 px-4">
  <div class="max-w-7xl mx-auto">
    <!-- Header Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-3xl font-bold text-primary mb-2">Student Management</h1>
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
            Add Student
          </button>
        </div>
      </div>
    </div>

    <!-- Bulk Actions Bar -->
    {#if showBulkActions}
      <div class="bg-base-100 shadow-lg rounded-xl p-4 mb-6 border-l-4 border-primary">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div class="flex items-center gap-3">
            <div class="bg-primary/10 p-2 rounded-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-primary"
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
                <strong>{selectedStudents.size}</strong> student(s) selected
              </p>
              <p class="text-sm text-base-content/60">Choose an action to apply to all selected students</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm btn-ghost" onclick={selectAll}>Select All</button>
            <button class="btn btn-sm btn-ghost" onclick={deselectAll}>Clear</button>
            <div class="divider divider-horizontal"></div>
            <button class="btn btn-sm btn-success" onclick={() => bulkUpdateStatus('new')} disabled={isProcessing}>
              Mark as New
            </button>
            <button class="btn btn-sm btn-info" onclick={() => bulkUpdateStatus('old')} disabled={isProcessing}>
              Mark as Old
            </button>
            <button
              class="btn btn-sm btn-warning"
              onclick={() => bulkUpdateStatus('graduated')}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Mark as Graduated'}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Data Grid Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6">
      <div id="studentGrid" class="overflow-x-auto"></div>
    </div>
  </div>
</div>

<!-- Add/Edit Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-2xl mb-6 text-base-content">{editingId ? 'Edit Student' : 'Add New Student'}</h3>

      <div class="space-y-6">
        <!-- Primary Information -->
        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Primary Information</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">English Name <span class="text-error">*</span></span>
              </label>
              <input type="text" bind:value={englishName} class="input input-bordered w-full" required />
            </div>
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Name (Optional)</span>
              </label>
              <input type="text" bind:value={name} class="input input-bordered w-full" />
            </div>
          </div>
        </div>

        <!-- Academic Information -->
        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Academic Information</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Course</span>
              </label>
              <input type="text" bind:value={course} class="input input-bordered w-full" />
            </div>
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Level</span>
              </label>
              <input type="text" bind:value={level} class="input input-bordered w-full" />
            </div>
          </div>
        </div>

        <!-- Status -->
        <div class="form-control">
          <label class="label">
            <span class="label-text font-medium">Status</span>
          </label>
          <select bind:value={status} class="select select-bordered w-full">
            {#each statusOptions as option}
              <option value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveStudent}>
          {editingId ? 'Update Student' : 'Add Student'}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" onclick={() => (showModal = false)}></div>
  </div>
{/if}

<!-- CSV Import Modal -->
{#if showCSVModal}
  <dialog open class="modal">
    <div class="modal-box max-w-4xl">
      <h3 class="font-bold text-2xl mb-6 text-base-content">Import Students from CSV</h3>

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
              <strong>Required:</strong> English Name &nbsp;|&nbsp; <strong>Optional:</strong> Name, Course, Level, Status
              (new/old/graduated)
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
          <span class="text-sm"
            >Duplicates are checked by <strong>English Name</strong> only. Duplicate English Names will be skipped.</span
          >
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
              <span class="badge badge-primary">{csvPreview.length} students found</span>
            </div>
            <div class="max-h-80 overflow-y-auto border rounded-lg bg-base-100">
              <table class="table table-sm table-pin-rows">
                <thead>
                  <tr class="bg-base-200">
                    <th class="font-semibold">English Name</th>
                    <th class="font-semibold">Name</th>
                    <th class="font-semibold">Course</th>
                    <th class="font-semibold">Level</th>
                    <th class="font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each csvPreview as student}
                    <tr class="hover">
                      <td class="font-medium">{student.englishName}</td>
                      <td>{student.name || '-'}</td>
                      <td>{student.course || '-'}</td>
                      <td>{student.level || '-'}</td>
                      <td>
                        <span class={`badge badge-sm ${statusColors[student.status] || 'badge-neutral'}`}>
                          {student.status || 'new'}
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
        <button class="btn btn-primary" onclick={importCSV} disabled={csvPreview.length === 0 || isProcessing}>
          {#if isProcessing}
            <span class="loading loading-spinner loading-sm"></span>
            Importing...
          {:else}
            Import {csvPreview.length} Students
          {/if}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" onclick={() => !isProcessing && (showCSVModal = false)}></div>
  </dialog>
{/if}
