<script>
  import { Grid } from 'gridjs'
  import { domain, pb } from '../../../../lib/Pocketbase.svelte'
  import { onDestroy } from 'svelte'

  let registrationTable

  let gridColumns = [
    {
      name: 'ID',
      id: 'id',
      hidden: true,
    },
    {
      name: 'Name',
      id: 'name',
    },
    {
      name: 'Created',
      id: 'created',
      formatter: (cell) => new Date(cell).toLocaleString(),
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
      },
      autoWidth: false,
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
