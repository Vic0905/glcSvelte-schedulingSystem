<script>
  import { pb } from '../../../lib/Pocketbase.svelte'
  import { toast } from 'svelte-sonner'

  let { onrefresh, selectedDate } = $props()

  let dialogEl = $state()
  let isLoading = $state(false)
  let name = $state('CLEAR DAY')

  export function open() {
    name = 'CLEAR DAY'
    dialogEl?.showModal()
  }

  function close() {
    dialogEl?.close()
  }

  async function handleSubmit() {
    isLoading = true
    try {
      await pb.collection('holiday').create({
        name,
        date: `${selectedDate} 00:00:00.000Z`,
      })
      toast.success(`"${name}" added for ${selectedDate}`)
      close()
      onrefresh?.()
    } catch (err) {
      console.error(err)
      toast.error('Failed to create holiday record')
    } finally {
      isLoading = false
    }
  }
</script>

<dialog bind:this={dialogEl} class="modal">
  <div class="modal-box">
    <h3 class="font-bold text-lg mb-4">Clear Day</h3>

    <div class="form-control mb-4">
      <label class="label" for="clear-day-name">
        <span class="label-text">Name</span>
      </label>
      <input
        id="clear-day-name"
        type="text"
        class="input input-bordered w-full"
        bind:value={name}
        disabled={isLoading}
      />
    </div>

    <div class="form-control mb-6">
      <label class="label">
        <span class="label-text">Date</span>
      </label>
      <input type="text" class="input input-bordered w-full" value={selectedDate} disabled />
    </div>

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={close} disabled={isLoading}>Cancel</button>
      <button class="btn btn-error" onclick={handleSubmit} disabled={isLoading || !name.trim()}>
        {#if isLoading}
          <span class="loading loading-spinner loading-sm"></span>
        {/if}
        Clear Day
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
