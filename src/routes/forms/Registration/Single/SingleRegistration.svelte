<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { pb } from '../../../../lib/Pocketbase.svelte'

  let studentData = $state({
    first_name: '',
    last_name: '',
    nickname: '',
    middle_name: '',
    gender: '',
    age: '',
    dob: '',
    nationality: '',
    height: '',
    weight: '',
    civil_status: '',
    home_address: '',
    zip_code: '',
    country: '',
    city: '',
    email: '',
    phone: '',
    passport_number: '',
    emergency_contact_1: '',
    emergency_contact_2: '',
    occupation: '',
    school_or_company: '',
    allergy: '',
    medical_history: '',
    sns_permission: '',
  })

  const register = async (e) => {
    e.preventDefault()

    toast.promise(pb.collection('Registration').create(studentData), {
      loading: 'Loading...',
      success: (record) => {
        studentData = {
          first_name: '',
          last_name: '',
          nickname: '',
          middle_name: '',
          gender: '',
          age: '',
          dob: '',
          nationality: '',
          height: '',
          weight: '',
          civil_status: '',
          home_address: '',
          zip_code: '',
          country: '',
          city: '',
          email: '',
          phone: '',
          passport_number: '',
          emergency_contact_1: '',
          emergency_contact_2: '',
          occupation: '',
          school_or_company: '',
          allergy: '',
          medical_history: '',
          sns_permission: '',
        }
        return record?.first_name + ' has been successfully registered! 🎉'
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
    <li><a href="/#/registration/" class="badge badge-secondary">Registration</a></li>
    <li><span class="badge badge-neutral">Single Registration</span></li>
  </ul>
</div>

<div class="font-[inter] flex flex-col items-center justify-center">
  <form onsubmit={register} class="max-w-md font-mono">
    <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
      <legend class="fieldset-legend text-xl text-accent">Student Registration Form</legend>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">First Name</label>
      <input
        type="text"
        name="first_name"
        class="input w-full"
        placeholder="e.g Junielvic"
        bind:value={studentData.first_name}
        required
      />

      <label class="label">Last Name</label>
      <input
        type="text"
        name="last_name"
        class="input w-full"
        placeholder="e.g Smith"
        bind:value={studentData.last_name}
        required
      />

      <label class="label">Nick Name</label>
      <input
        type="text"
        name="nickname"
        class="input w-full"
        placeholder="e.g Vic"
        bind:value={studentData.nickname}
        required
      />

      <label class="label">Middle Name</label>
      <input
        type="text"
        name="middle_name"
        class="input w-full"
        placeholder="e.g Rivervale"
        bind:value={studentData.middle_name}
        required
      />

      <label class="label">Gender</label>
      <select name="gender" class="select w-full" bind:value={studentData.gender} required>
        <option disabled selected>Select your Gender</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>

      <label class="label">Age</label>
      <input type="number" name="age" class="input w-full" placeholder="Age" bind:value={studentData.age} required />

      <label class="label">Date of Birth</label>
      <input type="date" name="dob" class="input w-full" bind:value={studentData.dob} required />

      <label class="label">Nationality</label>
      <select name="nationality" class="select w-full" bind:value={studentData.nationality} required>
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

      <label class="label">Height (cm)</label>
      <input
        type="number"
        name="height"
        class="input w-full"
        placeholder="175 cm"
        bind:value={studentData.height}
        required
      />

      <label class="label">Weight (kg)</label>
      <input
        type="number"
        name="weight"
        class="input w-full"
        placeholder="50 kg"
        bind:value={studentData.weight}
        required
      />

      <label class="label">Civil Status</label>
      <select name="civil_status" class="select w-full" bind:value={studentData.civil_status} required>
        <option disabled selected>Select Civil Status</option>
        <option value="single" class="option">Single</option>
        <option value="married" class="option">Married</option>
      </select>

      <label class="label">Address in your Home-country</label>
      <input
        type="text"
        name="home_address"
        class="input w-full"
        placeholder="e.g No. 111, ABC street, ABC ward"
        bind:value={studentData.home_address}
        required
      />

      <label class="label">Zip Code</label>
      <input
        type="text"
        name="zip_code"
        class="input w-full"
        placeholder="e.g 123-4567"
        bind:value={studentData.zip_code}
        required
      />

      <label class="label">Country</label>
      <input
        type="text"
        name="country"
        class="input w-full"
        placeholder="e.g Japan"
        bind:value={studentData.country}
        required
      />

      <label class="label">City</label>
      <input
        type="text"
        name="city"
        class="input w-full"
        placeholder="e.g Osaka, Tokyo, Fukuoka"
        bind:value={studentData.city}
        required
      />

      <label class="label">Email</label>
      <input
        type="email"
        name="email"
        class="input w-full"
        placeholder="e.g sam@gmail.com"
        bind:value={studentData.email}
        required
      />

      <label class="label">Phone number in PH</label>
      <input
        type="tel"
        name="phone"
        class="input w-full"
        placeholder="e.g 09123456789"
        bind:value={studentData.phone}
        required
      />

      <label class="label">Passport Number</label>
      <input
        type="text"
        name="passport_number"
        class="input w-full"
        placeholder="e.g A1234567890"
        bind:value={studentData.passport_number}
        required
      />

      <label class="label">Emergency Contact 1</label>
      <input
        type="text"
        name="emergency_contact_1"
        class="input w-full"
        placeholder="e.g Theressa Smith + 093123443"
        bind:value={studentData.emergency_contact_1}
        required
      />

      <label class="label">Emergency Contact 2</label>
      <input
        type="text"
        name="emergency_contact_2"
        class="input w-full"
        placeholder="e.g John Doe + 0912213323"
        bind:value={studentData.emergency_contact_2}
        required
      />

      <label class="label">Occupation/Profession</label>
      <input
        type="text"
        name="occupation"
        class="input w-full"
        placeholder="e.g Student, Teacher, Engineer"
        bind:value={studentData.occupation}
        required
      />

      <label class="label">Your School/Company (optional)</label>
      <input
        type="text"
        name="school_or_company"
        class="input w-full"
        placeholder="e.g GLC, ABC University, ABC Company"
        bind:value={studentData.school_or_company}
        required
      />

      <label class="label">Allergy</label>
      <input
        type="text"
        name="allergy"
        class="input w-full"
        placeholder="e.g Pollen, Dust, etc."
        bind:value={studentData.allergy}
        required
      />

      <label class="label">Medical History</label>
      <textarea
        name="medical_history"
        class="textarea textarea-bordered w-full"
        placeholder="e.g Asthma, Diabetes, etc."
        bind:value={studentData.medical_history}
      ></textarea>

      <label class="label">Allow us to post your photos/videos on SNS?</label>
      <select name="sns_permission" class="select w-full" bind:value={studentData.sns_permission} required>
        <option disabled selected>Select one</option>
        <option value="yes" class="option">Yes</option>
        <option value="no" class="option">No</option>
      </select>

      <div class="mt-4 text-center">
        <button type="submit" class="btn btn-success">Submit</button>
      </div>
    </fieldset>
  </form>
</div>
