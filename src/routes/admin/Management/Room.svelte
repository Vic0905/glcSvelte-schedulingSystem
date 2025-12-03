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
  let grid
  let teachers = []
  let rooms = []
  let grouprooms = []

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

  function isTeacherAssigned(teacherId) {
    if (!teacherId) return false
    const roomsToCheck = editingId ? rooms.filter((room) => room.id !== editingId) : rooms
    return roomsToCheck.some((room) => room.teacher === teacherId)
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
                className: 'btn btn-outline btn-sm btn-accent',
                onClick: () => openEdit(t),
              },
              'Edit'
            ),
            h(
              'button',
              {
                className: 'btn btn-outline btn-sm btn-error',
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
          columns: ['Room Name', 'Assigned Teacher', 'Actions'],
          data,
          className: {
            table: 'w-full text-xs',
            th: 'bg-base-200 p-3 border text-center font-semibold',
            td: 'p-3 border align-middle text-center',
          },
          pagination: {
            enabled: true,
            limit: 150,
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
          <h1 class="text-3xl font-bold text-primary mb-2">Room Management</h1>
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
            Add Room
          </button>
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
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-2xl mb-6 text-base-content">{editingId ? 'Edit Room' : 'Add New Room'}</h3>

      <div class="space-y-6">
        <!-- Room Information -->
        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Room Information</h4>
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text font-medium">Room Name <span class="text-error">*</span></span>
            </label>
            <input type="text" bind:value={name} class="input input-bordered w-full" required />
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text-alt text-base-content/60">Unique identifier for this classroom</span>
            </label>
          </div>
        </div>

        <!-- Teacher Assignment -->
        <div class="bg-base-200 p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Teacher Assignment</h4>
          <div class="form-control">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text font-medium">Assigned Teacher</span>
            </label>
            <select bind:value={selectedTeacherId} class="select select-bordered w-full">
              <option value="">-- No teacher assigned --</option>
              {#each teachers as teacher}
                {@const assignedToOtherRoom = rooms.find(
                  (room) => room.teacher === teacher.id && room.id !== editingId
                )}
                {@const assignedToGrouproom = grouprooms.find((grouproom) => grouproom.teacher === teacher.id)}
                {@const isAssigned = assignedToOtherRoom || assignedToGrouproom}
                <option
                  value={teacher.id}
                  disabled={isAssigned}
                  class={isAssigned ? 'text-gray-400 cursor-not-allowed' : ''}
                >
                  {teacher.name}
                  {#if assignedToOtherRoom}
                    (Already in room: {assignedToOtherRoom.name})
                  {:else if assignedToGrouproom}
                    (Already in grouproom: {assignedToGrouproom.name})
                  {/if}
                </option>
              {/each}
            </select>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="label">
              <span class="label-text-alt text-base-content/60"
                >Teachers can only be assigned to one room or grouproom</span
              >
            </label>
          </div>

          {#if selectedTeacherId && isTeacherAssigned(selectedTeacherId)}
            {@const assignedRoom = rooms.find((room) => room.teacher === selectedTeacherId && room.id !== editingId)}
            {@const assignedGrouproom = grouprooms.find((grouproom) => grouproom.teacher === selectedTeacherId)}
            <div class="alert alert-warning mt-4">
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
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <div class="font-semibold">Teacher Already Assigned</div>
                <div class="text-sm">
                  This teacher is currently assigned to
                  {#if assignedRoom}
                    <strong>{assignedRoom.name}</strong>
                  {:else if assignedGrouproom}
                    grouproom <strong>{assignedGrouproom.name}</strong>
                  {:else}
                    another location
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="modal-action mt-8">
        <button class="btn btn-ghost" on:click={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-primary" on:click={saveRoom}>
          {editingId ? 'Update Room' : 'Add Room'}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" on:click={() => (showModal = false)}></div>
  </div>
{/if}
