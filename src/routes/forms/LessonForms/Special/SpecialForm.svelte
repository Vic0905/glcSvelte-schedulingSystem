<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { current, pb } from '../../../../lib/Pocketbase.svelte'

  let data = $state({
    user: current.user?.id || '',
    first_period: '',
    second_period: '',
    third_period: '',
    fourth_period: '',
    fifth_period: '',
    sixth_period: '',
    seventh_period: '',
    eighth_period: '',
  })

  const specialclasses = async (e) => {
    e.preventDefault()

    toast.promise(pb.collection('SpecialClassesForm').create(data), {
      loading: 'Loading...',
      success: (record) => {
        data = {
          first_period: '',
          second_period: '',
          third_period: '',
          fourth_period: '',
          fifth_period: '',
          sixth_period: '',
          seventh_period: '',
          eighth_period: '',
        }
        return record?.full_name + ' has successfully submitted a special classes form! 🎉'
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
    <li><span>Special Classes Form </span></li>
  </ul>
</div>

<div class="flex flex-col items-center justify-center">
  <form onsubmit={specialclasses} class="">
    <fieldset class="fieldset bg-base-200 border-base-300 rounded-box border p-4">
      <legend class="fieldset-legend text-xl text-accent">Special Classes Form</legend>

      <h1 class="flex justify-center mt-5 font-bold">
        Please Select the dropdown of the special class you wish to attend. (This registration will be effective next
        week.)
      </h1>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This Group class builds your vocabulary, grammar, and pronunciation by reading and watching the news. <br />
        You’ll learn how to understand headlines, guess word meanings, and scan for key information. <br />
        Topics include politics, health, science, and more—boosting your confidence in reading and listening to English news.
      </label>
      <select name="first_period" class="select w-full" bind:value={data.first_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="15:00 - 15:25 ⇢ NEWS ENGLISH (Group Classroom 2 [G2])" class="option"
          >15:00 - 15:25 ⇢ NEWS ENGLISH (Group Classroom 2 [G2])</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This is designed for students to learn and practice delivering their presentations <br />
        through various exercises or group works.It also aims to help students learn expressions in <br />
        line with every topic, grammar points and vocabulary to improve the students’ ability to communicate fluently,
        <br />
        and feel confident and comfortable when delivering their presentation.
      </label>
      <select name="second_period" class="select w-full" bind:value={data.second_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="15:30 - 15:55 ⇢ PRESENTATION DELIVERY (Group Classroom 2 [G2])" class="option"
          >15:30 - 15:55 ⇢ PRESENTATION DELIVERY (Group Classroom 2 [G2])</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This is designed to help student's understanding of the English grammar. It includes mastering the different <br
        />
        structures and aspects of grammar through interactive activities such as a real-life situation role play. <br />
        The students are also givendifferent types of tests to assess student's learning. Corrections and feedback
        <br />
        will be given to help students master the language.
      </label>
      <select name="third_period" class="select w-full" bind:value={data.third_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="16:00 - 16:25 ⇢ GRAMMAR REVIEW (Group Classroom 2 [G2] )" class="option"
          >16:00 - 16:25 ⇢ GRAMMAR REVIEW (Group Classroom 2 [G2] )</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This is designed to have a fun class while learning from the educational activities provided like quiz bee or
        mind games. <br />
        This is particularly good to create a friendly competition with each other with the goal of improving their English.
        <br />
        Though the students are having their classes from their countries, they can still gain friendship, sportsmanship,
        <br />
        and most of all knowledge of the English language.
      </label>
      <select name="fourth_period" class="select w-full" bind:value={data.fourth_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="16:30 - 16:55 ⇢ ENGLISH GAMES (Group Classroom 2 [G2] )" class="option"
          >16:30 - 16:55 ⇢ ENGLISH GAMES (Group Classroom 2 [G2] )</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        NEWS ENGLISH:In this group class, watching the news teaches you new words and phrases and educates you in proper
        pronunciation. <br />
        Reading the news increases your vocabulary and improves your grammar skills. By means of reading news articles, both
        printed and online, <br />
        this course aims to teach basic newspaper reading skills (e.g. how to read the headline and lead to get the main
        idea, <br />
        guess the meaning of unknown words, scan for specific information), explore and analyze current issues in various
        subjects <br />
        (e.g. politics, economics, social problems, environment, science, health), and stimulate students' interest in reading
        <br />
        English newspapers and magazines as well as listening to radio or TV news on their own.
      </label>
      <select name="fifth_period" class="select w-full" bind:value={data.fifth_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="17:00 - 17:25 ⇢ NEWS ENGLISH (Group Classroom 2 [G2] )" class="option"
          >17:00 - 17:25 ⇢ NEWS ENGLISH (Group Classroom 2 [G2] )</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This is designed to help student's understanding of the English grammar. It includes mastering the different
        structures and aspects <br />
        of grammar through interactive activities such as a real-life situation role play. The students are also given different
        types of <br />
        tests to assess student's learning. Corrections and feedback will be given to help students master the language.
      </label>
      <select name="sixth_period" class="select w-full" bind:value={data.sixth_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="17:30 - 17:55 ⇢ GRAMMAR REVIEW (Group Classroom 2 [G2] )" class="option"
          >17:30 - 17:55 ⇢ GRAMMAR REVIEW (Group Classroom 2 [G2] )</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This is designed for students to learn and practice delivering their presentations through various exercises or
        group works. <br />
        It also aims to help students learn expressions in line with every topic, grammar points and vocabulary to
        <br />
        improve the students’ ability to communicate fluently, and feel confident and comfortable when delivering their presentation.
      </label>
      <select name="seventh_period" class="select w-full" bind:value={data.seventh_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="18:00 - 18:25 ⇢ PRESENTATION DELIVERY (Group Classroom 2 [G2] )" class="option"
          >18:00 - 18:25 ⇢ PRESENTATION DELIVERY (Group Classroom 2 [G2] )</option
        >
      </select>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="label mt-6">
        This is designed to help the students achieve their target score. The students are given tests and practices <br
        />
        from the different TOEIC sub tests, Listening and Reading, under normal TOEIC test conditions. Corrections and feedback
        <br />
        will be given to help correct student mistakes and improve their performance.
      </label>
      <select name="eight_period" class="select w-full" bind:value={data.eighth_period} required>
        <option disabled selected>Schedule Periods</option>
        <option selected></option>
        <option value="18:30 - 18:55 ⇢ TOEIC (Group Classroom 2 [G2] )" class="option"
          >18:30 - 18:55 ⇢ TOEIC (Group Classroom 2 [G2] )</option
        >
      </select>

      <div class="mt-4 text-center">
        <button type="submit" class="btn btn-success">Submit</button>
      </div>
    </fieldset>
  </form>
</div>
