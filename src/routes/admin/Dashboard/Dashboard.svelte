<script>
  import { onMount } from 'svelte'
  let user = {
    name: 'Juniel Diputado',
    role: 'Teacher', // Change to "Admin" or "Student" dynamically later
  }

  let stats = [
    { title: 'Total Students', value: '128', icon: '🎓', color: 'bg-blue-500' },
    { title: 'Total Teachers', value: '12', icon: '👨‍🏫', color: 'bg-green-500' },
    { title: 'Classes Today', value: '8', icon: '📅', color: 'bg-yellow-500' },
    { title: 'Attendance Rate', value: '96%', icon: '📈', color: 'bg-purple-500' },
  ]

  let announcements = [
    { title: 'Parent-Teacher Meeting', date: 'Oct 15, 2025', content: 'Scheduled at 9:00 AM in Room 204.' },
    { title: 'System Maintenance', date: 'Oct 12, 2025', content: 'Dashboard may be offline from 1AM - 3AM.' },
  ]

  let upcoming = [
    { time: '08:00 AM', subject: 'Math', teacher: 'Mr. Cruz', room: '101' },
    { time: '10:00 AM', subject: 'Science', teacher: 'Ms. Reyes', room: '102' },
    { time: '01:00 PM', subject: 'English', teacher: 'Mr. Lopez', room: '104' },
  ]
</script>

<div class="p-6 space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-5xl font-bold">THIS TEMPORARY TEMPLATE!!!</h1>
      <h1 class="text-2xl font-bold">Welcome back, {user.name} 👋</h1>
      <p class="text-sm text-gray-500">
        Role:
        <span class="badge badge-primary">{user.role}</span>
      </p>
    </div>
    <button class="btn btn-primary btn-sm">Go Live</button>
  </div>

  <!-- Stats -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {#each stats as stat}
      <div class={`card shadow-md text-white ${stat.color}`}>
        <div class="card-body p-4">
          <div class="flex items-center justify-between">
            <span class="text-3xl">{stat.icon}</span>
            <div class="text-right">
              <h2 class="font-bold text-lg">{stat.value}</h2>
              <p class="text-sm opacity-80">{stat.title}</p>
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>

  <!-- Chart Placeholder -->
  <div class="card bg-base-100 shadow-md">
    <div class="card-body">
      <h2 class="card-title">Weekly Performance</h2>
      <div class="w-full h-48 flex items-center justify-center text-gray-400">
        📊 Chart placeholder (integrate Chart.js or ApexCharts)
      </div>
    </div>
  </div>

  <!-- Upcoming Schedule + Announcements -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Upcoming Schedule -->
    <div class="card bg-base-100 shadow-md">
      <div class="card-body">
        <h2 class="card-title">Upcoming Classes</h2>
        <ul class="divide-y divide-gray-200">
          {#each upcoming as item}
            <li class="py-2 flex justify-between">
              <div>
                <p class="font-semibold">{item.subject}</p>
                <p class="text-xs text-gray-500">{item.teacher} • {item.room}</p>
              </div>
              <p class="text-sm text-gray-400">{item.time}</p>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <!-- Announcements -->
    <div class="card bg-base-100 shadow-md">
      <div class="card-body">
        <h2 class="card-title">Announcements</h2>
        <ul class="space-y-3">
          {#each announcements as ann}
            <li class="border-l-4 border-primary pl-3">
              <p class="font-semibold">{ann.title}</p>
              <p class="text-xs text-gray-500">{ann.date}</p>
              <p class="text-sm">{ann.content}</p>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>

  <!-- Quick Actions -->
  <div class="card bg-base-100 shadow-md">
    <div class="card-body">
      <h2 class="card-title">Quick Actions ⚡</h2>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-outline btn-primary btn-sm">Add Schedule</button>
        <button class="btn btn-outline btn-success btn-sm">Mark Attendance</button>
        <button class="btn btn-outline btn-info btn-sm">View Reports</button>
        <button class="btn btn-outline btn-warning btn-sm">Announcements</button>
      </div>
    </div>
  </div>
</div>
