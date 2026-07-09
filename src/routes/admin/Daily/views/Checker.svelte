<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  const BREAK_SCHEDULES = ['lunch break', 'break time', 'other task']

  let selectedDate = $state(getTodayDate())
  let selectedTimeslotId = $state(null)
  let timeslots = $state([])
  let rawRecords = $state([])
  let isLoading = $state(false)

  let cachedTimeslots = []

  function getTodayDate() {
    return new Date().toISOString().split('T')[0]
  }

  function formatDateDisplay(dateStr) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  }

  function offsetDate(dateStr, days) {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  function getRoomSortKey(roomName) {
    if (!roomName) return { tier: 99, num: Infinity }
    const upper = roomName.toUpperCase()
    let tier
    if (upper.startsWith('ST')) tier = 1
    else if (upper.startsWith('A')) tier = 0
    else if (upper.startsWith('B')) tier = 2
    else if (upper.startsWith('G') || upper.startsWith('H')) tier = 3
    else tier = 4
    const num = parseInt(upper.replace(/\D/g, ''), 10)
    return { tier, num: isNaN(num) ? Infinity : num }
  }

  function getBreakInfo(group) {
    return group.customSchedule.find((cs) => BREAK_SCHEDULES.includes(cs.name?.toLowerCase().trim()))
  }

  // Recomputed client-side so switching periods doesn't refetch —
  // only date changes hit PocketBase.
  let groupedSchedules = $derived.by(() => {
    if (!selectedTimeslotId) return []

    const map = new Map()
    for (const r of rawRecords) {
      if (r.expand?.timeslot?.id !== selectedTimeslotId) continue

      const teacherId = r.expand?.teacher?.id
      const roomId = r.expand?.room?.id
      const key = `${teacherId}-${roomId}`

      if (!map.has(key)) {
        map.set(key, {
          key,
          teacher: r.expand?.teacher || null,
          room: r.expand?.room || null,
          subject: r.expand?.subject || null,
          sub: r.expand?.sub || null,
          customSchedule: r.expand?.customSchedule || [],
          students: [],
        })
      }
      if (r.expand?.student) {
        map.get(key).students.push(r.expand.student.englishName)
      }
    }

    return [...map.values()].sort((a, b) => {
      const aKey = getRoomSortKey(a.room?.name)
      const bKey = getRoomSortKey(b.room?.name)
      if (aKey.tier !== bKey.tier) return aKey.tier - bKey.tier
      return aKey.num - bKey.num
    })
  })

  async function loadSchedules() {
    isLoading = true
    try {
      const date = selectedDate
      const [timeslotList, records] = await Promise.all([
        cachedTimeslots.length
          ? Promise.resolve(cachedTimeslots)
          : pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('dailySchedule').getFullList({
          filter: `date >= "${date} 00:00:00" && date <= "${date} 23:59:59"`,
          expand: 'teacher,student,subject,room,timeslot,customSchedule,sub',
        }),
      ])

      if (!cachedTimeslots.length) cachedTimeslots = timeslotList
      timeslots = timeslotList
      rawRecords = records

      if (!selectedTimeslotId || !timeslots.some((t) => t.id === selectedTimeslotId)) {
        selectedTimeslotId = timeslots[0]?.id || null
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedule')
    } finally {
      isLoading = false
    }
  }

  async function changeDay(days) {
    selectedDate = offsetDate(selectedDate, days)
    await loadSchedules()
  }

  async function onDateChange(e) {
    selectedDate = e.target.value
    await loadSchedules()
  }

  async function goToToday() {
    selectedDate = getTodayDate()
    await loadSchedules()
  }

  onMount(loadSchedules)
</script>

<div class="p-3 sm:p-4 md:p-6 bg-base-100 max-w-3xl mx-auto">
  <!-- Date bar -->
  <div class="flex flex-col gap-2 mb-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg sm:text-xl font-bold">{formatDateDisplay(selectedDate)}</h2>
      {#if isLoading}
        <div class="loading loading-spinner loading-sm"></div>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <button
        class="btn btn-outline btn-sm"
        onclick={goToToday}
        disabled={isLoading || selectedDate === getTodayDate()}
      >
        Today
      </button>
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(-1)} disabled={isLoading}>&larr;</button>
      <input
        type="date"
        class="input input-bordered input-sm flex-1"
        value={selectedDate}
        onchange={onDateChange}
        disabled={isLoading}
      />
      <button class="btn btn-outline btn-sm" onclick={() => changeDay(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <!-- Timeslot chips -->
  <div class="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
    {#each timeslots as ts (ts.id)}
      <button
        class="btn btn-sm shrink-0 {selectedTimeslotId === ts.id ? 'btn-primary' : 'btn-outline'}"
        onclick={() => (selectedTimeslotId = ts.id)}
      >
        {ts.start} - {ts.end}
      </button>
    {/each}
  </div>

  <!-- Schedule cards -->
  {#if !isLoading && groupedSchedules.length === 0}
    <div class="text-center text-sm opacity-50 py-10">No classes scheduled for this timeslot.</div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {#each groupedSchedules as group (group.key)}
        {@const breakInfo = getBreakInfo(group)}
        <div class="card bg-base-100 border border-base-300 shadow-sm">
          <div class="card-body p-3">
            {#if breakInfo}
              <div
                class="text-center font-bold py-2 rounded"
                style={breakInfo.color
                  ? `background:${breakInfo.color}20; color:${breakInfo.color};`
                  : 'background:#f3f4f6; color:#6b7280;'}
              >
                {breakInfo.name.toUpperCase()}
              </div>
              <div class="text-xs opacity-60 text-center mt-1">{group.teacher?.name || '—'}</div>
            {:else}
              <div class="flex items-center justify-between">
                <span class="font-bold">{group.room?.name || 'No Room'}</span>
                <span class="text-xs opacity-60">{group.subject?.name || 'No Subject'}</span>
              </div>
              <div class="text-sm mt-1">
                <span class="opacity-60">Teacher:</span>
                <span class="font-semibold">{group.teacher?.name || '—'}</span>
              </div>
              {#if group.sub}
                <div class="text-sm text-info font-semibold">Sub: {group.sub.name}</div>
              {/if}
              {#if group.students.length}
                <div class="flex flex-wrap gap-1">
                  <span class="text text-xs opacity-60">Student{group.students.length > 1 ? 's' : ''}:</span>
                  <span class="text text-xs">{group.students.join(', ')}</span>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
