<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { current, pb } from '../../../../lib/Pocketbase.svelte'
  import fieldset from 'daisyui/components/fieldset'
  import input from 'daisyui/components/input'

  const data = $state({
    user: current.user?.id || '',
    current_period: '',
    teacher_name: '',
    subject: '',
    reason: '',
    change_period: '',
    request: '',
  })

  const teacherrequest = async (e) => {
    e.preventDefault()

    toast.promise(pb.collection('TeacherRequestForm').create(data), {
      loading: 'Loading...',
      success: (record) => {
        Object.assign(data, {
          current_period: '',
          teacher_name: '',
          subject: '',
          reason: '',
          change_period: '',
          request: '',
        })
        return record?.full_name + ' has successfully submitted a request form! 🎉'
      },
      error: (error) => {
        console.error(error.message)
        return `Error: ${error.message}`
      },
    })
  }
</script>

<div class="breadcrumbs text-sm">
  <ul>
    <li><a href="/#/dashboard/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/request/" class="badge badge-secondary">Request Form</a></li>
    <li><span>Teacher Request Form</span></li>
  </ul>
</div>

<form onsubmit={teacherrequest} class="font-[inter] m-2 max-w-xl mx-auto">
  <!-- svelte-ignore component_name_lowercase -->
  <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend">Change of Teacher Request Form</legend>
    <h1 class="mt-5 font-semibold">CURRENT SCHEDULE</h1>

    <legend class="legend"
      >What period is the class that you want to change? <br />Please select the current period that you want to change
      to a new period.</legend
    >
    <select class="select w-full" bind:value={data.current_period} required>
      <option disabled selected>Schedule Periods</option>
      <option value="1st Period (8:00-8:50)" class="option">1st Period (8:00-8:50)</option>
      <option value="2nd Period (9:00-9:50)" class="option">2nd Period (9:00-9:50)</option>
      <option value="3rd Period (10:00-10:50)" class="option">3rd Period (10:00-10:50)</option>
      <option value="4th Period (11:00-11:50)" class="option">4th Period (11:00-11:50)</option>
      <option value="5th Period (12:00-12:50)" class="option">5th Period (12:00-12:50)</option>
      <option value="6th Period (13:00-13:50)" class="option">6th Period (13:00-13:50)</option>
      <option value="7th Period (14:00-14:50)" class="option">7th Period (14:00-14:50)</option>
      <option value="8th Period (15:00-15:50)" class="option">8th Period (15:00-15:50)</option>
      <option value="9th Period (16:00-16:50)" class="option">9th Period (16:00-16:50)</option>
      <option value="10th Period (17:00-17:50)" class="option">10th Period (17:00-17:50)</option>
      <option value="11th Period (18:00-18:50)" class="option">11th Period (18:00-18:50)</option>
      <option value="12th Period (19:00-19:50)" class="option">12th Period (19:00-19:50)</option>
    </select>

    <label class="label">Name of the Teacher</label>
    <input type="text" class="input w-full" placeholder="e.g Sam Smith" bind:value={data.teacher_name} required />
    <label class="label">Subject</label>
    <input type="text" class="input w-full" placeholder="e.g Power speaking" bind:value={data.subject} required />
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class="label">Reason of Requesting Change of Teacher <br /> Please write down the reason of change.</label>
    <textarea
      class="textarea textarea-bordered w-full"
      placeholder="(e.g I want to try another teacher. I want to change the time schedule.)"
      bind:value={data.reason}
      required
    ></textarea>
    <h1 class="mt-5 font-semibold">REQUESTING SCHEDULE <br /> Please note that not all requests will be granted.</h1>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class="label"
      >The Period You Want to Change to <br />Please select the new period you want to change to.</label
    >
    <select class="select w-full" bind:value={data.change_period} required>
      <option disabled selected>Schedule Periods</option>
      <option value="1st Period (8:00-8:50)" class="option">1st Period (8:00-8:50)</option>
      <option value="2nd Period (9:00-9:50)" class="option">2nd Period (9:00-9:50)</option>
      <option value="3rd Period (10:00-10:50)" class="option">3rd Period (10:00-10:50)</option>
      <option value="4th Period (11:00-11:50)" class="option">4th Period (11:00-11:50)</option>
      <option value="5th Period (12:00-12:50)" class="option">5th Period (12:00-12:50)</option>
      <option value="6th Period (13:00-13:50)" class="option">6th Period (13:00-13:50)</option>
      <option value="7th Period (14:00-14:50)" class="option">7th Period (14:00-14:50)</option>
      <option value="8th Period (15:00-15:50)" class="option">8th Period (15:00-15:50)</option>
      <option value="9th Period (16:00-16:50)" class="option">9th Period (16:00-16:50)</option>
      <option value="10th Period (17:00-17:50)" class="option">10th Period (17:00-17:50)</option>
      <option value="11th Period (18:00-18:50)" class="option">11th Period (18:00-18:50)</option>
      <option value="12th Period (19:00-19:50)" class="option">12th Period (19:00-19:50)</option>
    </select>
    <label class="label">Any Request</label>
    <input type="text" class="input w-full" placeholder="" bind:value={data.request} required />

    <div class="mt-4 text-center">
      <button type="submit" class="btn btn-success">Submit</button>
    </div>
  </fieldset>
</form>
