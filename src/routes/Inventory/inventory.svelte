<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let showModal = $state(false)
  let showEditModal = $state(false)
  let currentLogId = $state(null)
  let borrowerName = $state('')
  let item = $state('')
  let room = $state('')
  let status = $state('borrowed')
  let loading = $state(false)
  let gridInstance = null
  let gridContainer

  const openModal = () => {
    showModal = true
    borrowerName = ''
    item = ''
    room = ''
    status = 'borrowed'
  }

  const openEditModal = (logData) => {
    showEditModal = true
    currentLogId = logData.id
    borrowerName = logData.borrower_name
    item = logData.item
    room = logData.room || ''
    status = logData.status
  }

  const closeModal = () => {
    showModal = false
    showEditModal = false
    currentLogId = null
  }

  const loadData = async () => {
    try {
      const records = await pb.collection('inventory_logs').getFullList({
        sort: '-created',
      })

      const data = records.map((record) => [
        record.borrower_name,
        record.item,
        record.room || 'Not specified', // Display room or default text
        h(
          'span',
          {
            className:
              record.status === 'borrowed'
                ? 'px-2 py-1 text-xs font-semibold text-orange-800 bg-orange-200 rounded-full'
                : 'px-2 py-1 text-xs font-semibold text-green-800 bg-green-200 rounded-full',
          },
          record.status === 'borrowed' ? 'Borrowed' : 'Returned'
        ),
        new Date(record.created).toLocaleDateString(),
        h('div', { className: 'flex space-x-2' }, [
          h(
            'button',
            {
              className: 'text-xs btn bth-ghost rounded hover:bg-blue-400',
              onClick: () => toggleStatus(record.id, record.status),
            },
            record.status === 'borrowed' ? 'Mark Returned' : 'Mark Borrowed'
          ),
          h(
            'button',
            {
              className: 'text-xs btn bth-ghost rounded hover:bg-yellow-400',
              onClick: () => openEditModal(record),
            },
            'Edit'
          ),
          h(
            'button',
            {
              className: 'text-xs btn bth-ghost rounded hover:bg-red-400',
              onClick: () => deleteLog(record.id),
            },
            'Delete'
          ),
        ]),
      ])

      if (gridInstance) {
        gridInstance
          .updateConfig({
            data: data,
          })
          .forceRender()
      } else {
        gridInstance = new Grid({
          columns: [
            {
              name: 'Borrower Name',
              width: '180px',
              sort: true,
            },
            {
              name: 'Item',
              width: '150px',
              sort: false,
            },
            {
              name: 'Room',
              width: '120px',
              sort: false,
            },
            {
              name: 'Status',
              width: '100px',
              sort: false,
            },
            {
              name: 'Date',
              width: '100px',
              sort: false,
            },
            {
              name: 'Action',
              width: '250px',
              sort: false,
            },
          ],
          data: data,
          search: true,
          pagination: {
            limit: 10,
          },
          sort: false,
          className: {
            table: 'w-full border text-xs !border-collapse',
            th: 'bg-base-200 p-2 border-t border-d !border-x-0 text-center',
            td: 'border-t border-d !border-x-0 p-2 align-middle text-center',
          },
          style: {
            table: {
              'table-layout': 'fixed',
            },
          },
        })
        gridInstance.render(gridContainer)
      }
    } catch (error) {
      console.error('Error loading data:', error)
      alert('Error loading data: ' + error.message)
    }
  }

  const toggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'borrowed' ? 'returned' : 'borrowed'

    try {
      await pb.collection('inventory_logs').update(id, {
        status: newStatus,
        returned_date: newStatus === 'returned' ? new Date().toISOString() : null,
      })
      await loadData()
    } catch (error) {
      alert('Error updating status: ' + error.message)
    }
  }

  const deleteLog = async (id) => {
    if (!confirm('Are you sure you want to delete this log?')) {
      return
    }

    try {
      await pb.collection('inventory_logs').delete(id)
      await loadData()
      toast.success('Log deleted successfully!')
    } catch (error) {
      alert('Error deleting log: ' + error.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!borrowerName.trim() || !item.trim()) {
      alert('Please fill in all fields')
      return
    }

    loading = true

    try {
      await pb.collection('inventory_logs').create({
        borrower_name: borrowerName,
        item: item,
        room: room,
        status: 'borrowed',
        borrowed_date: new Date().toISOString(),
      })

      await loadData()
      closeModal()
      toast.success('Log added successfully!')
    } catch (error) {
      alert('Error adding log: ' + error.message)
    } finally {
      loading = false
    }
  }

  const handleEdit = async (e) => {
    e.preventDefault()

    if (!borrowerName.trim() || !item.trim()) {
      toast.error('Please fill in all fields')
      return
    }

    loading = true

    try {
      await pb.collection('inventory_logs').update(currentLogId, {
        borrower_name: borrowerName,
        item: item,
        room: room,
        status: status,
        ...(status === 'returned' && {
          returned_date: new Date().toISOString(),
        }),
      })

      await loadData()
      closeModal()
      toast.success('Log updated successfully!')
    } catch (error) {
      alert('Error updating log: ' + error.message)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    loadData()
  })
</script>

<div class="container mx-auto px-4 py-8">
  <div class="mb-6">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold">Inventory Log System</h1>
      <button onclick={openModal} class="text-xs btn bth-ghost rounded hover:bg-blue-400"> Add New Log </button>
    </div>

    <div class="bg-white rounded-lg shadow-md p-6">
      <div bind:this={gridContainer}></div>
    </div>
  </div>

  {#if showModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4 text-xs">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold text-gray-800">Add Inventory Log</h2>
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button onclick={closeModal} class="text-gray-500 hover:text-gray-700">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form onsubmit={handleSubmit}>
          <div class="mb-4">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Borrower Name </label>
            <input
              type="text"
              bind:value={borrowerName}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter borrower name"
              required
            />
          </div>

          <div class="mb-4">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Item/Asset </label>
            <input
              type="text"
              bind:value={item}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter item name"
              required
            />
          </div>

          <div class="mb-4">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Room/Location </label>
            <input
              type="text"
              bind:value={room}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter room/location"
            />
          </div>

          <div class="flex justify-end space-x-3">
            <button
              type="button"
              onclick={closeModal}
              class="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              class:opacity-50={loading}
              class:cursor-not-allowed={loading}
              disabled={loading}
            >
              {loading ? 'Adding...' : 'Add Log'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  {#if showEditModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4 text-xs">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold text-gray-800">Edit Inventory Log</h2>
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button onclick={closeModal} class="text-gray-500 hover:text-gray-700">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form onsubmit={handleEdit}>
          <div class="mb-4">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Borrower Name </label>
            <input
              type="text"
              bind:value={borrowerName}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter borrower name"
              required
            />
          </div>

          <div class="mb-4">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Item/Asset </label>
            <input
              type="text"
              bind:value={item}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter item name"
              required
            />
          </div>

          <div class="mb-4">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Room/Location </label>
            <input
              type="text"
              bind:value={room}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter room/location"
            />
          </div>

          <div class="mb-6">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="block text-gray-700 text-sm font-bold mb-2"> Status </label>
            <select
              bind:value={status}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="borrowed">Borrowed</option>
              <option value="returned">Returned</option>
            </select>
          </div>

          <div class="flex justify-end space-x-3">
            <button
              type="button"
              onclick={closeModal}
              class="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              class:opacity-50={loading}
              class:cursor-not-allowed={loading}
              disabled={loading}
            >
              {loading ? 'Updating...' : 'Update Log'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>
