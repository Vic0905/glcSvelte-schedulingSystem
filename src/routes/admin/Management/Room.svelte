<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let name = ''
  let selectedTeacherId = ''
  let editingId = null
  let showModal = false
  let showCSVModal = false
  let grid
  let teachers = []
  let rooms = []
  let grouprooms = []
  let csvFile = null
  let isImporting = false

  async function loadTeachers() {
    try {
      const records = await pb.collection('teacher').getFullList({
        sort: 'name',
      })
      teachers = records
    } catch (err) {
      console.error('Error loading teachers:', err)
      toast.error('Failed to load teachers')
    }
  }

  async function loadGrouprooms() {
    try {
      const records = await pb.collection('grouproom').getFullList({
        sort: 'name',
        expand: 'teacher',
      })
      grouprooms = records
    } catch (err) {
      console.error('Error loading grouprooms:', err)
      toast.error('Failed to load grouprooms')
    }
  }

  // Simplified function to check if teacher is occupied
  function checkTeacherOccupancy(teacherId) {
    if (!teacherId) return null

    // Check if teacher is assigned to another room (excluding current room being edited)
    const roomAssignment = rooms.find((room) => room.teacher === teacherId && room.id !== editingId)

    // Check if teacher is assigned to a grouproom
    const grouproomAssignment = grouprooms.find((grouproom) => grouproom.teacher === teacherId)

    if (roomAssignment) {
      return { type: 'room', name: roomAssignment.name }
    }

    if (grouproomAssignment) {
      return { type: 'grouproom', name: grouproomAssignment.name }
    }

    return null
  }

  async function loadRoom() {
    try {
      const records = await pb.collection('room').getFullList({
        sort: '-created',
        expand: 'teacher',
      })

      rooms = records

      // Ensure we always have valid data structure
      const data = records.map((t) => {
        const teacherName = t.expand?.teacher?.name || 'No teacher assigned'
        return [
          t.name || '',
          teacherName,
          h('div', { className: 'flex gap-2 justify-center' }, [
            h(
              'button',
              {
                className: 'btn btn-ghost btn-sm btn-success',
                onClick: () => openEdit(t),
              },
              'Edit'
            ),
            h(
              'button',
              {
                className: 'btn btn-ghost btn-sm btn-error',
                onClick: () => deleteRoom(t.id),
              },
              'Delete'
            ),
          ]),
        ]
      })

      if (grid) {
        grid.updateConfig({ data }).forceRender()
      } else {
        grid = new Grid({
          columns: [
            { name: 'Room', width: '50px' },
            { name: 'Assigned Teacher', width: '150px' },
            { name: 'Actions', width: '150px' },
          ],
          data,
          className: {
            table: 'w-full text-xs',
            th: 'bg-base-200 p-3 border text-center font-semibold',
            td: 'p-3 border align-middle text-center',
          },
          pagination: {
            enabled: true,
            limit: 50,
          },
          search: true,
          sort: true,
        }).render(document.getElementById('roomGrid'))
      }
    } catch (err) {
      console.error('Error loading rooms:', err)
      toast.error('Failed to load rooms')
    }
  }

  async function saveRoom() {
    if (!name.trim()) {
      toast.error('Room name is required')
      return
    }

    // Check if teacher is occupied
    if (selectedTeacherId) {
      const occupancy = checkTeacherOccupancy(selectedTeacherId)
      if (occupancy) {
        const assignment = occupancy.type === 'room' ? 'room' : 'grouproom'
        toast.error(`Teacher is already assigned to ${assignment}: ${occupancy.name}`)
        return
      }
    }

    try {
      const roomData = {
        name: name.trim(),
        teacher: selectedTeacherId || null,
      }

      if (editingId) {
        await pb.collection('room').update(editingId, roomData)
        toast.success('Room updated successfully!')
      } else {
        await pb.collection('room').create(roomData)
        toast.success('Room added successfully!')
      }

      name = ''
      selectedTeacherId = ''
      editingId = null
      showModal = false

      // Small delay to ensure PocketBase expand is ready
      await new Promise((resolve) => setTimeout(resolve, 100))
      await loadRoom()
    } catch (err) {
      console.error('Error saving room:', err)
      toast.error('Error saving room')
    }
  }

  function openEdit(room) {
    name = room.name
    selectedTeacherId = room.teacher || ''
    editingId = room.id
    showModal = true
  }

  async function deleteRoom(id) {
    if (confirm('Are you sure you want to delete this room?')) {
      try {
        await pb.collection('room').delete(id)
        toast.success('Room deleted successfully!')
        await new Promise((resolve) => setTimeout(resolve, 100))
        await loadRoom()
      } catch (err) {
        console.error('Error deleting room:', err)
        toast.error('Failed to delete room')
      }
    }
  }

  function openAddModal() {
    name = ''
    selectedTeacherId = ''
    editingId = null
    showModal = true
  }

  // CSV Functions
  function downloadTemplate() {
    const template = `Room Name
A001
A002
A003
A004
A005
B01
B02
B03
B04
B05
ST01
ST02
ST03
ST04
ST05`

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'rooms_template.csv'
    link.click()
  }

  function handleFileSelect(event) {
    const file = event.target.files[0]
    if (file) {
      csvFile = file
    }
  }

  async function importCSV() {
    if (!csvFile) {
      toast.error('Please select a CSV file first')
      return
    }

    isImporting = true

    try {
      const text = await csvFile.text()
      const lines = text.split('\n')

      // Get existing room names for duplicate checking
      const existingRooms = await pb.collection('room').getFullList()
      const existingRoomNames = new Set(existingRooms.map((room) => room.name.toLowerCase()))

      let importedCount = 0
      let skippedCount = 0

      // Process each line (skip header if exists)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()

        // Skip empty lines and possible header
        if (!line || line.toLowerCase().includes('room')) continue

        const roomName = line.trim()

        // Skip if room already exists
        if (existingRoomNames.has(roomName.toLowerCase())) {
          skippedCount++
          continue
        }

        try {
          // Create new room without teacher
          await pb.collection('room').create({
            name: roomName,
            teacher: null,
          })
          importedCount++
        } catch (err) {
          console.error(`Error creating room "${roomName}":`, err)
        }
      }

      // Reload the rooms list
      await loadRoom()

      if (importedCount === 0 && skippedCount === 0) {
        toast.info('No valid rooms found in CSV file')
      } else {
        let message = `Imported ${importedCount} new room(s)`
        if (skippedCount > 0) {
          message += `, skipped ${skippedCount} duplicate(s)`
        }
        toast.success(message)
      }

      // Close modal and reset
      showCSVModal = false
      csvFile = null
    } catch (err) {
      console.error('Error importing CSV:', err)
      toast.error('Failed to import rooms from CSV')
    } finally {
      isImporting = false
    }
  }

  onMount(async () => {
    await loadTeachers()
    await loadGrouprooms()
    await loadRoom()
  })
</script>

<div class="min-h-screen bg-base-200 py-8 px-4">
  <div class="max-w-7xl mx-auto">
    <!-- Header Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-2xl font-bold mb-2">Room Management</h1>
        </div>
        <div class="flex gap-3">
          <button class="btn btn-outline gap-2" on:click={() => (showCSVModal = true)}> Import CSV </button>
          <button class="btn btn-neutral gap-2" on:click={openAddModal}> Add Room </button>
        </div>
      </div>
    </div>

    <!-- Data Grid Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6">
      <div id="roomGrid" class="overflow-x-auto"></div>
    </div>
  </div>
</div>

<!-- Add/Edit Room Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-1xl">
      <h3 class="font-bold text-2xl mb-6 text-base-content">{editingId ? 'Edit Room' : 'Add Room'}</h3>

      <div class="space-y-6">
        <!-- Room Information -->

        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text font-medium">Room Name <span class="text-error">*</span></span>
          </label>
          <input type="text" bind:value={name} class="input input-bordered w-full" required />
        </div>

        <div class="form-control mt-3">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text font-medium">Assigned Teacher</span>
          </label>
          <select bind:value={selectedTeacherId} class="select select-bordered w-full">
            <option value="">-- No teacher assigned --</option>
            {#each teachers as teacher}
              <option value={teacher.id}>
                {teacher.name}
              </option>
            {/each}
          </select>
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" on:click={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-neutral" on:click={saveRoom}>
          {editingId ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" on:click={() => (showModal = false)}></div>
  </div>
{/if}

<!-- CSV Import Modal -->
{#if showCSVModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-2xl mb-6 text-base-content">Import Rooms from CSV</h3>

      <div class="space-y-6">
        <!-- Instructions -->
        <div class="alert alert-info">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <div class="font-semibold">Simple CSV Format</div>
            <div class="text-sm">One room name per line. Duplicates in database will be skipped.</div>
          </div>
        </div>

        <!-- Template Download -->
        <div class="flex justify-start">
          <button class="btn btn-outline btn-sm gap-2" on:click={downloadTemplate}>
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
          <input
            type="file"
            accept=".csv"
            on:change={handleFileSelect}
            class="file-input file-input-bordered w-full"
            disabled={isImporting}
          />
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" on:click={() => !isImporting && (showCSVModal = false)} disabled={isImporting}>
          Cancel
        </button>
        <button class="btn btn-neutral" on:click={importCSV} disabled={!csvFile || isImporting}>
          {#if isImporting}
            <span class="loading loading-spinner loading-sm"></span>
            Importing...
          {:else}
            Import Rooms
          {/if}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" on:click={() => !isImporting && (showCSVModal = false)}></div>
  </div>
{/if}
