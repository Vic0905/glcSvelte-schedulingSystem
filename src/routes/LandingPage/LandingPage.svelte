<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
</script>

<div class="flex items-center justify-center overflow-hidden">
  <!-- Content Layer -->
  <div class="p-8 rounded-lg text-center mt-20">
    <h1 class="text-xl md:text-5xl font-bold tracking-wide">WELCOME TO</h1>
    <h1 class="text-3xl md:text-6xl font-bold tracking-wide text-info">GLOBAL LANGUAGE CEBU</h1>
  </div>
</div>

<div class="flex flex-row flex-wrap items-center justify-evenly gap-4 max-w-[850px] mx-auto mt-50">
  <!-- Registration -->
  <a href="/#/registration/">
    <img src={'/register.png'} alt="Registration" class="w-full max-w-[400px] h-[170px] object-cover" />
  </a>
  <!-- Request -->
  <a href="/#/request/">
    <img src={'/request.png'} alt="Registration" class="w-full max-w-[400px] h-[130px] object-cover" />
  </a>
  <!-- Rules -->
  <a href="/#/rules/">
    <img src={'/rules.png'} alt="Rules" class="w-full max-w-[400px] h-[130px] object-cover" />
  </a>
  <!-- Electricity -->
  <a href="/#/dashboard/">
    <img src={'/electricity.png'} alt="Registration" class="w-full max-w-[400px] h-[130px] object-cover" />
  </a>
</div>
