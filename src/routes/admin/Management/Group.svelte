<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let name = ''
  let selectedTeacherId = ''
  let maxStudents = 30
  let editingId = null
  let showModal = false
  let grid
  let teachers = []
  let groupRooms = []
  let rooms = []

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

  async function loadRooms() {
    try {
      const records = await pb.collection('room').getFullList({
        sort: 'name',
        expand: 'teacher',
      })
      rooms = records
    } catch (err) {
      console.error('Error loading rooms:', err)
      toast.error('Failed to load rooms')
    }
  }

  function isTeacherAssigned(teacherId) {
    if (!teacherId) return false
    const groupRoomsToCheck = editingId ? groupRooms.filter((room) => room.id !== editingId) : groupRooms
    const assignedToGrouproom = groupRoomsToCheck.some((room) => room.teacher === teacherId)
    const assignedToRoom = rooms.some((room) => room.teacher === teacherId)
    return assignedToGrouproom || assignedToRoom
  }

  async function loadGroupRoom() {
    try {
      const records = await pb.collection('grouproom').getFullList({
        sort: '-created',
        expand: 'teacher',
      })

      groupRooms = records

      const data = records.map((t) => [
        t.name,
        t.expand?.teacher?.name || 'No teacher assigned',
        t.maxstudents || 'Not set',
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
              onClick: () => deleteGroupRoom(t.id),
            },
            'Delete'
          ),
        ]),
      ])

      if (grid) {
        grid.updateConfig({ data }).forceRender()
      } else {
        grid = new Grid({
          columns: ['Group Room Name', 'Assigned Teacher', 'Max Students', 'Actions'],
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
        }).render(document.getElementById('groupRoomGrid'))
      }
    } catch (err) {
      console.error('Error loading group rooms:', err)
      toast.error('Failed to load group rooms')
    }
  }

  async function saveGroupRoom() {
    if (!name.trim()) {
      toast.error('Group room name is required')
      return
    }

    if (maxStudents && (maxStudents < 1 || maxStudents > 200)) {
      toast.error('Max students must be between 1 and 200')
      return
    }

    try {
      const groupRoomData = {
        name: name.trim(),
        teacher: selectedTeacherId || null,
        maxstudents: maxStudents || null,
      }

      if (editingId) {
        await pb.collection('grouproom').update(editingId, groupRoomData)
        toast.success('Group room updated successfully!')
      } else {
        await pb.collection('grouproom').create(groupRoomData)
        toast.success('Group room added successfully!')
      }

      name = ''
      selectedTeacherId = ''
      maxStudents = 30
      editingId = null
      showModal = false
      await loadGroupRoom()
    } catch (err) {
      console.error('Error saving group room:', err)
      toast.error('Error saving group room')
    }
  }

  function openEdit(groupRoom) {
    name = groupRoom.name
    selectedTeacherId = groupRoom.teacher || ''
    maxStudents = groupRoom.maxstudents || 30
    editingId = groupRoom.id
    showModal = true
  }

  async function deleteGroupRoom(id) {
    if (confirm('Are you sure you want to delete this group room?')) {
      try {
        await pb.collection('grouproom').delete(id)
        toast.success('Group room deleted successfully!')
        await loadGroupRoom()
      } catch (err) {
        console.error('Error deleting group room:', err)
        toast.error('Failed to delete group room')
      }
    }
  }

  function openAddModal() {
    name = ''
    selectedTeacherId = ''
    maxStudents = 30
    editingId = null
    showModal = true
  }

  onMount(async () => {
    await loadTeachers()
    await loadRooms()
    await loadGroupRoom()
  })
</script>

<div class="min-h-screen bg-base-200 py-8 px-4">
  <div class="max-w-7xl mx-auto">
    <!-- Header Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-2xl font-bold mb-2">GRP Room Management</h1>
        </div>
        <div class="flex gap-3">
          <button class="btn btn-ghost gap-2" onclick={openAddModal}> Add GRP Room </button>
        </div>
      </div>
    </div>

    <!-- Data Grid Section -->
    <div class="bg-base-100 shadow-xl rounded-2xl p-6">
      <div id="groupRoomGrid" class="overflow-x-auto"></div>
    </div>
  </div>
</div>

<!-- Add/Edit Group Room Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-2xl mb-6 text-base-content">{editingId ? 'Edit Group Room' : 'Add New Group Room'}</h3>

      <div class="space-y-6">
        <!-- Room Information -->
        <div class="p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Room Information</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Group Room Name <span class="text-error">*</span></span>
              </label>
              <input type="text" bind:value={name} class="input input-bordered w-full" required />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Maximum Students</span>
              </label>
              <input
                type="number"
                bind:value={maxStudents}
                placeholder="Enter max students"
                class="input input-bordered w-full"
                min="1"
                max="200"
              />
            </div>
          </div>
        </div>

        <!-- Teacher Assignment -->
        <div class="p-4 rounded-lg">
          <h4 class="font-semibold text-sm text-base-content/70 mb-3 uppercase tracking-wide">Teacher Assignment</h4>
          <div class="form-control">
            <label class="label">
              <span class="label-text font-medium">Assigned Teacher</span>
            </label>
            <select bind:value={selectedTeacherId} class="select select-bordered w-full">
              <option value="">-- No teacher assigned --</option>
              {#each teachers as teacher}
                {@const assignedToOtherGrouproom = groupRooms.find(
                  (room) => room.teacher === teacher.id && room.id !== editingId
                )}
                {@const assignedToRoom = rooms.find((room) => room.teacher === teacher.id)}
                {@const isAssigned = assignedToOtherGrouproom || assignedToRoom}
                <option
                  value={teacher.id}
                  disabled={isAssigned}
                  class={isAssigned ? 'text-gray-400 cursor-not-allowed' : ''}
                >
                  {teacher.name}
                  {#if assignedToOtherGrouproom}
                    (Already in grouproom: {assignedToOtherGrouproom.name})
                  {:else if assignedToRoom}
                    (Already in room: {assignedToRoom.name})
                  {/if}
                </option>
              {/each}
            </select>
          </div>

          {#if selectedTeacherId && isTeacherAssigned(selectedTeacherId)}
            {@const assignedGrouproom = groupRooms.find(
              (room) => room.teacher === selectedTeacherId && room.id !== editingId
            )}
            {@const assignedRoom = rooms.find((room) => room.teacher === selectedTeacherId)}
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
                  {#if assignedGrouproom}
                    grouproom <strong>{assignedGrouproom.name}</strong>
                  {:else if assignedRoom}
                    room <strong>{assignedRoom.name}</strong>
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
        <button class="btn btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
        <button class="btn btn-ghost" onclick={saveGroupRoom}>
          {editingId ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" onclick={() => (showModal = false)}></div>
  </div>
{/if}
