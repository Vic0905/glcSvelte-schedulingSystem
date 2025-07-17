<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  const studentData = $state({
    email: '',
    emailVisibility: true,
    role: 'student',
    username: '',
    firstName: '',
    lastName: '',
    nickName: '',
    middleName: '',
    gender: '',
    age: '',
    dob: '',
    nationality: '',
    height: '',
    weight: '',
    civilStatus: '',
    homeAddress: '',
    zipCode: '',
    country: '',
    city: '',
    phone: '',
    passportNumber: '',
    emergency1: '',
    emergency2: '',
    occupation: '',
    schoolOrCompany: '',
    allergy: '',
    medicalHistory: '',
    snsPermission: '',
    bloodType: '',
    bloodType_copy: '',
    password: '',
    passwordConfirm: '',
  })

  $effect(() => {
    studentData.username = studentData.firstName + studentData.dob.split('-').pop()
    studentData.password = studentData.username
    studentData.passwordConfirm = studentData.username

    if (studentData.username) {
      console.log(studentData)
    }
  })

  const register = async (e) => {
    e.preventDefault()
    console.log(studentData)

    // toast.promise(pb.collection('users').create(studentData), {
    //   loading: 'Loading...',
    //   success: (record) => {
    //     return record?.first_name + ' has been successfully registered! 🎉'
    //   },
    //   error: (error) => {
    //     console.error(error.message)
    //     return `Error: ${error.message}`
    //   },
    // })
  }
</script>

<div class="breadcrumbs text-sm m-5">
  <ul>
    <li><a href="/#/dashboard/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/registration/" class="badge badge-secondary">Registration</a></li>
    <li><span>Single Registration</span></li>
  </ul>
</div>

<div class="font-[inter] flex flex-col items-center justify-center m-2">
  <form onsubmit={register}>
    <fieldset class="fieldset bg-base-200 border-base-300 rounded-box max-w-xl border p-4">
      <legend class="fieldset-legend">Registration</legend>

      <div class="flex flex-wrap justify-evenly gap-2">
        <div class="col-1">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Page title</legend>
            <input type="text" class="input" placeholder="My awesome page" />
            <p class="label">You can edit page title later on from settings</p>
          </fieldset>
        </div>
        <div class="col-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Page title</legend>
            <input type="text" class="input" placeholder="My awesome page" />
            <p class="label">You can edit page title later on from settings</p>
          </fieldset>
        </div>
      </div>
    </fieldset>
  </form>
</div>
