<script>
  import { Grid, h } from 'gridjs'
  import { domain, pb } from '../../../../lib/Pocketbase.svelte'
  import { onDestroy } from 'svelte'
  import { toast } from 'svelte-sonner'

  let registrationTable

  let gridColumns = [
    {
      name: 'ID',
      id: 'id',
      hidden: true,
    },
    {
      name: 'First Name',
      id: 'firstName',
    },
    {
      name: 'Last Name',
      id: 'lastName',
    },
    {
      name: 'Created',
      id: 'created',
      formatter: (cell) => new Date(cell).toLocaleDateString(),
    },
    {
      name: 'Actions',
      columns: [
        {
          name: 'View',
          formatter: (cell, row) => {
            return h(
              'button',
              {
                className: 'btn btn-xs btn-warning',
                onClick: async () => {
                  toast.promise(pb.collection('users').getOne(row.cells[0].data), {
                    loading: 'Fetching User Data ...',
                    success: (userData) => {
                      console.log(userData)

                      return 'Fetch success!'
                    },
                    error: (error) => {
                      return `Error: ${error.message}`
                    },
                  })
                },
              },
              'View'
            )
          },
        },
        {
          name: 'Delete',
          formatter: (cell, row) => {
            return h(
              'button',
              {
                className: 'btn btn-xs btn-error',
                onClick: () => {
                  if (window.confirm(`Are you sure you want to delete ${row.cells[1].data} ${row.cells[1].data}?`)) {
                    toast.promise(pb.collection('users').delete(row.cells[0].data), {
                      loading: 'Deleting...',
                      success: () => {
                        registrationTable.updateConfig({}).forceRender()
                        return 'Deletion Success!'
                      },
                      error: (error) => {
                        return `Error: ${error.message}`
                      },
                    })
                  }
                },
              },
              'Delete'
            )
          },
        },
      ],
    },
  ]

  const createTable = async (node) => {
    registrationTable = new Grid({
      sort: {
        multiColumn: false,
        server: {
          url: (prev, columns) => {
            if (!columns.length) return prev

            const col = columns[0]
            const colName = gridColumns[col.index]?.id || gridColumns[col.index]?.name
            const dir = col.direction === 1 ? '-' : ''

            return `${prev}sort=${dir}${colName}&`
          },
        },
      },
      columns: gridColumns,
      pagination: {
        limit: 10,
        server: {
          url: (prev, page, limit) => `${prev}page=${page + 1}&perPage=${limit}`,
        },
      },
      search: {
        server: {
          url: (prev, keyword) => `${prev}filter=(name ~ '${keyword}' || role ~ '${keyword}')&`,
        },
      },
      server: {
        url: `${domain}/api/collections/users/records?`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${pb.authStore.token}`,
          'Content-Type': 'application/json',
        },
        then: (data) => data.items,
        total: (data) => data.totalItems,
      },
      className: {
        table: 'text-xs',
        pagination: 'text-xs',
        tr: 'text-center',
      },
      autoWidth: true,
    }).render(node)
  }

  onDestroy(() => {
    registrationTable.destroy()
  })
</script>

<div class="m-5">
  <p class="text-3xl">Registration</p>
  <br />
  <div use:createTable></div>
</div>

<style global>
  @import 'https://cdn.jsdelivr.net/npm/gridjs/dist/theme/mermaid.min.css';
</style>
