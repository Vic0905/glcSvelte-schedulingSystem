<script>
  import Router from 'svelte-spa-router'
  import { current, pb } from './lib/Pocketbase.svelte'
  import { Toaster } from 'svelte-sonner'
  import { adminRoutes, guestRoutes, staffRoutes, teacherRoutes } from './lib/Routes.svelte'
  import Navbar from './components/Navbar.svelte'
</script>

<Navbar />
{#if current.user}
  {#if current.user.role === 'admin'}
    <Router routes={adminRoutes} />
  {/if}
  {#if current.user.role === 'staff'}
    <Router routes={staffRoutes} />
  {/if}
  {#if current.user.role === 'teacher'}
    <Router routes={teacherRoutes} />
  {/if}
{:else}
  <Router routes={guestRoutes} />
{/if}

<div class="font=[Inter]">
  <Toaster position="bottom-right" richColors expand={true} />
</div>
