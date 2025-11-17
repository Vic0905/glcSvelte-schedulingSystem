<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'

  const stickyStyles = `
    #mondayTeacherAdvanceGrid .gridjs-wrapper { max-height: 700px; overflow: auto; }
    #mondayTeacherAdvanceGrid th { position: sticky; top: 0; z-index: 20; box-shadow: inset -1px 0 0 #ddd; }
    #mondayTeacherAdvanceGrid th:nth-child(1), #mondayTeacherAdvanceGrid td:nth-child(1) { position: sticky; left: 0; z-index: 15;  box-shadow: inset -1px 0 0 #ddd; }
    #mondayTeacherAdvanceGrid th:nth-child(1) { z-index: 25; }
  `

  let selectedMonday = $state(getNextMonday(new Date()))
  let teacherGrid = null
  let timeslots = []
  let teachers = []
  let isLoading = $state(false)

  function getNextMonday(date) {
    const d = new Date(date)
    const day = d.getDay()
    // If today is Monday (1), use today. Otherwise go back to most recent Monday
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  }

  function getMondayDisplay(mondayDate) {
    const date = new Date(mondayDate)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const changeWeek = (weeks) => {
    const d = new Date(selectedMonday)
    d.setDate(d.getDate() + weeks * 7)
    selectedMonday = d.toISOString().split('T')[0]
  }

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', {}, '—')

    // check if all items have hiddenDetails
    const allHidden = cell.every((item) => item.hiddenDetails)
    if (allHidden) {
      return h('div', { class: 'badge badge-success badge-sm' }, 'Scheduled')
    }

    return h(
      'div',
      { class: 'text-xs flex flex-col gap-1 items-center' },
      cell.map((item) => {
        // Shoe "Scheduled" for individual hidden items
        if (item.hiddenDetails) {
          return h('div', { class: 'badge badge-success badge-sm mb-1' }, 'Scheduled')
        }

        const badges = [h('span', { class: 'badge badge-primary badge-xs p-3' }, item.subject?.name ?? 'No Subject')]

        if (item.isGroup) {
          badges.push(h('span', { class: 'badge badge-secondary badge-xs' }, 'Group Class'))
        } else {
          badges.push(h('span', { class: 'badge badge-neutral badge-xs' }, item.student?.englishName ?? 'No Student'))
          if (item.student?.status === 'new') {
            badges.push(h('span', { class: 'badge badge-success badge-xs' }, 'NEW'))
          }
        }

        badges.push(h('span', { class: 'badge badge-error badge-xs' }, item.room?.name ?? 'No Room'))

        return h('div', { class: 'flex flex-col gap-1 items-center' }, badges)
      })
    )
  }

  async function loadMondayTeacherSchedule() {
    if (isLoading) return
    isLoading = true

    try {
      const [timeslotsData, teachersData, individualSchedules, groupSchedules] = await Promise.all([
        timeslots.length ? timeslots : pb.collection('timeSlot').getFullList({ sort: 'start' }),
        teachers.length ? teachers : pb.collection('teacher').getFullList({ sort: 'name' }),
        pb.collection('mondayAdvanceBooking').getList(1, 500, {
          expand: 'teacher,student,subject,room,timeslot',
        }),
        pb.collection('mondayAdvanceGroupBooking').getList(1, 500, {
          expand: 'teacher,student,subject,grouproom,timeslot',
        }),
      ])

      timeslots = timeslotsData
      teachers = teachersData

      // Build schedule map
      const scheduleMap = {}

      // Process individual lessons
      for (const s of individualSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        const studentId = s.expand?.student?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        scheduleMap[teacherId][timeslotId][studentId] = {
          subject: s.expand?.subject,
          student: s.expand?.student,
          room: s.expand?.room,
          isGroup: false,
          hiddenDetails: s.hiddenDetails || false,
        }
      }

      // Process group lessons
      for (const s of groupSchedules.items) {
        const teacherId = s.expand?.teacher?.id
        const timeslotId = s.expand?.timeslot?.id
        const subjectId = s.expand?.subject?.id
        const roomId = s.expand?.grouproom?.id
        if (!teacherId || !timeslotId) continue

        scheduleMap[teacherId] ??= {}
        scheduleMap[teacherId][timeslotId] ??= {}

        const key = `group_${subjectId}_${roomId}`
        scheduleMap[teacherId][timeslotId][key] = {
          subject: s.expand?.subject,
          student: null,
          room: s.expand?.grouproom,
          isGroup: true,
          hiddenDetails: s.hiddenDetails || false,
        }
      }

      // Build table data
      const data = teachers.map((teacher) => {
        const teacherSchedule = scheduleMap[teacher.id] || {}
        return [
          { value: teacher.name },
          ...timeslots.map((ts) => {
            const schedules = teacherSchedule[ts.id]
            return schedules ? Object.values(schedules) : []
          }),
        ]
      })

      const columns = [
        { name: 'Teacher', width: '120px', formatter: (cell) => cell.value },
        ...timeslots.map((t) => ({ name: `${t.start} - ${t.end}`, width: '160px', formatter: formatCell })),
      ]

      if (teacherGrid) {
        const wrapper = document.querySelector('#mondayTeacherAdvanceGrid .gridjs-wrapper')
        const scroll = { top: wrapper?.scrollTop || 0, left: wrapper?.scrollLeft || 0 }

        teacherGrid.updateConfig({ data }).forceRender()

        requestAnimationFrame(() => {
          const w = document.querySelector('#mondayTeacherAdvanceGrid .gridjs-wrapper')
          if (w) {
            w.scrollTop = scroll.top
            w.scrollLeft = scroll.left
          }
        })
      } else {
        teacherGrid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: {
            table: 'w-full border text-xs',
            th: 'bg-base-200 p-2 border text-center',
            td: 'border p-2 text-center align-middle',
          },
          style: { table: { 'border-collapse': 'collapse' } },
        }).render(document.getElementById('mondayTeacherAdvanceGrid'))
      }
    } catch (error) {
      console.error('Error loading Monday teacher schedule:', error)
    } finally {
      isLoading = false
    }
  }

  let reloadTimeout
  const debouncedReload = () => {
    clearTimeout(reloadTimeout)
    reloadTimeout = setTimeout(loadMondayTeacherSchedule, 150)
  }

  onMount(() => {
    loadMondayTeacherSchedule()
    pb.collection('mondayAdvanceBooking').subscribe('*', debouncedReload)
    pb.collection('mondayAdvanceGroupBooking').subscribe('*', debouncedReload)
  })

  onDestroy(() => {
    clearTimeout(reloadTimeout)
    teacherGrid?.destroy()
    teacherGrid = null
    pb.collection('mondayAdvanceBooking').unsubscribe()
    pb.collection('mondayAdvanceGroupBooking').unsubscribe()
  })
</script>

<svelte:head>
  {@html `<style>${stickyStyles}</style>`}
</svelte:head>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold text-primary">
    <h2 class="text-center flex-1">Monday Teacher View Table (Advance Template)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div class="mb-2 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <label for="filterDate" class="text-sm font-semibold">Select Monday:</label>
      <input
        type="date"
        id="filterDate"
        bind:value={selectedMonday}
        class="input input-bordered input-sm w-40"
        disabled={isLoading}
      />
    </div>

    <h3 class="text-xl font-semibold text-primary text-center mr-50">{getMondayDisplay(selectedMonday)}</h3>

    <div class="flex items-center gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)} disabled={isLoading}>&larr;</button>
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)} disabled={isLoading}>&rarr;</button>
    </div>
  </div>

  <div class="bg-base-200 rounded-lg m-2 p-2">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex gap-1"><span class="badge badge-primary badge-xs"></span> Subject</div>
      <div class="flex gap-1"><span class="badge badge-neutral badge-xs"></span> Student</div>
      <div class="flex gap-1"><span class="badge badge-success badge-xs"></span> New Student</div>
      <div class="flex gap-1"><span class="badge badge-secondary badge-xs"></span> Group Lesson</div>
      <div class="flex gap-1"><span class="badge badge-error badge-xs"></span> Room</div>
    </div>
  </div>

  <div id="mondayTeacherAdvanceGrid" class="border rounded-lg"></div>
</div>
