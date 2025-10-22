<script>
  import { pb } from '../../../lib/Pocketbase.svelte'

  // Get today's date formatted nicely
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
  })

  // Get the logged-in user's username
  const username = pb.authStore.model?.username || 'Guest'
</script>

<div class="hero min-h-screen">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold">
        Good day, <span class="text-primary italic font-semibold">{username}</span> <br />Let’s make the most of {today}.
      </h1>
      ```
      <p class="py-6 text-gray-600 italic">Plan your lessons. Inspire your students. Own the day.</p>
      <a href="#/current/teacherview" class="btn btn-outline btn-primary">Get Started</a>
    </div>
  </div>
</div>
