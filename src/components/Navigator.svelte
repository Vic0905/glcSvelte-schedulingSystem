<script>
  import { current } from '../lib/Pocketbase.svelte'
</script>

{#if current.user}
  <!-- admin routes -->
  <li><a href="/#/registration">Registration</a></li>
  <li>
    <details>
      <summary>Parent</summary>
      <ul class="p-2">
        <li><a>Submenu 1</a></li>
        <li><a>Submenu 2</a></li>
      </ul>
    </details>
  </li>
  <li><a>Item 3</a></li>
{:else}
  <!-- public routes -->
  <li>
    <details>
      <summary>Registration</summary>
      <ul class="p-2">
        <li><a href="/#/registration/single">Single</a></li>
        <li><a href="/#/registration/group">Group</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Parent</summary>
      <ul class="p-2">
        <li><a>Submenu 1</a></li>
        <li><a>Submenu 2</a></li>
      </ul>
    </details>
  </li>
  <li><a>Item 3</a></li>
{/if}
