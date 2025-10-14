<script>
  import { current, pb } from '../lib/Pocketbase.svelte'
  import Logout from './Logout.svelte'
  import Navigator from './Navigator.svelte'
  import Theme from './Theme.svelte'

  // Get user initials for avatar fallback
  function getInitials(user) {
    if (user?.username) return user.username.slice(0, 2).toUpperCase()
    if (user?.email) return user.email.slice(0, 2).toUpperCase()
    return 'U'
  }

  // Get avatar URL from PocketBase using SDK
  function getAvatarUrl(user) {
    if (!user || !user.avatar) return null
    // Use PocketBase SDK's getFileUrl method
    return pb.files.getUrl(user, user.avatar)
  }

  // Handle image error
  function handleImageError(e) {
    e.target.style.display = 'none'
    if (e.target.nextElementSibling) {
      e.target.nextElementSibling.style.display = 'flex'
    }
  }
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
  <div class="navbar-end gap-2">
    <Theme />
    {#if current.user}
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar">
          <div class="w-10 rounded-full">
            {#if current.user.avatar}
              <img
                src={getAvatarUrl(current.user)}
                alt={current.user.username || current.user.email}
                onerror={handleImageError}
              />
              <div class="avatar placeholder" style="display: none;">
                <div class="bg-neutral text-neutral-content w-10 rounded-full">
                  <span class="text-sm">{getInitials(current.user)}</span>
                </div>
              </div>
            {:else}
              <div class="avatar placeholder">
                <div class="bg-neutral text-neutral-content w-10 rounded-full">
                  <span class="text-sm">{getInitials(current.user)}</span>
                </div>
              </div>
            {/if}
          </div>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <ul tabindex="0" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-10 mt-3 w-52 p-2 shadow">
          <li class="menu-title px-4 py-2">
            <div class="flex flex-col items-center gap-2 w-full">
              <span class="text-center text-xl">{current.user.username || current.user.email}</span>
              {#if current.user.role === 'admin'}
                <span class="badge badge-primary badge-sm">Admin</span>
              {/if}
              <div class="avatar mt-2">
                <div class="w-18 rounded-full ring ring-primary ring-offset-base-100 ring-offset-4">
                  {#if current.user.avatar}
                    <img src={getAvatarUrl(current.user)} alt={current.user.username || current.user.email} />
                  {:else}
                    <div class="avatar placeholder">
                      <div class="bg-neutral text-neutral-content w-16 rounded-full">
                        <span class="text-xl">{getInitials(current.user)}</span>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </li>
          <!-- <li><a href="/#/profile">Profile</a></li>
          <li><a href="/#/settings">Settings</a></li> -->
          <div class="divider my-0"></div>
          <li><Logout /></li>
        </ul>
      </div>
    {:else}
      <a class="btn btn-ghost" href="/#/login">Login</a>
    {/if}
  </div>
</div>
