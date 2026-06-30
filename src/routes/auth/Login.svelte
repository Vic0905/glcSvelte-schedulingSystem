<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../lib/Pocketbase.svelte'

  let username = $state('')
  let password = $state('')
  let isLoading = $state(false)

  const login = async (e) => {
    e.preventDefault()

    const trimmedUsername = username.trim()

    if (!trimmedUsername || !password) {
      toast.error('Please enter both your username/email and password.')
      return
    }

    isLoading = true

    try {
      await toast.promise(pb.collection('users').authWithPassword(trimmedUsername, password), {
        loading: 'Logging in…',
        success: () => {
          window.location.href = '/'
          return `Welcome back, ${trimmedUsername}!`
        },
        error: (error) => `Login failed: ${error?.message ?? 'Please check your credentials and try again.'}`,
      })
    } finally {
      isLoading = false
    }
  }
</script>

<form class="fieldset bg-base-200 border-base-300 rounded-box w-xs border p-4" onsubmit={login} aria-busy={isLoading}>
  <legend class="fieldset-legend">Login</legend>

  <label class="label" for="username">Username / Email</label>
  <input
    id="username"
    name="username"
    type="text"
    class="input validator"
    placeholder="Username / Email"
    autocomplete="username"
    bind:value={username}
    disabled={isLoading}
    required
  />

  <label class="label" for="password">Password</label>
  <input
    id="password"
    name="password"
    type="password"
    class="input validator"
    placeholder="Password"
    autocomplete="current-password"
    bind:value={password}
    disabled={isLoading}
    required
  />

  <button class="btn btn-info mt-4" type="submit" disabled={isLoading}>
    {#if isLoading}
      <span class="loading loading-spinner loading-sm"></span>
      Logging in…
    {:else}
      Login
    {/if}
  </button>
</form>

<style>
  form {
    margin: 10% auto;
  }
</style>
