<script>
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'
</script>

<div class="h-[50vh] flex items-center justify-center overflow-hidden">
  <!-- Content Layer -->
  <div class="relative z-10 p-8 rounded-lg text-center">
    <h1 class="text-xl md:text-5xl font-bold tracking-wide">GLC REQUEST FORM</h1>
  </div>
</div>

<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-[850px] mx-auto justify-evenly">
  <a href="/#/lessonforms/teacher" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Class/Teacher Request Form</a
  >
  <a href="/#/lessonforms/special" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Special Classes Form</a
  >
  <a href="/#/" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center">Student's Absent Form</a>
  <a href="/#/request/consent/minorform/" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Going Out Form (Minors)</a
  >
  <a href="/#/request/consent/legalform/" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Going Out Form (With Teacher)</a
  >
  <a href="/#/request/travel/travelform/" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Travel/Stay Out Form</a
  >
  <a href="/#/request/course/courseform/" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Course Change</a
  >
  <a
    href="/#/request/additional/additionalclassesform/"
    class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center">Additional Class</a
  >
  <a
    href="/#/request/cancellation/classcancellationform/"
    class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center">Class Cancellation</a
  >
  <a href="/#/request/refund/refundrequestform/" class="btn btn-info font-semibold px-6 py-4 rounded-lg text-center"
    >Refund Form</a
  >
</div>
