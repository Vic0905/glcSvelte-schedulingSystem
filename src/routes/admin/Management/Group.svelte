<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let name = ''
  let selectedTeacherId = ''
  let maxStudents = 30 // Default max students
  let editingId = null
  let showModal = false
  let grid
  let teachers = []
  let groupRooms = [] // Store all group rooms to check teacher assignments
  let rooms = [] // Store all regular rooms for cross-collection checking

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

  // Load regular rooms for cross-collection checking
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

  // Function to check if a teacher is already assigned to another room or grouproom
  function isTeacherAssigned(teacherId) {
    if (!teacherId) return false

    // If we're editing, exclude the current group room from the check
    const groupRoomsToCheck = editingId ? groupRooms.filter((room) => room.id !== editingId) : groupRooms

    // Check if teacher is assigned to any grouproom
    const assignedToGrouproom = groupRoomsToCheck.some((room) => room.teacher === teacherId)

    // Check if teacher is assigned to any regular room
    const assignedToRoom = rooms.some((room) => room.teacher === teacherId)

    return assignedToGrouproom || assignedToRoom
  }

  async function loadGroupRoom() {
    try {
      const records = await pb.collection('grouproom').getFullList({
        sort: '-created',
        expand: 'teacher', // This will expand the teacher relation
      })

      // Store group rooms for teacher assignment checking
      groupRooms = records

      const data = records.map((t) => [
        t.name,
        t.expand?.teacher?.name || 'No teacher assigned',
        t.maxstudents || 'Not set', // Display max students
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
              className: 'btn btn-outline btn-sm btn-error ',
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
            th: 'bg-slate-100 p-2 border text-center',
            td: 'p-2 border align-middle text-center',
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
        teacher: selectedTeacherId || null, // If no teacher selected, set to null
        maxstudents: maxStudents || null, // Add max students field
      }

      if (editingId) {
        await pb.collection('grouproom').update(editingId, groupRoomData)
        toast.success('Group room updated!')
      } else {
        await pb.collection('grouproom').create(groupRoomData)
        toast.success('Group room added!')
      }

      name = ''
      selectedTeacherId = ''
      maxStudents = 30 // Reset to default
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
    maxStudents = groupRoom.maxstudents || 30 // Load existing max students or default
    editingId = groupRoom.id
    showModal = true
  }

  async function deleteGroupRoom(id) {
    if (confirm('Are you sure you want to delete this group room?')) {
      try {
        await pb.collection('grouproom').delete(id)
        toast.success('Group room deleted!')
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
    maxStudents = 30 // Default value
    editingId = null
    showModal = true
  }

  onMount(async () => {
    await loadTeachers()
    await loadRooms()
    await loadGroupRoom()
  })
</script>

<div class="p-6 max-w-7xl mx-auto bg-base-100 shadow-lg rounded-xl mt-10">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold text-primary">Group Room Management</h2>
    <button class="btn btn-outline btn-primary" onclick={openAddModal}>Add Room</button>
  </div>

  <div id="groupRoomGrid" class="overflow-x-auto"></div>
</div>

<!-- Add/Edit Group Room Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{editingId ? 'Edit' : 'Add'} Group Room</h3>

      <div class="form-control mb-4">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label">
          <span class="label-text">Group Room Name</span>
        </label>
        <input type="text" bind:value={name} placeholder="Enter group room name" class="input input-bordered w-full" />
      </div>

      <div class="form-control mb-4">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label">
          <span class="label-text">Maximum Students</span>
        </label>
        <input
          type="number"
          bind:value={maxStudents}
          placeholder="Enter maximum number of students"
          class="input input-bordered w-full"
          min="1"
          max="200"
        />
      </div>

      <div class="form-control mb-4">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label">
          <span class="label-text">Assign Teacher</span>
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
                (Already assigned to grouproom: {assignedToOtherGrouproom.name})
              {:else if assignedToRoom}
                (Already assigned to room: {assignedToRoom.name})
              {/if}
            </option>
          {/each}
        </select>
        {#if selectedTeacherId && isTeacherAssigned(selectedTeacherId)}
          {@const assignedGrouproom = groupRooms.find(
            (room) => room.teacher === selectedTeacherId && room.id !== editingId
          )}
          {@const assignedRoom = rooms.find((room) => room.teacher === selectedTeacherId)}
          <div class="label">
            <span class="label-text-alt text-warning">
              ⚠️ This teacher is already assigned to
              {#if assignedGrouproom}
                grouproom: {assignedGrouproom.name}
              {:else if assignedRoom}
                room: {assignedRoom.name}
              {:else}
                another room/grouproom
              {/if}
            </span>
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn btn-outline btn-primary" onclick={saveGroupRoom}>
          {editingId ? 'Update' : 'Save'}
        </button>
        <button class="btn btn-outline btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}
