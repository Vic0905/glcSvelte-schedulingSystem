<script>
  import { toast } from 'svelte-sonner'

  // ── Props ──────────────────────────────────────────────────────────────────
  let { formData = $bindable(), students = [], pb, isProcessing = $bindable(false), onSaved, onClose } = $props()

  // ── Helpers ────────────────────────────────────────────────────────────────
  const padId = (n) => String(n).padStart(5, '0')

  async function getNextStudentId() {
    try {
      const records = await pb.collection('student').getFullList({ fields: 'studentId' })
      const max = records.reduce((m, r) => Math.max(m, Number(r.studentId) || 0), 0)
      return max + 1
    } catch {
      return 1
    }
  }

  async function createStudentUser(englishName) {
    const trimmedName = englishName.trim()
    try {
      const existing = await pb.collection('users').getFirstListItem(`firstName="${trimmedName}"`)
      return existing.id
    } catch {
      // not found, continue to create
    }

    const base = trimmedName.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!base) return null
    let username = base
    let suffix = 1
    while (true) {
      try {
        await pb.collection('users').getFirstListItem(`username="${username}"`)
        username = `${base}${suffix++}`
      } catch {
        break
      }
    }

    try {
      const user = await pb.collection('users').create({
        username,
        email: `${username}@student.local`,
        emailVisibility: true,
        password: '00000000',
        passwordConfirm: '00000000',
        firstName: trimmedName,
        role: 'student',
      })
      return user.id
    } catch (err) {
      console.error('Failed to create user for', englishName, err)
      toast.error(`User creation failed: ${err?.response?.message || err.message}`)
      if (err?.response?.data) console.error(JSON.stringify(err.response.data))
      return null
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveStudent() {
    const trimmed = formData.englishName.trim()
    if (!trimmed) return toast.error('English Name is required')

    const id = formData.id
    const isChanged = formData.isChanged
    const isExtended = formData.isExtended
    const course = formData.course.trim()
    const start = formData.start || null
    const end = formData.end || null
    const color = formData.color || null

    isProcessing = true
    try {
      if (id && isChanged) {
        const original = students.find((s) => s.id === id)
        const nextId = await getNextStudentId()
        await pb.collection('student').create({
          studentId: padId(nextId),
          name: original.name,
          englishName: original.englishName,
          course,
          level: original.level,
          remarks: original.remarks,
          status: 'changed',
          start,
          end: original.end || null,
          color,
          user: original.user,
        })
        toast.success('New record created with changed course')
      } else if (id && isExtended) {
        const original = students.find((s) => s.id === id)
        const nextId = await getNextStudentId()
        await pb.collection('student').create({
          studentId: padId(nextId),
          name: original.name,
          englishName: original.englishName,
          course,
          level: original.level,
          remarks: original.remarks,
          status: 'extended',
          start,
          end,
          color,
          user: original.user,
        })
        toast.success('New record created with extended course and dates')
      } else {
        if (!id && students.some((s) => s.englishName?.toUpperCase() === trimmed.toUpperCase()))
          return toast.error(`"${trimmed}" already exists`)

        const nextId = !id ? await getNextStudentId() : null
        const payload = {
          ...(nextId !== null && { studentId: padId(nextId) }),
          name: formData.name.trim(),
          englishName: trimmed,
          course,
          level: formData.level.trim(),
          remarks: formData.remarks.trim(),
          status: formData.status,
          start,
          end,
          color,
        }

        if (id) {
          await pb.collection('student').update(id, payload)

          const original = students.find((s) => s.id === id)
          if (original?.user && original.englishName?.toLowerCase() !== trimmed.toLowerCase()) {
            const newBase = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
            if (newBase) {
              try {
                await pb.collection('users').update(original.user, {
                  firstName: trimmed,
                  username: newBase,
                })
              } catch (userErr) {
                console.warn('Could not sync username:', userErr)
                toast.warning('Student updated but username sync failed — username may already be taken')
              }
            }
          }
        } else {
          const newStudent = await pb.collection('student').create(payload)
          const userId = await createStudentUser(trimmed)
          if (userId) await pb.collection('student').update(newStudent.id, { user: userId })
        }

        toast.success(id ? 'Student updated' : 'Student added')
      }

      await onSaved?.()
    } catch (err) {
      toast.error(err?.status === 400 ? 'English Name already in use' : 'Unexpected error')
    } finally {
      isProcessing = false
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="modal modal-open bg-black/40" role="dialog" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal-box max-w-lg border border-base-300 p-6">
    <div class="flex justify-between items-center mb-6">
      <h3 class="font-bold text-xl">{formData.id ? 'Update' : 'Add'} Student</h3>
      <button class="btn btn-sm btn-circle btn-ghost" onclick={onClose}>✕</button>
    </div>

    <div class="flex flex-col gap-5">
      <!-- Primary Information -->
      <div>
        <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Primary Information</p>
        <div class="grid grid-cols-2 gap-4">
          <div class="form-control">
            <label class="label py-1" for="english-name">
              <span class="label-text font-semibold">
                English Name <span class="opacity-40 font-normal text-xs">(required)</span>
              </span>
            </label>
            <input
              id="english-name"
              bind:value={formData.englishName}
              type="text"
              disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
              class="input input-bordered w-full focus:input-primary disabled:opacity-50"
            />
          </div>
          <div class="form-control">
            <label class="label py-1" for="student-name">
              <span class="label-text font-semibold">
                Name <span class="opacity-40 font-normal text-xs">(optional)</span>
              </span>
            </label>
            <input
              id="student-name"
              bind:value={formData.name}
              type="text"
              disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
              class="input input-bordered w-full focus:input-primary disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <!-- Academic Information -->
      <div>
        <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Academic Information</p>
        <div class="grid grid-cols-3 gap-4">
          <div class="form-control">
            <label class="label py-1" for="course"><span class="label-text font-semibold">Course</span></label>
            <input
              id="course"
              bind:value={formData.course}
              type="text"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
          <div class="form-control">
            <label class="label py-1" for="level"><span class="label-text font-semibold">Level</span></label>
            <input
              id="level"
              bind:value={formData.level}
              type="text"
              disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
              class="input input-bordered w-full focus:input-primary disabled:opacity-50"
            />
          </div>
          <div class="form-control">
            <label class="label py-1" for="remarks"><span class="label-text font-semibold">Remarks</span></label>
            <input
              id="remarks"
              bind:value={formData.remarks}
              type="text"
              disabled={!!formData.id && (formData.isChanged || formData.isExtended)}
              class="input input-bordered w-full focus:input-primary disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <!-- Color (optional) -->
      <div>
        <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Color</p>
        {#if !formData.color}
          <button type="button" class="btn btn-sm btn-outline" onclick={() => (formData.color = '#4f8ef7')}>
            + Add Color
          </button>
        {:else}
          <div class="flex items-center gap-3 flex-wrap">
            <input
              id="student-color"
              bind:value={formData.color}
              type="color"
              class="w-12 h-10 rounded-lg border border-base-300 cursor-pointer p-0.5 bg-base-100"
            />
            <input
              type="text"
              value={formData.color}
              maxlength="7"
              class="input input-bordered input-sm w-28 font-mono text-sm focus:input-primary"
              placeholder="#4f8ef7"
              oninput={(e) => {
                const val = e.target.value
                if (/^#[0-9a-fA-F]{6}$/.test(val)) formData.color = val
              }}
              onblur={(e) => {
                if (!/^#[0-9a-fA-F]{6}$/.test(e.target.value)) e.target.value = formData.color
              }}
            />
            {#if typeof EyeDropper !== 'undefined'}
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-square"
                title="Pick color from screen"
                onclick={async () => {
                  try {
                    const dropper = new EyeDropper()
                    const result = await dropper.open()
                    formData.color = result.sRGBHex
                  } catch {}
                }}
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
                >
                  <path d="m2 22 1-1h3l9-9" />
                  <path d="M3 21v-3l9-9" />
                  <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8z" />
                </svg>
              </button>
            {/if}
            <span
              class="badge badge-lg font-medium"
              style="background:{formData.color}20; color:{formData.color}; border:none;"
            >
              <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style="background:{formData.color};"></span>
              {formData.englishName || 'Preview'}
            </span>
            <button type="button" class="btn btn-xs btn-ghost text-error" onclick={() => (formData.color = '')}>
              Remove
            </button>
          </div>
        {/if}
      </div>

      <!-- Edit Mode (only in edit, not add) -->
      {#if formData.id}
        <div class="rounded-lg border border-base-300 bg-base-200/50 px-4 py-3 flex flex-col gap-3">
          <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide">Edit Mode</p>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-error mt-0.5"
              checked={formData.isChanged}
              onchange={(e) => {
                formData.isChanged = e.target.checked
                if (e.target.checked) formData.isExtended = false
              }}
            />
            <div>
              <p class="font-semibold text-sm">Change</p>
              <p class="text-xs text-base-content/50">
                Creates a new record with an updated Course. Original is preserved.
              </p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-secondary mt-0.5"
              checked={formData.isExtended}
              onchange={(e) => {
                formData.isExtended = e.target.checked
                if (e.target.checked) formData.isChanged = false
              }}
            />
            <div>
              <p class="font-semibold text-sm">Extend</p>
              <p class="text-xs text-base-content/50">
                Creates a new record with updated Course, Start & End dates. Original is preserved.
              </p>
            </div>
          </label>
        </div>
      {/if}

      <!-- Start & End Dates -->
      <div class="grid grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label py-1" for="start-date"><span class="label-text font-semibold">Start Date</span></label>
          <input
            id="start-date"
            bind:value={formData.start}
            type="date"
            class="input input-bordered w-full focus:input-primary disabled:opacity-50"
          />
        </div>
        <div class="form-control">
          <label class="label py-1" for="end-date"><span class="label-text font-semibold">End Date</span></label>
          <input
            id="end-date"
            bind:value={formData.end}
            type="date"
            disabled={!!formData.id && formData.isChanged}
            class="input input-bordered w-full focus:input-primary disabled:opacity-50"
          />
        </div>
      </div>
    </div>

    <div class="modal-action mt-8 gap-2">
      <button class="btn btn-ghost px-6" onclick={onClose} disabled={isProcessing}>Cancel</button>
      <button class="btn btn-primary px-6 shadow-sm" onclick={saveStudent} disabled={isProcessing}>
        {#if isProcessing}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          {formData.id ? 'Save Changes' : 'Add Student'}
        {/if}
      </button>
    </div>
  </div>
</div>
