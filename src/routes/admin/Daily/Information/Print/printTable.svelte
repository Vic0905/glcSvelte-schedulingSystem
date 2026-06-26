<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../../lib/Pocketbase.svelte'

  let selectedDate = $state(new Date().toISOString().split('T')[0])
  let isLoading = $state(false)
  let allStudents = $state([])
  let scheduleMap = $state(new Map())
  let todayHoliday = $state(null)

  let cachedTimeslots = []
  let cachedHolidays = []

  // 6 slots for the single print page
  let slots = $state(['', '', '', '', '', ''])
  let queries = $state(['', '', '', '', '', ''])

  // Students selected for each slot (null = not yet picked)
  let selectedStudents = $derived(slots.map((id) => allStudents.find((s) => s.id === id) ?? null))

  // Dropdown suggestions per slot
  let suggestions = $derived(
    queries.map((q, i) => {
      if (!q.trim()) return []
      const lower = q.toLowerCase()
      return allStudents
        .filter(
          (s) => !slots.includes(s.id) || slots[i] === s.id // exclude already-picked except own slot
        )
        .filter((s) => s.name?.toLowerCase().includes(lower) || s.englishName?.toLowerCase().includes(lower))
        .slice(0, 8)
    })
  )

  function formatDateShort(dateStr) {
    return new Date(dateStr)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .toUpperCase()
  }
  function getPrintDate(dateStr) {
    const day = new Date(dateStr).getDay()
    if (day === 1) {
      const formatted = new Date(dateStr).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
      return `${formatted} ONLY`
    }
    return ''
  }

  async function loadData() {
    isLoading = true
    try {
      const [timeslots, holidays] = await Promise.all([
        pb.collection('timeslot').getFullList({ sort: 'start' }),
        pb.collection('holiday').getFullList({ fields: 'id,name,date' }),
      ])
      cachedTimeslots = timeslots
      cachedHolidays = holidays

      const startStr = `${selectedDate} 00:00:00`
      const endStr = `${selectedDate} 23:59:59`

      todayHoliday = cachedHolidays.find((h) => h.date?.split(' ')[0] === selectedDate) ?? null

      const fetchedStudents = await pb.collection('student').getFullList({
        filter: `status != "graduated" && start <= "${endStr}" && end >= "${startStr}"`,
      })

      const latestByName = new Map()
      for (const s of fetchedStudents) {
        const key = s.englishName?.toLowerCase()
        if (!key) continue
        if (!latestByName.has(key) || new Date(s.created) > new Date(latestByName.get(key).created)) {
          latestByName.set(key, s)
        }
      }

      allStudents = [...latestByName.values()].sort((a, b) => {
        const aIsNew = a.status === 'new' ? 1 : 0
        const bIsNew = b.status === 'new' ? 1 : 0
        return aIsNew !== bIsNew ? aIsNew - bIsNew : new Date(a.created) - new Date(b.created)
      })

      const schedules = await pb.collection('dailySchedule').getFullList({
        filter: `date >= "${startStr}" && date <= "${endStr}" && status = "show"`,
        expand: 'teacher,student,subject,room,timeslot',
      })

      const newMap = new Map()
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
          if (!newMap.has(student.id)) newMap.set(student.id, new Map())
          const slots = newMap.get(student.id)
          if (!slots.has(timeslotId)) slots.set(timeslotId, [])
          slots.get(timeslotId).push({ ...entry, remarks: student.remarks }) // ← student.remarks
        }
      }

      scheduleMap = newMap

      // Clear slots that no longer exist for this date
      slots = slots.map((id) => (allStudents.find((s) => s.id === id) ? id : ''))
      queries = queries.map((q, i) => (slots[i] ? q : ''))
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedule data')
    } finally {
      isLoading = false
    }
  }

  function pickStudent(slotIndex, student) {
    slots = slots.map((v, i) => (i === slotIndex ? student.id : v))
    queries = queries.map((v, i) => (i === slotIndex ? '' : v)) // ← clear query after pick
  }

  function clearSlot(slotIndex) {
    slots = slots.map((v, i) => (i === slotIndex ? '' : v))
    queries = queries.map((v, i) => (i === slotIndex ? '' : v))
  }

  async function printSchedules() {
    const chosen = selectedStudents.filter(Boolean)
    if (chosen.length === 0) {
      toast.warning('No students selected to print')
      return
    }

    const cards = chosen.map((student) => {
      const studentSlots = scheduleMap.get(student.id)

      const statusBadge =
        student.status === 'new'
          ? '<span class="bdg-new">New</span>'
          : student.status === 'extended'
            ? '<span class="bdg-ext">Extended</span>'
            : student.status === 'changed'
              ? '<span class="bdg-chg">Changed</span>'
              : ''

      const tableRows = cachedTimeslots
        .map((ts, i) => {
          const entries = studentSlots?.get(ts.id) || []
          if (entries.length) {
            return `
          <tr>
            <td class="per">${i + 1}</td>
            <td class="tim">${ts.start}–${ts.end}</td>
            <td>${entries.map((e) => e.teacher?.name || '—').join(' / ')}</td>
            <td>${entries.map((e) => e.room?.name || '—').join(' / ')}</td>
            <td>${entries.map((e) => e.subject?.name || '—').join(' / ')}</td>
            <td>${entries.map((e) => e.remarks || '—').join(' / ')}</td>
          </tr>`
          } else {
            return `
          <tr>
            <td class="per">${i + 1}</td>
            <td class="tim">${ts.start}–${ts.end}</td>
            <td class="muted">—</td>
            <td class="muted">—</td>
            <td class="muted">—</td>
            <td class="muted">—</td>
          </tr>`
          }
        })
        .join('')

      return `
  <div class="student-card">
    <div class="card-header">
      STUDENT'S SCHEDULE ${statusBadge}
    </div>
    <div class="card-info">
      <div class="card-info-cell">
        <div class="cell-label">Name</div>
        <div class="cell-value">${student.name || '—'}</div>
      </div>
      <div class="card-info-cell">
        <div class="cell-label">English Name</div>
        <div class="cell-value">${student.englishName || '—'}</div>
      </div>
      ${
        getPrintDate(selectedDate)
          ? `
      <div class="card-info-cell">
        <div class="cell-label">Date</div>
        <div class="cell-value red">${getPrintDate(selectedDate)}</div>
      </div>`
          : ''
      }
    </div>
    <table>
      <thead>
        <tr>
          <th>NO.</th><th>TIME</th><th>TEACHER</th>
          <th>CUBICLE/ROOM</th><th>SUBJECT</th><th>REMARKS</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`
    })

    // Pad to 6 cards so the grid stays 3x2
    while (cards.length < 6) {
      cards.push('<div class="student-card empty"></div>')
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Student Schedules — ${formatDateShort(selectedDate)}</title>
  <style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; }
@page { size: A4 landscape; margin: 5mm; }

.print-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 2.5mm;
  width: 100%;
  height: 100vh;
}

.student-card {
  border: 2px solid #000;
  overflow: hidden;
  break-inside: avoid;
  display: flex;
  flex-direction: column;
}
.student-card.empty { background: #f0f0f0 !important; }

.card-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-weight: 900;
  font-size: 7pt;
  letter-spacing: 0.1em;
  padding: 1mm 2mm;
  border-bottom: 2px solid #000;
  background: #cccccc !important;
  flex-shrink: 0;
  color: #000 !important;
}

.card-info { display: flex; border-bottom: 2px solid #000; flex-shrink: 0; }
.card-info-cell { flex: 1; padding: 0.8mm 1.5mm; border-right: 1.5px solid #000; }
.card-info-cell:last-child { border-right: none; }
.cell-label { font-size: 5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #000 !important; }
.cell-value { font-weight: 900; font-size: 6pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #000 !important; }
.cell-value.red { color: #cc0000 !important; }

table { width: 100%; border-collapse: collapse; flex: 1; }
thead tr { background: #000 !important; }
th {
  text-align: center;
  padding: 1mm 0.3mm;
  font-size: 5pt;
  letter-spacing: 0.05em;
  font-weight: 800;
  color: #ffffff !important;
  background: #000 !important;
  border: 1px solid #000;
}
td {
  border: 1px solid #000;
  text-align: center;
  padding: 0.5mm 0.3mm;
  vertical-align: middle;
  font-size: 5.5pt;
  line-height: 1.3;
  color: #000 !important;
}
td.per {
  background: #bbbbbb !important;
  font-weight: 900;
  font-size: 7pt;
  width: 5mm;
  color: #000 !important;
  border: 1px solid #000;
}
td.tim {
  font-weight: 800;
  white-space: nowrap;
  font-size: 5pt;
  color: #000 !important;
}
td.muted { color: #777 !important; }

.bdg-new { font-size: 5pt; font-weight: 900; background: #bbf7d0 !important; color: #14532d !important; border: 1px solid #166534; padding: 0.2mm 1.5mm; border-radius: 99px; }
.bdg-ext { font-size: 5pt; font-weight: 900; background: #e9d5ff !important; color: #581c87 !important; border: 1px solid #6b21a8; padding: 0.2mm 1.5mm; border-radius: 99px; }
.bdg-chg { font-size: 5pt; font-weight: 900; background: #fecaca !important; color: #7f1d1d !important; border: 1px solid #991b1b; padding: 0.2mm 1.5mm; border-radius: 99px; }
  </style>
</head>
<body>
  <div class="print-grid">
    ${cards.join('')}
  </div>
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body>
</html>`

    const win = window.open('', '_blank', 'width=1200,height=800')
    win.document.write(html)
    win.document.close()
  }

  async function printAllSchedules() {
    if (allStudents.length === 0) {
      toast.warning('No students available for this date')
      return
    }

    const buildCard = (student) => {
      const studentSlots = scheduleMap.get(student.id)

      const statusBadge =
        student.status === 'new'
          ? '<span class="bdg-new">New</span>'
          : student.status === 'extended'
            ? '<span class="bdg-ext">Extended</span>'
            : student.status === 'changed'
              ? '<span class="bdg-chg">Changed</span>'
              : ''

      const tableRows = cachedTimeslots
        .map((ts, i) => {
          const entries = studentSlots?.get(ts.id) || []
          if (entries.length) {
            return `
        <tr>
          <td class="per">${i + 1}</td>
          <td class="tim">${ts.start}–${ts.end}</td>
          <td>${entries.map((e) => e.teacher?.name || '—').join(' / ')}</td>
          <td>${entries.map((e) => e.room?.name || '—').join(' / ')}</td>
          <td>${entries.map((e) => e.subject?.name || '—').join(' / ')}</td>
          <td>${entries.map((e) => e.remarks || '—').join(' / ')}</td>
        </tr>`
          } else {
            return `
        <tr>
          <td class="per">${i + 1}</td>
          <td class="tim">${ts.start}–${ts.end}</td>
          <td class="muted">—</td>
          <td class="muted">—</td>
          <td class="muted">—</td>
          <td class="muted">—</td>
        </tr>`
          }
        })
        .join('')

      return `
  <div class="student-card">
    <div class="card-header">STUDENT'S SCHEDULE ${statusBadge}</div>
    <div class="card-info">
      <div class="card-info-cell">
        <div class="cell-label">Name</div>
        <div class="cell-value">${student.name || '—'}</div>
      </div>
      <div class="card-info-cell">
        <div class="cell-label">English Name</div>
        <div class="cell-value">${student.englishName || '—'}</div>
      </div>
      ${
        getPrintDate(selectedDate)
          ? `
      <div class="card-info-cell">
        <div class="cell-label">Date</div>
        <div class="cell-value red">${getPrintDate(selectedDate)}</div>
      </div>`
          : ''
      }
    </div>
    <table>
      <thead>
        <tr>
          <th>NO.</th><th>TIME</th><th>TEACHER</th>
          <th>CUBICLE/ROOM</th><th>SUBJECT</th><th>REMARKS</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`
    }

    // Split all students into chunks of 6 (one page per chunk)
    const pages = []
    for (let i = 0; i < allStudents.length; i += 6) {
      const chunk = allStudents.slice(i, i + 6)
      const cards = chunk.map(buildCard)
      while (cards.length < 6) cards.push('<div class="student-card empty"></div>')
      pages.push(`
      <div class="print-grid">
        ${cards.join('')}
      </div>`)
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>All Student Schedules — ${formatDateShort(selectedDate)}</title>
  <style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  @page { size: A4 landscape; margin: 5mm; }

  .print-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 2.5mm;
    width: 100%;
    height: 100vh;
    page-break-after: always;
  }
  .print-grid:last-child { page-break-after: avoid; }

  .student-card { border: 2px solid #000; overflow: hidden; break-inside: avoid; display: flex; flex-direction: column; }
  .student-card.empty { background: #f0f0f0 !important; }
  .card-header { display: flex; align-items: center; justify-content: center; gap: 3px; font-weight: 900; font-size: 7pt; letter-spacing: 0.1em; padding: 1mm 2mm; border-bottom: 2px solid #000; background: #cccccc !important; flex-shrink: 0; color: #000 !important; }
  .card-info { display: flex; border-bottom: 2px solid #000; flex-shrink: 0; }
  .card-info-cell { flex: 1; padding: 0.8mm 1.5mm; border-right: 1.5px solid #000; }
  .card-info-cell:last-child { border-right: none; }
  .cell-label { font-size: 5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #000 !important; }
  .cell-value { font-weight: 900; font-size: 6pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #000 !important; }
  .cell-value.red { color: #cc0000 !important; }
  table { width: 100%; border-collapse: collapse; flex: 1; }
  thead tr { background: #000 !important; }
  th { text-align: center; padding: 1mm 0.3mm; font-size: 5pt; letter-spacing: 0.05em; font-weight: 800; color: #ffffff !important; background: #000 !important; border: 1px solid #000; }
  td { border: 1px solid #000; text-align: center; padding: 0.5mm 0.3mm; vertical-align: middle; font-size: 5.5pt; line-height: 1.3; color: #000 !important; }
  td.per { background: #bbbbbb !important; font-weight: 900; font-size: 7pt; width: 5mm; color: #000 !important; border: 1px solid #000; }
  td.tim { font-weight: 800; white-space: nowrap; font-size: 5pt; color: #000 !important; }
  td.muted { color: #777 !important; }
  .bdg-new { font-size: 5pt; font-weight: 900; background: #bbf7d0 !important; color: #14532d !important; border: 1px solid #166534; padding: 0.2mm 1.5mm; border-radius: 99px; }
  .bdg-ext { font-size: 5pt; font-weight: 900; background: #e9d5ff !important; color: #581c87 !important; border: 1px solid #6b21a8; padding: 0.2mm 1.5mm; border-radius: 99px; }
  .bdg-chg { font-size: 5pt; font-weight: 900; background: #fecaca !important; color: #7f1d1d !important; border: 1px solid #991b1b; padding: 0.2mm 1.5mm; border-radius: 99px; }
  </style>
</head>
<body>
  ${pages.join('')}
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body>
</html>`

    const win = window.open('', '_blank', 'width=1200,height=800')
    win.document.write(html)
    win.document.close()
  }

  onMount(loadData)
</script>

<!-- ═══════════════════════════════════════════════════ SCREEN ═ -->
<div class="p-2 sm:p-4 md:p-6 bg-base-100 min-h-screen">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3 mb-5 bg-base-200 border border-base-300 rounded-xl p-3 shadow-sm">
    <div class="flex items-center gap-2">
      <span class="text-xs font-bold tracking-widest uppercase text-base-content/50">Date</span>
      <input
        type="date"
        class="input input-bordered input-sm w-36"
        value={selectedDate}
        onchange={async (e) => {
          selectedDate = e.target.value
          await loadData()
        }}
        disabled={isLoading}
      />
    </div>

    {#if !isLoading}
      <span class="badge badge-neutral font-bold">
        {allStudents.length} student{allStudents.length !== 1 ? 's' : ''} available
      </span>
      {#if todayHoliday}
        <span class="badge badge-warning font-semibold gap-1">🎉 {todayHoliday.name}</span>
      {/if}
    {/if}

    <div class="ml-auto flex items-center gap-2">
      {#if isLoading}<span class="loading loading-spinner loading-sm text-primary"></span>{/if}
      <button
        class="btn btn-primary btn-sm gap-1.5"
        onclick={printSchedules}
        disabled={isLoading || selectedStudents.filter(Boolean).length === 0}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        Print ({selectedStudents.filter(Boolean).length})
      </button>
    </div>
    <button
      class="btn btn-secondary btn-sm gap-1.5"
      onclick={printAllSchedules}
      disabled={isLoading || allStudents.length === 0}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      Print All ({allStudents.length})
    </button>
  </div>

  <!-- 6 search slots -->
  {#if !isLoading}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      {#each slots as _, i}
        <div class="border-2 border-base-300 rounded-xl overflow-visible shadow-sm bg-base-100">
          <!-- Slot header -->
          <div class="flex items-center justify-between px-3 py-2 bg-base-200 border-b-2 border-base-300">
            <span class="text-xs font-extrabold tracking-widest text-base-content/60">SLOT {i + 1}</span>
            {#if selectedStudents[i]}
              <button class="btn btn-ghost btn-xs text-error" onclick={() => clearSlot(i)}>✕ Clear</button>
            {/if}
          </div>

          <div class="p-3 relative">
            <!-- Search input — always visible -->
            <input
              type="text"
              class="input input-bordered input-sm w-full"
              placeholder="Search student name…"
              value={queries[i]}
              oninput={(e) => {
                queries = queries.map((v, j) => (j === i ? e.target.value : v))
                if (!e.target.value) clearSlot(i)
              }}
              disabled={isLoading}
            />

            <!-- Dropdown suggestions -->
            {#if suggestions[i].length > 0}
              <ul
                class="absolute z-50 mt-1 w-[calc(100%-1.5rem)] bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-48 overflow-y-auto"
              >
                {#each suggestions[i] as s}
                  <li>
                    <button
                      class="w-full text-left px-3 py-2 text-sm hover:bg-base-200 flex items-center gap-2"
                      onclick={() => pickStudent(i, s)}
                    >
                      <span class="font-bold truncate">{s.englishName || s.name}</span>
                      {#if s.englishName && s.name}
                        <span class="text-base-content/40 text-xs truncate">{s.name}</span>
                      {/if}
                      {#if s.status === 'new'}<span class="badge badge-success badge-xs ml-auto">New</span>{/if}
                      {#if s.status === 'extended'}<span class="badge badge-secondary badge-xs ml-auto">Ext</span>{/if}
                      {#if s.status === 'changed'}<span class="badge badge-error badge-xs ml-auto">Chg</span>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            <!-- Selected student preview card -->
            {#if selectedStudents[i]}
              {@const student = selectedStudents[i]}
              {@const studentSlots = scheduleMap.get(student.id)}
              <div class="mt-3 border border-base-300 rounded-lg overflow-hidden">
                <div class="flex items-center gap-2 px-3 py-1.5 bg-base-200 border-b border-base-300">
                  <span class="text-xs font-extrabold tracking-widest">STUDENT'S SCHEDULE</span>
                  {#if student.status === 'new'}<span class="badge badge-success badge-xs">New</span>{/if}
                  {#if student.status === 'extended'}<span class="badge badge-secondary badge-xs">Extended</span>{/if}
                  {#if student.status === 'changed'}<span class="badge badge-error badge-xs">Changed</span>{/if}
                </div>
                <div class="flex divide-x divide-base-300 border-b border-base-300 text-xs">
                  <div class="flex flex-col gap-0.5 px-2 py-1 flex-1 min-w-0">
                    <span class="text-[9px] font-bold uppercase text-base-content/40">Name</span>
                    <span class="font-bold truncate">{student.name || '—'}</span>
                  </div>
                  <div class="flex flex-col gap-0.5 px-2 py-1 flex-1 min-w-0">
                    <span class="text-[9px] font-bold uppercase text-base-content/40">English Name</span>
                    <span class="font-bold truncate">{student.englishName || '—'}</span>
                  </div>
                  <div class="flex flex-col gap-0.5 px-2 py-1 flex-1 min-w-0">
                    <span class="text-[9px] font-bold uppercase text-base-content/40">Date</span>
                    <span class="font-bold text-error">{formatDateShort(selectedDate)}</span>
                  </div>
                </div>
                <div class="overflow-x-auto">
                  <table class="table table-xs w-full min-w-[420px] border-collapse">
                    <thead>
                      <tr class="bg-neutral text-neutral-content text-[10px] tracking-widest">
                        <th class="text-center w-6">NO.</th>
                        <th class="text-center w-20">TIME</th>
                        <th class="text-center">TEACHER</th>
                        <th class="text-center">ROOM</th>
                        <th class="text-center">SUBJECT</th>
                        <th class="text-center">REMARKS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each cachedTimeslots as ts, ti}
                        {@const entries = studentSlots?.get(ts.id) || []}
                        <tr class={ti % 2 === 0 ? 'bg-base-100' : 'bg-base-200'}>
                          <td class="text-center font-extrabold border border-base-300 bg-base-200">{ti + 1}</td>
                          <td class="text-center font-semibold border border-base-300 whitespace-nowrap"
                            >{ts.start} – {ts.end}</td
                          >
                          <td class="text-center border border-base-300">
                            {#if entries.length}{#each entries as e}<div class="font-bold">
                                  {e.teacher?.name || '—'}
                                </div>{/each}
                            {:else}<span class="text-base-content/20">—</span>{/if}
                          </td>
                          <td class="text-center border border-base-300">
                            {#if entries.length}{#each entries as e}<div class="font-bold">
                                  {e.room?.name || '—'}
                                </div>{/each}
                            {:else}<span class="text-base-content/20">—</span>{/if}
                          </td>
                          <td class="text-center border border-base-300">
                            {#if entries.length}{#each entries as e}<div class="font-semibold">
                                  {e.subject?.name || '—'}
                                </div>{/each}
                            {:else}<span class="text-base-content/20">—</span>{/if}
                          </td>
                          <td class="text-center border border-base-300">
                            {#if entries.length}{#each entries as e}<div class="font-bold">
                                  {e.remarks || '—'}
                                </div>{/each}
                            {:else}<span class="text-base-content/20">—</span>{/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {:else}
              <div
                class="mt-3 flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-base-300 text-base-content/30 text-sm"
              >
                No student selected
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="flex justify-center py-20">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {/if}
</div>
