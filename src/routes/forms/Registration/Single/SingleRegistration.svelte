<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  const data = $state({
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
    password: '',
    passwordConfirm: '',
  })

  $effect(() => {
    data.username = data.firstName + data.dob.split('-').pop()
    data.password = data.username
    data.passwordConfirm = data.username

    if (data.username) {
      console.log(data)
    }
  })

  const register = async (e) => {
    e.preventDefault()
    // console.log(data)

    toast.promise(pb.collection('users').create(data), {
      loading: 'Loading...',
      success: (record) => {
        return record?.firstName + ' has been successfully registered! 🎉'
      },
      error: (error) => {
        console.error(error.message)
        return `Error: ${error.message}`
      },
    })
  }
</script>

<div class="breadcrumbs text-sm m-5">
  <ul>
    <li><a href="/#/dashboard/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/registration/" class="badge badge-secondary">Registration</a></li>
    <li><span>Single Registration</span></li>
  </ul>
</div>

<form class="font-[inter] m-2 max-w-xl mx-auto" onsubmit={register}>
  <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
    <legend class="fieldset-legend">Registration</legend>

    <div class="flex flex-wrap justify-evenly gap-2">
      <div class="col-1">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">First Name</legend>
          <input type="text" class="input" bind:value={data.firstName} required />
          <p class="label">e.g John</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Nick Name</legend>
          <input type="text" class="input" bind:value={data.nickName} required />
          <p class="label">e.g Doedoe</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Gender</legend>
          <select class="select" bind:value={data.gender} required>
            <option value="male" class="option">Male</option>
            <option value="female" class="option">Female</option>
          </select>
          <p class="label">e.g Male or Female</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Nationality</legend>
          <select class="select" bind:value={data.nationality}>
            <option value="JP" class="option">JP</option>
            <option value="CH" class="option">CH</option>
            <option value="TH" class="option">TH</option>
            <option value="KR" class="option">KR</option>
            <option value="RU" class="option">RU</option>
            <option value="VN" class="option">VN</option>
            <option value="ARB" class="option">ARB</option>
            <option value="MNG" class="option">MNG</option>
            <option value="TW" class="option">TW</option>
          </select>
          <p class="label">e.g Japanese, Thai</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Height</legend>
          <input type="text" class="input" bind:value={data.height} required />
          <p class="label">height (cm)</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Home Address</legend>
          <input type="text" class="input" bind:value={data.homeAddress} required />
          <p class="label">e.g No. 111, ABC street, ABC ward</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Country</legend>
          <input type="text" class="input" bind:value={data.country} required />
          <p class="label">e.g Japan</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Email</legend>
          <input type="text" class="input" bind:value={data.email} required />
          <p class="label">e.g example@gmail.com</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Passport Number</legend>
          <input type="text" class="input" bind:value={data.passportNumber} required />
          <p class="label">e.g A*******</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Emergency 1</legend>
          <input type="text" class="input" bind:value={data.emergency1} required />
          <p class="label">e.g john Doe +09******</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Your School/Company (optional)</legend>
          <input type="text" class="input" bind:value={data.schoolOrCompany} required />
          <p class="label">e.g ABC college, ABC company</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Blood Type</legend>
          <select name="blood_type" class="select" bind:value={data.bloodType}>
            <option disabled selected>Select blood type</option>
            <option value="A" class="option">A</option>
            <option value="B" class="option">B</option>
            <option value="O" class="option">O</option>
            <option value="AB" class="option">AB</option>
            <option value="不明" class="option">不明</option>
          </select>
          <p class="label">e.g A, B, O, AB, 不明</p>
        </fieldset>
      </div>

      <div class="col-2">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Last Name</legend>
          <input type="text" class="input" bind:value={data.lastName} required />
          <p class="label">e.g Doe</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Middle Name</legend>
          <input type="text" class="input" bind:value={data.middleName} required />
          <p class="label">e.g Doe</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Age</legend>
          <input type="text" class="input" bind:value={data.age} required />
          <p class="label">e.g 12, 20, 25</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Date of Birth</legend>
          <input type="date" class="input" bind:value={data.dob} required />
          <p class="label">input your birth date</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Weight</legend>
          <input type="text" class="input" bind:value={data.weight} required />
          <p class="label">weight (kg)</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Civil Status</legend>
          <select class="select" bind:value={data.civilStatus}>
            <option value="single" class="option">Single</option>
            <option value="married" class="option">Married</option>
          </select>
          <p class="label">e.g single or married</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Zip Code</legend>
          <input type="text" class="input" bind:value={data.zipCode} required />
          <p class="label">e.g 123-4567</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">City</legend>
          <input type="text" class="input" bind:value={data.city} required />
          <p class="label">e.g Tokyo</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Mobile Number in Philippines</legend>
          <input type="text" class="input" bind:value={data.phone} required />
          <p class="label">e.g 09*********</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Emergency 2</legend>
          <input type="text" class="input" bind:value={data.emergency2} required />
          <p class="label">e.g Sam Smith +09******</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Occupation/Profession</legend>
          <input type="text" class="input" bind:value={data.occupation} required />
          <p class="text-wrap max-w-[200px]">e.g. student, office worker, etc</p>
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">SNS Permission</legend>
          <input type="checkbox" bind:checked={data.snsPermission} class="checkbox" />
          <p class="text-wrap max-w-[200px]">
            Do you permit GLC to post photos/videos that you are appeared on our social media accounts? * If it is
            "No",we will put mosaic or sticker on your face.
          </p>
        </fieldset>
      </div>
    </div>

    <div class="flex justify-end m-2">
      <button type="submit" class="btn btn-primary">Submit</button>
    </div>
  </fieldset>
</form>
