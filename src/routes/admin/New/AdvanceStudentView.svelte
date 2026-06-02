<script>
  import { Grid, h } from 'gridjs'
  import 'gridjs/dist/theme/mermaid.css'
  import { onDestroy, onMount } from 'svelte'
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let isLoading = $state(false)
  let grid = null
  let unsubSchedule = null

  const formatCell = (cell) => {
    if (!cell?.length) return h('span', { class: 'text-neutral-400' }, '—')
    return h(
      'div',
      { class: 'text-xs' },
      cell.map((item) =>
        h(
          'div',
          { class: 'flex flex-col gap-1 p-1 items-center text-center' },
          [
            h('div', { class: 'font-bold text-neutral-700 border-b border-neutral-200 mb-1 pb-1 w-full' }, [
              h('div', {}, item.subject?.name || ''),
              h(
                'div',
                { class: 'text-[10px] uppercase mt-1 tracking-wider text-neutral-700' },
                item.teacher?.name || ''
              ),
            ]),
            item.room && h('span', { class: 'badge badge-ghost badge-xs scale-90' }, item.room.name),
          ].filter(Boolean)
        )
      )
    )
  }

  async function load(savedScrollTop = null, savedScrollLeft = null) {
    isLoading = true
    try {
      const [timeslots, students, schedules] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('student').getFullList({
          filter: 'status != "graduated"',
          fields: 'id,name,englishName,course,level,status,created',
        }),
        pb.collection('advanceSchedule').getFullList({
          expand: 'teacher,student,subject,room,timeslot',
        }),
      ])

      const scheduleMap = new Map()
      for (const s of schedules) {
        const timeslotId = s.expand?.timeslot?.id
        if (!timeslotId) continue

        const entry = {
          subject: s.expand?.subject,
          teacher: s.expand?.teacher,
          room: s.expand?.room,
        }

        const studentList = Array.isArray(s.expand?.student)
          ? s.expand.student
          : s.expand?.student
            ? [s.expand.student]
            : []

        for (const student of studentList) {
          if (!scheduleMap.has(student.id)) scheduleMap.set(student.id, new Map())
          const slots = scheduleMap.get(student.id)
          if (!slots.has(timeslotId)) slots.set(timeslotId, entry)
        }
      }

      const data = students
        .sort((a, b) => {
          const diff = (a.status === 'new' ? 1 : 0) - (b.status === 'new' ? 1 : 0)
          return diff !== 0 ? diff : new Date(a.created) - new Date(b.created)
        })
        .map((student) => {
          const slots = scheduleMap.get(student.id) || new Map()
          return [
            { value: student.name, status: student.status },
            { value: student.englishName || '' },
            { value: student.course || '' },
            { value: student.level || '' },
            ...timeslots.map((ts) => {
              const s = slots.get(ts.id)
              return s ? [s] : []
            }),
          ]
        })

      const columns = [
        {
          name: 'Student',
          width: '180px',
          formatter: (cell) =>
            h(
              'div',
              { class: 'flex flex-col items-center text-center text-neutral-700 font-bold' },
              [
                h('span', {}, cell.value),
                cell.status === 'new' && h('span', { class: 'badge badge-soft badge-success badge-xs mt-1' }, 'New'),
              ].filter(Boolean)
            ),
        },
        {
          name: 'English Name',
          width: '140px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        {
          name: 'Course',
          width: '120px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        {
          name: 'Level',
          width: '120px',
          formatter: (cell) => h('div', { class: 'text-center text-neutral-700 font-bold' }, cell.value),
        },
        ...timeslots.map((t) => ({
          name: `${t.start} - ${t.end}`,
          width: '180px',
          formatter: formatCell,
        })),
      ]

      if (grid) {
        if (savedScrollTop === null) {
          const wrapper = document.querySelector('#advanceStudentGrid .gridjs-wrapper')
          savedScrollTop = wrapper?.scrollTop ?? 0
          savedScrollLeft = wrapper?.scrollLeft ?? 0
        }

        grid.updateConfig({ data, columns }).forceRender()

        requestAnimationFrame(() => {
          const wrapper = document.querySelector('#advanceStudentGrid .gridjs-wrapper')
          if (wrapper) {
            wrapper.scrollTop = savedScrollTop
            wrapper.scrollLeft = savedScrollLeft
          }
        })
      } else {
        grid = new Grid({
          columns,
          data,
          search: false,
          sort: false,
          pagination: false,
          className: { table: 'w-full border text-xs !border-collapse', th: 'text-center' },
          style: { table: { 'border-collapse': 'collapse', 'table-layout': 'fixed' } },
        }).render(document.getElementById('advanceStudentGrid'))
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load advance schedule')
    } finally {
      isLoading = false
    }
  }

  onMount(async () => {
    await load()
    unsubSchedule = await pb.collection('advanceSchedule').subscribe('*', () => {
      const wrapper = document.querySelector('#advanceStudentGrid .gridjs-wrapper')
      const top = wrapper?.scrollTop ?? 0
      const left = wrapper?.scrollLeft ?? 0
      load(top, left)
    })
  })

  onDestroy(() => {
    unsubSchedule?.()
    grid?.destroy()
    grid = null
  })
</script>

<div class="p-6 bg-base-100">
  <div class="flex items-center justify-between mb-4 text-2xl font-bold">
    <h2 class="text-center flex-1">Advance Student View (MTM + GRP)</h2>
    {#if isLoading}<div class="loading loading-spinner loading-sm"></div>{/if}
  </div>

  <div id="advanceStudentGrid" class="border rounded-lg overflow-hidden"></div>
</div>

<style>
  #advanceStudentGrid :global(.gridjs-wrapper) {
    max-height: 700px;
    overflow: auto;
  }

  #advanceStudentGrid :global(tr) {
    background-color: #ffffff;
  }

  #advanceStudentGrid :global(th) {
    position: sticky;
    top: 0;
    z-index: 20;
    box-shadow: inset -1px -1px 0 #ddd;
    background-color: #484b4f !important;
    color: #ffffff;
  }

  #advanceStudentGrid :global(td) {
    background-color: inherit;
  }

  #advanceStudentGrid :global(th:nth-child(1)),
  #advanceStudentGrid :global(td:nth-child(1)) {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #advanceStudentGrid :global(th:nth-child(1)) {
    z-index: 25;
    background-color: #484b4f !important;
  }

  #advanceStudentGrid :global(th:nth-child(2)),
  #advanceStudentGrid :global(td:nth-child(2)) {
    position: sticky;
    left: 180px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #advanceStudentGrid :global(th:nth-child(2)) {
    z-index: 25;
    background-color: #484b4f !important;
  }

  #advanceStudentGrid :global(th:nth-child(3)),
  #advanceStudentGrid :global(td:nth-child(3)) {
    position: sticky;
    left: 320px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #advanceStudentGrid :global(th:nth-child(3)) {
    z-index: 25;
    background-color: #484b4f !important;
  }

  #advanceStudentGrid :global(th:nth-child(4)),
  #advanceStudentGrid :global(td:nth-child(4)) {
    position: sticky;
    left: 440px;
    z-index: 10;
    box-shadow: inset -1px 0 0 #ddd;
    background-color: inherit;
  }

  #advanceStudentGrid :global(th:nth-child(4)) {
    z-index: 25;
    background-color: #484b4f !important;
  }
</style>
