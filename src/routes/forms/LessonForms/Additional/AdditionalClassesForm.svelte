<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { current, pb } from '../../../../lib/Pocketbase.svelte'

  let AdditionalClassesData = $state({
    date_of_application: '',
    full_name: '',
    english_name: '',
    course: '',
    type_of_classes: '',
    class_subject: '',
    weeks: '',
    start_time: '',
    end_time: '',
    teacher_name: '',
  })

  const additionalclasses = async (e) => {
    e.preventDefault()

    toast.promise(pb.collection('additionalclassesForm').create(AdditionalClassesData), {
      loading: 'Loading...',
      success: (record) => {
        AdditionalClassesData = {
          date_of_application: '',
          full_name: '',
          english_name: '',
          course: '',
          type_of_classes: '',
          class_subject: '',
          weeks: '',
          start_time: '',
          end_time: '',
          teacher_name: '',
        }
        return record?.full_name + ' has successfully submitted a Course change request form! 🎉'
      },
      error: (error) => {
        console.error(error.message)
        return `Error: ${error.message}`
      },
    })
  }
</script>

<div class="breadcrumbs text-sm font-mono">
  <ul>
    <li><a href="/#/dashboard/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/request/" class="badge badge-secondary">Request Form</a></li>
    <li><span class="badge badge-neutral">Additional Classes Form</span></li>
  </ul>
</div>

<div class="font-[inter] flex flex-col items-center justify-center">
  <form onsubmit={additionalclasses} class="max-w-md font-mono">
    <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
      <legend class="fieldset-legend text-xl text-accent">Additional Classes Form</legend>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Date of Application</label>
      <input
        type="date"
        name="date_of_application"
        class="input w-full"
        bind:value={AdditionalClassesData.date_of_application}
        required
      />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Full Name (First Name, Last Name)</label>
      <input
        type="text"
        name="full_name"
        class="input w-full"
        placeholder="e.g John Doe"
        bind:value={AdditionalClassesData.full_name}
        required
      />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">English Name</label>
      <input
        type="text"
        name="english_name"
        class="input w-full"
        placeholder="e.g John"
        bind:value={AdditionalClassesData.english_name}
        required
      />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Course</label>
      <input type="text" name="course" class="input w-full" bind:value={AdditionalClassesData.course} required />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Type of Class</label>
      <select name="type_of_classes" class="select w-full" bind:value={AdditionalClassesData.type_of_classes} required>
        <option disabled selected value="">Select Type of Class</option>
        <option value="Man to Man" class="option">Man to Man</option>
        <option value="Small Group" class="option">Small Group</option>
        <option value="Big Group" class="option">Big Group</option>
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Class Subject</label>
      <input
        type="text"
        name="class_subject"
        class="input w-full"
        placeholder="e.g English, Math"
        bind:value={AdditionalClassesData.class_subject}
        required
      />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Week(s)</label>
      <input
        type="text"
        name="weeks"
        class="input w-full"
        placeholder="e.g 1, 2, 3"
        bind:value={AdditionalClassesData.weeks}
        required
      />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Start</label>
      <input
        type="time"
        name="start_time"
        class="input w-full"
        bind:value={AdditionalClassesData.start_time}
        required
      />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">End</label>
      <input type="time" name="end_time" class="input w-full" bind:value={AdditionalClassesData.end_time} required />

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Request Teacher</label>
      <input
        type="text"
        name="teacher_name"
        class="input w-full"
        placeholder="e.g John Doe"
        bind:value={AdditionalClassesData.teacher_name}
        required
      />

      <h1 class="justify text-center font-semibold mt-2">Additional Class Policy</h1>
      <p class="text-sm text-gray-400">
        1.The payment has to be made within one (1) week from the date of application.<br />
        2.The application will be automatically cancelled if there is no payment made before the deadline.<br />
        3.The school will not guarantee that all your requests will be granted.<br />
        4.The same refund policy as the course cancellation will be applied to the cancellation of additional class.
        <br />
      </p>

      <div class="mt-4 text-center">
        <button type="submit" class="btn btn-success">Submit</button>
      </div>
    </fieldset>
  </form>
</div>
