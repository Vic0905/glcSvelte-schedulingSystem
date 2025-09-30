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
  let rooms = [] // Store all rooms to check teacher assignments
  let grouprooms = [] // Store all grouprooms

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

  // Load grouprooms for teacher assignment checking
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

  // Function to check if a teacher is already assigned to another room
  function isTeacherAssigned(teacherId) {
    if (!teacherId) return false

    // If we're editing, exclude the current room from the check
    const roomsToCheck = editingId ? rooms.filter((room) => room.id !== editingId) : rooms

    return roomsToCheck.some((room) => room.teacher === teacherId)
  }

  async function loadRoom() {
    try {
      const records = await pb.collection('room').getFullList({
        sort: '-created',
        expand: 'teacher', // This will expand the teacher relation
      })

      // Store rooms for teacher assignment checking
      rooms = records

      const data = records.map((t) => [
        t.name,
        t.expand?.teacher?.name || 'No teacher assigned',
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
      ])

      if (grid) {
        grid.updateConfig({ data }).forceRender()
      } else {
        grid = new Grid({
          columns: ['Room Name', 'Assigned Teacher', 'Actions'],
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
        teacher: selectedTeacherId || null, // If no teacher selected, set to null
      }

      if (editingId) {
        await pb.collection('room').update(editingId, roomData)
        toast.success('Room updated!')
      } else {
        await pb.collection('room').create(roomData)
        toast.success('Room added!')
      }

      name = ''
      selectedTeacherId = ''
      editingId = null
      showModal = false
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
        toast.success('Room deleted!')
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

<div class="p-6 max-w-4xl mx-auto bg-base-100 shadow-lg rounded-xl mt-10">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Room Management</h2>
    <button class="btn btn-outline btn-primary" onclick={openAddModal}>Add Room</button>
  </div>

  <div id="roomGrid" class="overflow-x-auto"></div>
</div>

<!-- Add/Edit Room Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{editingId ? 'Edit' : 'Add'} Room</h3>

      <div class="form-control mb-4">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label">
          <span class="label-text">Room Name</span>
        </label>
        <input type="text" bind:value={name} placeholder="Enter room name" class="input input-bordered w-full" />
      </div>

      <div class="form-control mb-4">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label">
          <span class="label-text">Assign Teacher</span>
        </label>
        <select bind:value={selectedTeacherId} class="select select-bordered w-full">
          <option value="">-- No teacher assigned --</option>
          {#each teachers as teacher}
            {@const assignedToOtherRoom = rooms.find((room) => room.teacher === teacher.id && room.id !== editingId)}
            {@const assignedToGrouproom = grouprooms.find((grouproom) => grouproom.teacher === teacher.id)}
            {@const isAssigned = assignedToOtherRoom || assignedToGrouproom}
            <option
              value={teacher.id}
              disabled={isAssigned}
              class={isAssigned ? 'text-gray-400 cursor-not-allowed' : ''}
            >
              {teacher.name}
              {#if assignedToOtherRoom}
                (Already assigned to room: {assignedToOtherRoom.name})
              {:else if assignedToGrouproom}
                (Already assigned to grouproom: {assignedToGrouproom.name})
              {/if}
            </option>
          {/each}
        </select>
        {#if selectedTeacherId && isTeacherAssigned(selectedTeacherId)}
          {@const assignedRoom = rooms.find((room) => room.teacher === selectedTeacherId && room.id !== editingId)}
          {@const assignedGrouproom = grouprooms.find((grouproom) => grouproom.teacher === selectedTeacherId)}
          <div class="label">
            <span class="label-text-alt text-warning">
              ⚠️ This teacher is already assigned to
              {#if assignedRoom}
                room: {assignedRoom.name}
              {:else if assignedGrouproom}
                grouproom: {assignedGrouproom.name}
              {:else}
                another room/grouproom
              {/if}
            </span>
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn btn-outline btn-primary" onclick={saveRoom}>
          {editingId ? 'Update' : 'Save'}
        </button>
        <button class="btn btn-outline btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
