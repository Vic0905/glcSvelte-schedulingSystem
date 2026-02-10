<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let showModal = $state(false)
  let showEditModal = $state(false)
  let showItemModal = $state(false)
  let currentLogId = $state(null)
  let borrowerName = $state('')
  let item = $state('')
  let room = $state('')
  let status = $state('borrowed')
  let loading = $state(false)
  let gridInstance = null
  let gridContainer

  // For item management
  let itemName = $state('')
  let itemQuantity = $state(1)
  let itemDescription = $state('')
  let items = $state([])
  let activeLogsCount = $state(0)

  // For item availability summary
  let itemSummary = $state([])

  // Status options for dropdown
  const statusOptions = [
    { value: 'borrowed', label: 'Borrowed' },
    { value: 'reserved', label: 'Reserved' },
    { value: 'returned', label: 'Returned' },
  ]

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

  const openItemModal = () => {
    showItemModal = true
    itemName = ''
    itemQuantity = 1
  }

  const closeModal = () => {
    showModal = false
    showEditModal = false
    showItemModal = false
    currentLogId = null
  }

  // Load items
  const loadItems = async () => {
    try {
      const records = await pb.collection('items').getFullList({
        sort: 'name',
      })
      items = records

      // Calculate item summary after loading items
      calculateItemSummary()
    } catch (error) {
      console.error('Error loading items:', error)
    }
  }

  // Calculate item availability summary
  const calculateItemSummary = async () => {
    try {
      // Get all active logs (borrowed or reserved)
      const activeLogs = await pb.collection('inventory_logs').getFullList({
        filter: 'status = "borrowed" || status = "reserved"',
      })

      // Count borrowed/reserved items by item name
      const borrowedCounts = {}
      activeLogs.forEach((log) => {
        const itemName = log.item.toUpperCase()
        borrowedCounts[itemName] = (borrowedCounts[itemName] || 0) + 1
      })

      // Calculate availability for each item
      const summary = items.map((item) => {
        const itemNameUpper = item.name.toUpperCase()
        const totalQuantity = item.quantity
        const borrowedQuantity = borrowedCounts[itemNameUpper] || 0
        const availableQuantity = totalQuantity - borrowedQuantity

        return {
          id: item.id,
          name: item.name,
          total: totalQuantity,
          borrowed: borrowedQuantity,
          available: availableQuantity > 0 ? availableQuantity : 0,
          lowStock: availableQuantity <= 2 && availableQuantity > 0,
          outOfStock: availableQuantity <= 0,
        }
      })

      itemSummary = summary
    } catch (error) {
      console.error('Error calculating item summary:', error)
      itemSummary = []
    }
  }

  // Get available count for an item
  const getAvailableCount = (itemName) => {
    const itemNameUpper = itemName.toUpperCase()
    const summaryItem = itemSummary.find((i) => i.name.toUpperCase() === itemNameUpper)
    return summaryItem ? summaryItem.available : 0
  }

  // Count active logs (borrowed or reserved)
  const countActiveLogs = async () => {
    try {
      const borrowed = await pb.collection('inventory_logs').getFullList({
        filter: 'status = "borrowed"',
      })

      const reserved = await pb.collection('inventory_logs').getFullList({
        filter: 'status = "reserved"',
      })

      activeLogsCount = borrowed.length + reserved.length
    } catch (error) {
      console.error('Error counting active logs:', error)
    }
  }

  const loadData = async () => {
    try {
      const records = await pb.collection('inventory_logs').getFullList({
        sort: '-created',
      })

      const data = records.map((record) => [
        record.borrower_name,
        record.item,
        record.room || 'Not specified',
        h(
          'span',
          {
            className:
              record.status === 'borrowed'
                ? 'px-2 py-1 text-xs font-semibold text-orange-800 bg-orange-200 rounded-full'
                : record.status === 'reserved'
                  ? 'px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-200 rounded-full'
                  : 'px-2 py-1 text-xs font-semibold text-green-800 bg-green-200 rounded-full',
          },
          record.status === 'borrowed' ? 'Borrowed' : record.status === 'reserved' ? 'Reserved' : 'Returned'
        ),
        new Date(record.created).toLocaleDateString(),
        h('div', { className: 'flex space-x-2' }, [
          h(
            'button',
            {
              className: 'text-xs btn bth-ghost rounded hover:bg-blue-400',
              onClick: () => toggleStatus(record.id, record.status),
            },
            getToggleButtonText(record.status)
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

  const getToggleButtonText = (currentStatus) => {
    switch (currentStatus) {
      case 'borrowed':
        return 'Mark Returned'
      case 'reserved':
        return 'Mark Borrowed'
      case 'returned':
        return 'Mark Borrowed'
      default:
        return 'Toggle Status'
    }
  }

  const toggleStatus = async (id, currentStatus) => {
    const statusTransitions = {
      borrowed: 'returned',
      reserved: 'borrowed',
      returned: 'borrowed',
    }

    const newStatus = statusTransitions[currentStatus] || 'borrowed'

    try {
      const updateData = {
        status: newStatus,
      }

      if (newStatus === 'returned') {
        updateData.returned_date = new Date().toISOString()
      }

      await pb.collection('inventory_logs').update(id, updateData)
      await loadData()
      await countActiveLogs()
      await calculateItemSummary()
      toast.success('Status updated successfully!')
    } catch (error) {
      toast.error('Error updating status: ' + error.message)
    }
  }

  const deleteLog = async (id) => {
    if (!confirm('Are you sure you want to delete this log?')) {
      return
    }

    try {
      await pb.collection('inventory_logs').delete(id)
      await loadData()
      await countActiveLogs()
      await calculateItemSummary()
      toast.success('Log deleted successfully!')
    } catch (error) {
      toast.error('Error deleting log: ' + error.message)
    }
  }

  // Add item
  const handleAddItem = async (e) => {
    e.preventDefault()

    if (!itemName.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    loading = true

    try {
      await pb.collection('items').create({
        name: itemName.trim(),
        quantity: parseInt(itemQuantity),
      })

      await loadItems()
      closeModal()
      toast.success('Item added successfully!')
    } catch (error) {
      toast.error('Error adding item: ' + error.message)
    } finally {
      loading = false
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!borrowerName.trim() || !item.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    // Check if selected item is available
    const availableCount = getAvailableCount(item)
    if (availableCount <= 0) {
      toast.error('This item is out of stock. Please select another item.')
      return
    }

    loading = true

    try {
      const createData = {
        borrower_name: borrowerName.toUpperCase().trim(),
        item: item.toUpperCase().trim(),
        room: room.toUpperCase().trim(),
        status: status,
        borrowed_date: new Date().toISOString(),
      }

      if (status === 'returned') {
        createData.returned_date = new Date().toISOString()
      }

      await pb.collection('inventory_logs').create(createData)

      await loadData()
      await countActiveLogs()
      await calculateItemSummary()
      closeModal()
      toast.success('Log added successfully!')
    } catch (error) {
      toast.error('Error adding log: ' + error.message)
    } finally {
      loading = false
    }
  }

  const handleEdit = async (e) => {
    e.preventDefault()

    if (!borrowerName.trim() || !item.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    // Check if selected item is available (except for the current log's item)
    const currentLog = await pb.collection('inventory_logs').getOne(currentLogId)
    const isSameItem = currentLog.item.toUpperCase() === item.toUpperCase()

    if (!isSameItem) {
      const availableCount = getAvailableCount(item)
      if (availableCount <= 0) {
        toast.error('This item is out of stock. Please select another item.')
        return
      }
    }

    loading = true

    try {
      const updateData = {
        borrower_name: borrowerName.toUpperCase().trim(),
        item: item.toUpperCase().trim(),
        room: room.toUpperCase().trim(),
        status: status,
      }

      if (status === 'returned') {
        updateData.returned_date = new Date().toISOString()
      }

      await pb.collection('inventory_logs').update(currentLogId, updateData)

      await loadData()
      await countActiveLogs()
      await calculateItemSummary()
      closeModal()
      toast.success('Log updated successfully!')
    } catch (error) {
      toast.error('Error updating log: ' + error.message)
    } finally {
      loading = false
    }
  }

  // Initialize everything
  const initializeData = async () => {
    await Promise.all([loadData(), loadItems(), countActiveLogs()])
  }

  onMount(() => {
    initializeData()
  })
</script>

<div class="container mx-auto px-4 py-8">
  <div class="max-w-8xl mx-auto">
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <h1 class="text-2xl font-bold">Inventory Log System</h1>
        <div class="flex space-x-2">
          <button onclick={openItemModal} class="text-xs btn bth-ghost rounded"> Add Item </button>
          <button onclick={openModal} class="text-xs btn bth-ghost rounded"> Add New Log </button>
        </div>
      </div>

      <!-- Compact Item Summary Table -->
      <div class="mb-6">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-bold text-gray-700 text-xs">Item Availability</h3>
          <span class="text-xs text-gray-500">
            {itemSummary.filter((i) => i.outOfStock).length} out of stock
          </span>
        </div>

        <div class="bg-white rounded-lg shadow border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Item
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Total
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Borrowed
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Available
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                {#each itemSummary as item}
                  <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-xs font-medium text-gray-900 truncate max-w-[180px]" title={item.name}>
                      {item.name}
                    </td>
                    <td class="px-3 py-2 text-xs text-gray-900 text-center align-middle">
                      {item.total}
                    </td>
                    <td class="px-3 py-2 text-xs text-orange-600 text-center align-middle">
                      {item.borrowed}
                    </td>
                    <td class="px-3 py-2 text-xs text-center align-middle">
                      <span
                        class:font-bold={item.available > 0}
                        class:text-green-600={item.available > 0}
                        class:text-red-600={item.available <= 0}
                      >
                        {item.available}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-center align-middle">
                      {#if item.outOfStock}
                        <span class="px-2 py-1 inline-block text-xs font-semibold bg-red-100 text-red-800 rounded-full">
                          Out
                        </span>
                      {:else if item.lowStock}
                        <span
                          class="px-2 py-1 inline-block text-xs font-semibold bg-yellow-100 text-yellow-800 rounded-full"
                        >
                          Low
                        </span>
                      {:else}
                        <span
                          class="px-2 py-1 inline-block text-xs font-semibold bg-green-100 text-green-800 rounded-full"
                        >
                          OK
                        </span>
                      {/if}
                    </td>
                  </tr>
                {:else}
                  <tr>
                    <td colspan="5" class="px-3 py-4 text-center text-sm text-gray-500">
                      No items added yet. Click "Add Item" to get started.
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-lg shadow-md p-6">
      <div bind:this={gridContainer}></div>
    </div>
  </div>

  <!-- Add Log Modal -->
  {#if showModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4 text-xs">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold text-gray-800">Add Inventory Log</h2>
        </div>

        <form onsubmit={handleSubmit}>
          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Borrower Name *</label>
            <input
              type="text"
              bind:value={borrowerName}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter borrower name"
              required
            />
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Item *</label>
            <select
              bind:value={item}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Item</option>
              {#each items as itm}
                {#if getAvailableCount(itm.name) > 0}
                  <option value={itm.name}>
                    {itm.name} (Available: {getAvailableCount(itm.name)})
                  </option>
                {:else}
                  <option value={itm.name} disabled class="text-gray-400">
                    {itm.name} (Available: 0) - Out of stock
                  </option>
                {/if}
              {/each}
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Room/Location</label>
            <input
              type="text"
              bind:value={room}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter room/location"
            />
          </div>

          <div class="mb-6">
            <label class="block text-gray-700 text-sm font-bold mb-2">Status</label>
            <select
              bind:value={status}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {#each statusOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>

          <div class="flex justify-end space-x-3">
            <button type="button" onclick={closeModal} class="btn btn-ghost text-xs"> Cancel </button>
            <button
              type="submit"
              class="btn btn-ghost text-xs"
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

  <!-- Add Item Modal (Simplified - No Category) -->
  {#if showItemModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4 text-xs">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold text-gray-800">Add New Item</h2>
        </div>

        <form onsubmit={handleAddItem}>
          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Item Name *</label>
            <input
              type="text"
              bind:value={itemName}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Laptop, Chair, Book"
              required
            />
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Quantity *</label>
            <input
              type="number"
              bind:value={itemQuantity}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="1"
              required
            />
          </div>

          <div class="flex justify-end space-x-3">
            <button type="button" onclick={closeModal} class="btn btn-ghost text-xs"> Cancel </button>
            <button
              type="submit"
              class="btn btn-ghost text-xs"
              class:opacity-50={loading}
              class:cursor-not-allowed={loading}
              disabled={loading}
            >
              {loading ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Edit Modal -->
  {#if showEditModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4 text-xs">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold text-gray-800">Edit Inventory Log</h2>
          <button onclick={closeModal} class="text-gray-500 hover:text-gray-700">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form onsubmit={handleEdit}>
          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Borrower Name *</label>
            <input
              type="text"
              bind:value={borrowerName}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter borrower name"
              required
            />
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Item *</label>
            <select
              bind:value={item}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Item</option>
              {#each items as itm}
                {#if getAvailableCount(itm.name) > 0 || (currentLogId && itm.name.toUpperCase() === item.toUpperCase())}
                  <option value={itm.name}>
                    {itm.name} (Available: {getAvailableCount(itm.name)})
                  </option>
                {:else}
                  <option value={itm.name} disabled class="text-gray-400">
                    {itm.name} (Available: 0) - Out of stock
                  </option>
                {/if}
              {/each}
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Room/Location</label>
            <input
              type="text"
              bind:value={room}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter room/location"
            />
          </div>

          <div class="mb-6">
            <label class="block text-gray-700 text-sm font-bold mb-2">Status</label>
            <select
              bind:value={status}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {#each statusOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
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
