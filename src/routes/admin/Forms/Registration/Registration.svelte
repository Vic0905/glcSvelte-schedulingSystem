<script>
  import { onDestroy } from 'svelte'
  import { createTable } from '../../../../lib/Grid.svelte'

  let table

  let data = [
    ['John', 'john@example.com', 30],
    ['Jane', 'jane@example.com', 28],
    ['Alice', 'alice@example.com', 35],
  ]

  let columns = ['Name', 'Email', 'Age']

  let options = {
    pagination: true,
    search: true,
    sort: true,
  }

  const registration = async (node) => {
    table = await createTable(columns, data, options, node)
  }

  onDestroy(() => {
    table.destroy()
  })
</script>

<div id="registration" use:registration></div>
