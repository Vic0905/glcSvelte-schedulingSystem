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
        columns: ['Select', 'Name', 'English Name', 'Course', 'Level', 'Status', 'Actions'],
        data,
        className: {
          table: 'w-full text-xs',
          th: 'bg-slate-100 p-2 border text-center',
          td: 'p-2 border align-middle text-center',
        },
        pagination: false,
        sort: true,
        search: {
          enabled: true,
          selector: (cell, rowIndex, cellIndex) => {
            // This makes search use the actual text for each cell
            if (typeof cell === 'string') return cell
            if (cell && cell.props && cell.props.children) {
              return cell.props.children // e.g., "new", "old", "graduated"
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
      status = 'new'
      editingId = null
      showModal = false
      await loadStudent()
    } catch (err) {
      console.error(err)
      toast.error('Error saving Student')
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

      // Skip header row and parse student data
      const students = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        // Parse CSV line (handles quoted fields)
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

      // Only require English Name to be filled
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
      // Get all existing students
      const existingStudents = await pb.collection('student').getFullList()
      const existingEnglishNames = existingStudents
        .map((s) => (s.englishName ? s.englishName.toLowerCase().trim() : ''))
        .filter((name) => name)

      for (const student of csvPreview) {
        try {
          // Check if English Name already exists (case-insensitive)
          if (student.englishName && existingEnglishNames.includes(student.englishName.toLowerCase().trim())) {
            console.log(`Skipping duplicate English Name: ${student.englishName}`)
            skippedCount++
            continue
          }

          await pb.collection('student').create(student)
          successCount++

          // Add to existing list to prevent duplicates within the same import
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

<div class="p-6 max-w-7xl mx-auto bg-base-100 shadow-lg rounded-xl mt-10">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Student Management</h2>
    <div class="flex gap-2">
      <button class="btn btn-outline btn-secondary" onclick={openCSVModal}> Import CSV </button>
      <button class="btn btn-outline btn-primary" onclick={openAddModal}> Add Student </button>
    </div>
  </div>

  {#if showBulkActions}
    <div class="mb-2 flex justify-between items-center">
      <div class="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path></svg
        >
        <span><strong>{selectedStudents.size}</strong> student(s) selected</span>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-outline" onclick={selectAll}>Select All</button>
        <button class="btn btn-sm btn-outline" onclick={deselectAll}>Deselect All</button>
        <button class="btn btn-sm btn-success" onclick={() => bulkUpdateStatus('new')} disabled={isProcessing}>
          Mark as New
        </button>
        <button class="btn btn-sm btn-info" onclick={() => bulkUpdateStatus('old')} disabled={isProcessing}>
          Mark as Old
        </button>
        <button class="btn btn-sm btn-warning" onclick={() => bulkUpdateStatus('graduated')} disabled={isProcessing}>
          {isProcessing ? 'Processing...' : 'Mark as Graduated'}
        </button>
      </div>
    </div>
  {/if}

  <div id="studentGrid" class="overflow-x-auto"></div>
</div>

<!-- Add/Edit Modal -->
{#if showModal}
  <div class="modal modal-open modal-middle">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{editingId ? 'Edit' : 'Add'} Student</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Name (Optional)</legend>
            <input type="text" bind:value={name} placeholder="Name" class="input input-bordered w-full mb-2" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Course</legend>
            <input type="text" bind:value={course} placeholder="Course" class="input input-bordered w-full mb-2" />
          </fieldset>
        </div>

        <div class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">English Name <span class="text-error">*</span></legend>
            <input
              type="text"
              bind:value={englishName}
              placeholder="English Name (Required)"
              class="input input-bordered w-full mb-2"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Level</legend>
            <input type="text" bind:value={level} placeholder="Level" class="input input-bordered w-full mb-4" />
          </fieldset>
        </div>
      </div>

      <div class="space-y-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Status</legend>
          <select bind:value={status} class="select select-bordered w-full">
            {#each statusOptions as option}
              <option value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>
            {/each}
          </select>
        </fieldset>
      </div>

      <div class="modal-action">
        <button class="btn btn-outline btn-primary" onclick={saveStudent}>
          {editingId ? 'Update' : 'Save'}
        </button>
        <button class="btn btn-outline btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<!-- CSV Import Modal -->
{#if showCSVModal}
  <dialog open class="modal modal-open">
    <div class="modal-box max-w-3xl">
      <h3 class="font-bold text-lg mb-4">Import Students from CSV</h3>

      <div class="mb-4">
        <p class="text-sm text-gray-600 mb-2">
          Upload a CSV file with student data. <strong>Required: English Name.</strong> Optional: Name, Course, Level, Status
          (new/old/graduated)
        </p>
        <div class="alert alert-info text-xs mb-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-5 h-5"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path></svg
          >
          <span>Duplicates are checked by <strong>English Name</strong> only. Same regular names are allowed.</span>
        </div>
        <button class="btn btn-sm btn-link" onclick={downloadTemplate}> Download Template </button>
      </div>

      <input type="file" accept=".csv" onchange={handleFileSelect} class="file-input file-input-bordered w-full mb-4" />

      {#if csvPreview.length > 0}
        <div class="mb-4">
          <h4 class="font-semibold mb-2">Preview ({csvPreview.length} students):</h4>
          <div class="max-h-60 overflow-y-auto border rounded p-2 bg-base-200">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>English Name</th>
                  <th>Name</th>
                  <th>Course</th>
                  <th>Level</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {#each csvPreview as student}
                  <tr>
                    <td><strong>{student.englishName}</strong></td>
                    <td>{student.name || '-'}</td>
                    <td>{student.course || '-'}</td>
                    <td>{student.level || '-'}</td>
                    <td
                      ><span class={`badge ${statusColors[student.status] || 'badge-neutral'}`}
                        >{student.status || 'new'}</span
                      ></td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}

      <div class="modal-action">
        <button
          class="btn btn-outline btn-primary"
          onclick={importCSV}
          disabled={csvPreview.length === 0 || isProcessing}
        >
          {isProcessing ? 'Importing...' : `Import ${csvPreview.length} Students`}
        </button>
        <button class="btn btn-outline btn-ghost" onclick={() => (showCSVModal = false)} disabled={isProcessing}>
          Cancel
        </button>
      </div>
    </div>
  </dialog>
{/if}
