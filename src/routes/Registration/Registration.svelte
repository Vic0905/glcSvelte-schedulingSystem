<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'

</script>

<div class="relative h-[50vh] flex items-center justify-center overflow-hidden">
  <!-- Background Layer -->
  <div class="absolute inset-0 bg-cover bg-center "
       style="background-image: url('/bg-form.jpg');">
  </div>

  <!-- Content Layer -->
  <div class="relative z-10 p-8 rounded-lg text-center">
    <h1 class="text-xl md:text-5xl font-bold tracking-wide">
      REGISTRATION FORMS
    </h1>
  </div>
</div>

  <div class="mt-6 flex justify-center gap-10">
  <a href="/#/registration/single"
     class="text-xl inline-flex items-center px-15 py-8 btn btn-primary rounded-lg hover:btn-primary transition duration-300">
    <!-- User Icon -->
    <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M5.121 17.804A9.004 9.004 0 0112 15c2.486 0 4.737.998 6.379 2.621M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
    Registration Form
  </a>
  
  <a href="/#/registration/group"
     class="text-xl inline-flex items-center px-15 py-8 btn btn-info rounded-lg hover:btn-info transition duration-300">
   <!-- User Icon -->
    <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <circle cx="9" cy="7" r="4" />
    </svg>
    Group Registration Form
  </a>
</div>  

