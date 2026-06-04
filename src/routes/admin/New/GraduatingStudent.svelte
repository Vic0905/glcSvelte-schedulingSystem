<script>
  import { onMount } from 'svelte'
  import { Grid } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../lib/Pocketbase.svelte'

  let gridInstance = $state(null)
  let isLoading = $state(false)
  let weekStart = $state(getWeekStart(new Date()))

  function getWeekStart(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day < 2 ? day + 5 : day - 2
    d.setDate(d.getDate() - diff)
    return d.toISOString().split('T')[0]
  }

  function getWeekRangeDisplay(startDate) {
    const start = new Date(startDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 3)

    const opts = {
      month: 'long',
      day: 'numeric',
    }

    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', {
      ...opts,
      year: 'numeric',
    })}`
  }

  async function loadGraduatingStudents() {
    if (isLoading) return

    isLoading = true

    try {
      const startD = new Date(weekStart)
      const endD = new Date(startD)
      endD.setDate(startD.getDate() + 3)

      const startDateStr = `${weekStart} 00:00:00`
      const endDateStr = `${endD.toISOString().split('T')[0]} 23:59:59`

      const schedules = await pb.collection('schedule').getFullList({
        filter: `end >= "${startDateStr}" && end <= "${endDateStr}"`,
        expand: 'student,teacher,subject,room',
        sort: 'end',
      })

      const graduatingStudents = [
        ...new Map(
          schedules.map((s) => [
            s.student,
            {
              studentName: s.expand?.student?.englishName || '-',
              teacher: s.expand?.teacher?.name || '-',
              subject: s.expand?.subject?.name || '-',
              room: s.expand?.room?.name || '-',
              graduationDate: s.end,
            },
          ])
        ).values(),
      ]

      const data = graduatingStudents.map((s) => [
        s.studentName,
        s.teacher,
        s.subject,
        s.room,
        new Date(s.graduationDate).toLocaleDateString(),
      ])

      const columns = [
        {
          name: 'Student',
          width: '250px',
        },
        {
          name: 'Teacher',
          width: '180px',
        },
        {
          name: 'Subject',
          width: '180px',
        },
        {
          name: 'Room',
          width: '120px',
        },
        {
          name: 'Graduation Date',
          width: '150px',
        },
      ]

      if (gridInstance) {
        gridInstance
          .updateConfig({
            columns,
            data,
          })
          .forceRender()
      } else {
        gridInstance = new Grid({
          columns,
          data,
          search: true,
          sort: true,
          pagination: {
            limit: 20,
          },
          className: {
            table: 'w-full border text-sm',
            th: 'text-center',
            td: 'text-center',
          },
        }).render(document.getElementById('graduating-grid'))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load graduating students')
    } finally {
      isLoading = false
    }
  }

  async function changeWeek(weeks) {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + weeks * 7)
    weekStart = getWeekStart(d)

    await loadGraduatingStudents()
  }

  onMount(() => {
    loadGraduatingStudents()

    return () => {
      if (gridInstance) {
        gridInstance.destroy()
        gridInstance = null
      }
    }
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-2xl font-bold">Graduating Students</h2>

    {#if isLoading}
      <div class="loading loading-spinner loading-sm"></div>
    {/if}
  </div>

  <div class="mb-4 flex items-center justify-between">
    <h3 class="text-lg font-semibold">
      {getWeekRangeDisplay(weekStart)}
    </h3>

    <div class="flex gap-2">
      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(-1)}> ← Previous Week </button>

      <button class="btn btn-outline btn-sm" onclick={() => changeWeek(1)}> Next Week → </button>
    </div>
  </div>

  <div id="graduating-grid" class="border rounded-lg overflow-hidden"></div>
</div>

<style>
  #graduating-grid :global(th) {
    background-color: #484b4f;
    color: white;
  }

  #graduating-grid :global(.gridjs-search) {
    margin-bottom: 1rem;
  }
</style>
