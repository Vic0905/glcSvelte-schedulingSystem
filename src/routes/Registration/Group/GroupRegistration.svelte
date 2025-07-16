<script>
    import { onMount } from 'svelte';
    import { toast } from "svelte-sonner";
    import { pb } from '../../../lib/Pocketbase.svelte'

    let GroupStudentData = $state({
        "school_name": "",
        "email": "",
        "first_name": "", 
        "last_name": "",
        "nickname": "",
        "gender": "",
        "blood_type": "",
        "dob": "",
        "nationality": "",
        "height": "",
        "weight": "",
        "civil_status": "",
        "home_address": "",
        "country": "",
        "allergy": "",
        "allergy2": "",
        "sns_permission": ""
    });

    const groupregister = async (e) => {
        e.preventDefault();

    toast.promise(pb.collection('GroupRegistration').create(GroupStudentData), {
        loading: 'Loading...',
        success: (record) => {
            GroupStudentData = {
                "school_name": "",
                "email": "",
                "first_name": "",
                "last_name": "",
                "nickname": "",
                "gender": "",
                "blood_type": "",
                "dob": "",
                "nationality": "",
                "height": "",
                "weight": "",
                "civil_status": "",
                "home_address": "",
                "country": "",
                "allergy": "",
                "allergy2": "",
                "sns_permission": ""
            }
                return record?.first_name + " has been successfully registered! 🎉";
        },
        error: (error) => {
            console.error(error.message);
            return `Error: ${error.message}`;
        },
    });
}

</script>

<div class="breadcrumbs text-sm font-mono">
  <ul>
    <li><a href="/#/dashboard/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/registration/" class="badge badge-secondary">Registration</a></li>
    <li><span class="badge badge-neutral">Group Registration</span></li>
  </ul>
</div>

<div class="font-[inter] flex flex-col items-center justify-center">
  <form onsubmit="{groupregister}" class="max-w-md font-mono">
    <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
      <legend class="fieldset-legend text-xl text-accent">Group Student Registration Form</legend>

      <label class="label">学校名 * 学校名をローマ字で書いてください。</label>
      <input type="text" name="school_name" class="input w-full" placeholder="e.g Tokyo Daigaku, Osaka Koukou" bind:value={GroupStudentData.school_name} required/>

      <label class="label">メールアドレス</label>
      <input type="email" name="email" class="input w-full" placeholder="e.g email@gmail.com" bind:value={GroupStudentData.email} required/>

      <label class="label">名前（下の名前）ローマ字で</label>
      <input type="text" name="first_name" class="input w-full" placeholder="名前（例）Hanako、Taro" bind:value={GroupStudentData.first_name} required/>

      <label class="label">名前（名字）ローマ字で</label>
      <input type="text" name="last_name" class="input w-full" placeholder="名字（例）Tanaka、 Smithなど" bind:value={GroupStudentData.last_name} required/>

      <label class="label">Nick Name（ニックネーム）</label>
      <input type="text" name="nickname" class="input w-full" placeholder="フィリピンの講師が呼びやすいニックネームを書いてください" bind:value={GroupStudentData.nickname} required/>

      <label class="label">Gender(性別)</label>
        <select name="gender" class="select w-full" bind:value={GroupStudentData.gender} required>
            <option disabled selected>Select your Gender</option>
            <option value="male" class="option">Male</option>
            <option value="female" class="option">Female</option>
        </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Blood Type(血液型)</label>
        <select name="blood_type" class="select w-full" bind:value={GroupStudentData.blood_type} required>
            <option disabled selected>Select blood type</option>
            <option value="A" class="option">A</option>
            <option value="B" class="option">B</option>
            <option value="O" class="option">O</option>
            <option value="AB" class="option">AB</option>
            <option value="不明" class="option">不明</option>
        </select>

      <label class="label">Date of Birth 生年月日</label>
      <input type="date" name="dob" class="input w-full" bind:value={GroupStudentData.dob} required/>

      <label class="label">Nationality</label>
      <input type="text" name="nationality" class="input w-full" placeholder="国籍　例: Filipino, Chinese, Japanese" bind:value={GroupStudentData.nationality} required/>

      <label class="label">Height (cm)</label>
      <input type="text" name="height" class="input w-full" placeholder="身長 175 cm" bind:value={GroupStudentData.height} required/>

      <label class="label">Weight (kg)</label>
      <input type="text" name="weight" class="input w-full" placeholder="体重 50 kg" bind:value={GroupStudentData.weight} required/>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Civil Status <br> 婚姻有無（未婚ならSingleを選択</label>
      <select name="civil_status" class="select w-full" bind:value={GroupStudentData.civil_status} required>
        <option disabled selected>Select your Civil Status</option>
        <option value="single" class="option">Single</option>
        <option value="married" class="option">Married</option>
      </select>

      <label class="label">Address in your Home-country <br> 日本の住所を書いてください</label>
      <input type="text" name="home_address" class="input w-full" placeholder="e.g No. 111, ABC street, ABC ward" bind:value={GroupStudentData.home_address} required/>

      <label class="label">Your Home Country <br> 住んでいる国名を書いてください（例：Japan）</label>
      <input type="text" name="country" class="input w-full" placeholder="e.g Japan" bind:value={GroupStudentData.country} required/>

      <label class="label">Email</label>
      <input type="email" name="email" class="input w-full" placeholder="e.g sam@gmail.com" bind:value={GroupStudentData.email} required/>

       <!-- svelte-ignore a11y_label_has_associated_control -->
       <label class="label">Allergy</label>
        <select name="allergy" class="select w-full" bind:value={GroupStudentData.allergy} required>
            <option disabled selected>Select one</option>
            <option value="yes" class="option">Yes</option>
            <option value="no" class="option">No</option>
        </select>

      <label class="label">Allergy2 <br> アレルギー症状と対処法（例：かゆい→安静）</label>
     <textarea name="allergy2" class="textarea textarea-bordered w-full" placeholder="例：のどの腫れ → 病院に行く" bind:value={GroupStudentData.allergy2} required></textarea>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label">Allow posting your photos/videos on IDEA CEBU SNS? <br> IDEA CEBUのSNSに写真や動画を載せてもいいですか？ </label>
      <select name="sns_permission" class="select w-full" bind:value={GroupStudentData.sns_permission} required>
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
