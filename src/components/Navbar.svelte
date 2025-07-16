<script>
  import { current } from '../lib/Pocketbase.svelte'
  import Logout from './Logout.svelte'
  import Navigator from './Navigator.svelte'
  import Theme from './Theme.svelte'
</script>

<div class="navbar">
  <div class="navbar-start">
    <div class="dropdown">
      <div tabindex="0" role="button" class="btn btn-ghost lg:hidden">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16" />
        </svg>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <ul tabindex="0" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
        <Navigator />
      </ul>
    </div>
    <!-- svelte-ignore a11y_missing_attribute -->
    <a class="btn btn-ghost" href="/#/"><img src="/favicon.ico" alt="glc-logo" /></a>
  </div>
  <div class="navbar-center hidden lg:flex">
    <ul class="menu menu-horizontal px-1">
      <Navigator />
    </ul>
  </div>
  <div class="navbar-end">
    <Theme />
    {#if current.user}
      <Logout />
    {:else}
      <a class="btn btn-ghost" href="/#/login">Login</a>
    {/if}
  </div>
</div>
