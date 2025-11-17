<script>
  import { toast } from 'svelte-sonner'
  import { pb } from '../../lib/Pocketbase.svelte'

  let username = $state()
  let password = $state()

  const login = async (e) => {
    e.preventDefault()
    toast.promise(pb.collection('users').authWithPassword(username, password), {
      loading: 'Loggin in ...',
      success: (data) => {
        window.location.href = '/'
        return `Welcome, ${username}`
      },
      error: (error) => {
        return `Error: ${error.message}`
      },
    })
  }
</script>

<form class="fieldset bg-base-200 border-base-300 rounded-box w-xs border p-4" onsubmit={login}>
  <legend class="fieldset-legend">Login</legend>

  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class="label">Username / Email</label>
  <input type="text" class="input validator" placeholder="Username / Email" bind:value={username} required />

  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class="label">Password</label>
  <input type="password" class="input validator" placeholder="Password" bind:value={password} required />

  <button class="btn btn-info mt-4" type="submit">Login</button>
</form>

<style>
  form {
    margin: 10% auto;
  }
</style>
