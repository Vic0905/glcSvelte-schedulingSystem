import { Grid } from 'gridjs'
import 'gridjs/dist/theme/mermaid.css'

export const createTable = (columns, data, options = {}, element) => {
  let grid = new Grid({
    columns,
    data,
    ...options,
  }).render(element)

  return grid
}
