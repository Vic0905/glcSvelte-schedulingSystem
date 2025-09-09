<script>
  import { current } from '../lib/Pocketbase.svelte'
</script>

{#if current.user}
  <!-- admin routes -->
  <li><a href="/#/registration">Registration</a></li>
  <!-- <li>
    <details>
      <summary>Lesson Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Teacher Request</a></li>
        <li><a>Special Classes</a></li>
        <li><a>Additional Classes</a></li>
        <li><a>Class Cancellation</a></li>
        <li><a>Course Request</a></li>
      </ul>
    </details>
  </li> 
  <!-- <li>
    <details>
      <summary>Consent Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Legal Consent</a></li>
        <li><a>Minor</a></li>
        <li><a>Travel Request</a></li>
      </ul>
    </details>
  </li> -->
  <li><a href="/#/rules">Rules and Regulation</a></li>
  <!-- <li>
    <details>
      <summary>Policies</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Teacher Request</a></li>
        <li><a>Special Classes</a></li>
        <li><a>Additional Classes</a></li>
        <li><a>Class Cancellation</a></li>
        <li><a>Course Request</a></li>
      </ul>
    </details>
  </li> -->
  <li>
    <details>
      <summary>Lesson Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/lessonforms/teacher">Teacher Request Form</a></li>
        <li><a href="/#/lessonforms/special">Special Classes Form</a></li>
        <li><a href="/#/lessonforms/additional">Additional Classes Form</a></li>
        <!-- <li><a>Class Cancellation Form</a></li>
        <li><a>Course Request Form</a></li> -->
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="#/schedule/advanceschedule">Advance Input Table</a></li>
        <li><a href="#/schedule/advancegroupschedule">Advance Group Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Scheduling Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/schedule/scheduleinput">Input Table</a></li>
        <li><a href="/#/schedule/grouptable">Group Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>View Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/input/teacherview">Teacher View Table</a></li>
        <li><a href="/#/schedule/schedulestudent">Student View Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Management</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/input/subject">Subject</a></li>
        <li><a href="/#/input/room">Room</a></li>
        <li><a href="/#/input/group">Group</a></li>
        <li><a href="/#/input/student">Student</a></li>
        <li><a href="/#/input/teacher">Teacher</a></li>
      </ul>
    </details>
  </li>
{:else}
  <!-- public routes -->
  <li>
    <details>
      <summary>Registration</summary>
      <ul class="p-2">
        <li><a href="/#/registration/single">Single</a></li>
        <li><a href="/#/registration/group">Group</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Rules and Regulations</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/rules/welcome">Welcome Paper</a></li>
        <li><a href="/#/rules/regulation">Rules and Regulation</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Lesson Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/lessonforms/teacher">Teacher Request Form</a></li>
        <li><a href="/#/lessonforms/special">Special Classes Form</a></li>
        <li><a href="/#/lessonforms/additional">Additional Classes Form</a></li>
        <!-- <li><a>Class Cancellation Form</a></li>
        <li><a>Course Request Form</a></li> -->
      </ul>
    </details>
  </li>
  <!-- <li> 
    <details>
      <summary>Consent Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Legal Consent Form</a></li>
        <li><a>Minor Form</a></li>
        <li><a>Travel Request Form</a></li>
      </ul> 
    </details>
  </li> -->
  <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="#/schedule/advanceschedule">Advance Input Table</a></li>
        <li><a href="#/schedule/advancegroupschedule">Advance Group Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Scheduling Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/schedule/scheduleinput">Input Table</a></li>
        <li><a href="/#/schedule/grouptable">Group Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>View Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/input/teacherview">Teacher View Table</a></li>
        <li><a href="/#/schedule/schedulestudent">Student View Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Management</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/input/subject">Subject</a></li>
        <li><a href="/#/input/room">Room</a></li>
        <li><a href="/#/input/group">Group</a></li>
        <li><a href="/#/input/student">Student</a></li>
        <li><a href="/#/input/teacher">Teacher</a></li>
      </ul>
    </details>
  </li>
{/if}
