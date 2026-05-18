<script>
  import { pb } from '../../../lib/Pocketbase.svelte'

  // User Data
  const username = pb.authStore.model?.username || 'Guest'
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  // Calendar Logic
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const todayDate = now.getDate()

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const monthLabel = `${monthNames[month]} ${year}`
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const calCells = [
    ...Array(firstDay).fill({ day: null }),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1 })),
  ]
</script>

<div class="relative min-h-screen overflow-hidden font-['DM_Sans'] transition-colors duration-300">
  <!-- Updated Background Accents to match Info Theme -->
  <div
    class="pointer-events-none absolute -right-10 -top-10 h-[450px] w-[450px] rounded-full bg-sky-500/10 blur-[100px]"
    aria-hidden="true"
  ></div>
  <div
    class="pointer-events-none absolute -bottom-10 -left-10 h-[350px] w-[350px] rounded-full bg-blue-500/10 blur-[80px]"
    aria-hidden="true"
  ></div>

  <div class="relative z-10 mx-auto grid max-w-[1024px] min-h-screen items-center gap-12 p-8 md:grid-cols-2 lg:gap-20">
    <!-- Hero / Greeting -->
    <div class="flex flex-col justify-center">
      <div
        class="mb-6 flex w-fit items-center gap-2 rounded-full border border-current/10 px-4 py-1.5 text-xs font-medium opacity-70"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
          />
        </svg>
        {todayName}
      </div>

      <h1 class="mb-4 font-['Playfair_Display'] text-4xl font-normal leading-tight md:text-5xl lg:text-6xl">
        Good day,<br />
        <!-- Swapped text color to info-blue -->
        <span class="font-semibold italic text-sky-600 dark:text-sky-400">{username}</span><br />
        Let's make the most of it.
      </h1>

      <p class="mb-8 text-base font-light tracking-wide opacity-60">Plan smart, schedule better, and achieve more.</p>

      <!-- Swapped button background to info-blue  -->
      <a
        href="#/current/mondayscheduleinput"
        class="group flex w-fit items-center gap-2 rounded-2xl bg-sky-600 px-7 py-4 text-sm font-medium text-white transition-all hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
      >
        Get started
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="transition-transform group-hover:translate-x-1"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </a>
    </div>

    <!-- Mini Calendar -->
    <div class="flex items-center justify-center md:justify-end">
      <div
        class="w-full max-w-[320px] rounded-[24px] border border-current/10 bg-current/5 p-6 shadow-sm backdrop-blur-xl"
      >
        <div class="mb-5">
          <span class="text-lg font-semibold tracking-tight">{monthLabel}</span>
        </div>

        <div class="mb-3 grid grid-cols-7 text-center">
          {#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as label}
            <span class="py-1 text-[10px] font-bold uppercase tracking-widest opacity-40">{label}</span>
          {/each}
        </div>

        <div class="grid grid-cols-7 gap-1 text-center">
          {#each calCells as cell}
            <span
              class="flex aspect-square items-center justify-center rounded-lg text-xs transition-all
              {cell.day === null ? 'invisible' : ''} 
              {cell.day === todayDate
                ? 'bg-sky-600 font-bold text-white dark:bg-sky-500'
                : 'opacity-70 hover:bg-current/10'}"
            >
              {cell.day ?? ''}
            </span>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');
</style>
