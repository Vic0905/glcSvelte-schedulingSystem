<script>
  import { onMount } from 'svelte'
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { pb } from '../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let showModal = $state(false)
  let borrowerName = $state('')
  let item = $state('')
  let room = $state('')
  let loading = $state(false)
  let gridInstance = null
  let gridContainer

  // For item availability
  let items = $state([])

  // For item availability summary
  let itemSummary = $state([])

  const openModal = () => {
    showModal = true
    borrowerName = ''
    item = ''
    room = ''
  }

  const closeModal = () => {
    showModal = false
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

  // Get available count for a specific item
  const getAvailableCount = (itemName) => {
    const itemNameUpper = itemName.toUpperCase()
    const summaryItem = itemSummary.find((i) => i.name.toUpperCase() === itemNameUpper)
    return summaryItem ? summaryItem.available : 0
  }

  // Check if an item is available
  const isItemAvailable = (itemName) => {
    return getAvailableCount(itemName) > 0
  }

  // Get available items for dropdown
  const getAvailableItems = () => {
    return items.filter((item) => {
      return isItemAvailable(item.name)
    })
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

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!borrowerName.trim() || !item.trim()) {
      toast.error('Please fill in all fields')
      return
    }

    // Double-check if item is still available
    if (!isItemAvailable(item)) {
      toast.error('This item is no longer available. Please select another item.')
      return
    }

    loading = true

    try {
      const createData = {
        borrower_name: borrowerName.toUpperCase().trim(),
        item: item.toUpperCase().trim(),
        room: room.toUpperCase().trim(),
        status: 'reserved', // Always set to 'reserved' for user submissions
        borrowed_date: new Date().toISOString(),
      }

      await pb.collection('inventory_logs').create(createData)

      await loadData()
      await calculateItemSummary()
      closeModal()
      toast.success('Item reserved successfully!')
    } catch (error) {
      toast.error('Error reserving item: ' + error.message)
    } finally {
      loading = false
    }
  }

  // Initialize everything
  const initializeData = async () => {
    await Promise.all([loadData(), loadItems()])
  }

  onMount(() => {
    initializeData()
  })
</script>

<div class="container mx-auto px-4 py-8">
  <div class="max-w-8xl mx-auto">
    <div class="bg-base-100 shadow-xl rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <h1 class="text-2xl font-bold">Inventory Log</h1>
        <button onclick={openModal} class="btn btn-ghost"> Reserve Item </button>
      </div>

      <!-- Compact Item Summary Table -->
      <div class="mb-6">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-bold text-gray-700 text-xs">Available Items</h3>
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
                    <td class="px-3 py-2 text-xs font-medium text-gray-900 truncate max-w-[200px]" title={item.name}>
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
                      No items available for reservation.
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

  <!-- Reserve Item Modal -->
  {#if showModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4 text-xs">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold text-gray-800">Reserve Item</h2>
        </div>

        <form onsubmit={handleSubmit}>
          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Your Name *</label>
            <input
              type="text"
              bind:value={borrowerName}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your name"
              required
            />
          </div>

          <div class="mb-4">
            <label class="block text-gray-700 text-sm font-bold mb-2">Item to Reserve *</label>
            <select
              bind:value={item}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Item</option>
              {#each getAvailableItems() as itm}
                <option value={itm.name}>
                  {itm.name} (Available: {getAvailableCount(itm.name)})
                </option>
              {/each}

              <!-- Show out-of-stock items as disabled options -->
              {#each items.filter((i) => !isItemAvailable(i.name)) as itm}
                <option value={itm.name} disabled class="text-gray-400">
                  {itm.name} (Available: 0) - Out of stock
                </option>
              {/each}
            </select>
          </div>

          <div class="mb-6">
            <label class="block text-gray-700 text-sm font-bold mb-2">Room/Location</label>
            <input
              type="text"
              bind:value={room}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter room/location (optional)"
            />
          </div>

          <div class="mb-6 p-3 bg-blue-50 rounded-lg">
            <p class="text-sm text-blue-700 font-medium">
              <span class="font-bold">Status:</span> Reserved
            </p>
            <p class="text-xs text-blue-600 mt-1">
              Your item will be marked as "Reserved". Staff will update the status.
            </p>
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
              {loading ? 'Reserving...' : 'Reserve Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>
