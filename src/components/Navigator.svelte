<script>
  import { current } from '../lib/Pocketbase.svelte'
  import { onMount, onDestroy } from 'svelte'

  function handleOutsideClick(event) {
    const openDetails = document.querySelectorAll('details[open]')
    openDetails.forEach((el) => {
      if (!el.contains(event.target)) {
        el.removeAttribute('open')
      }
    })
  }

  onMount(() => {
    document.addEventListener('click', handleOutsideClick)
  })

  onDestroy(() => {
    document.removeEventListener('click', handleOutsideClick)
  })
</script>

{#if current.user && current.user.role === 'admin'}
  <!-- admin routes -->
  <!-- <li><a href="/#/registration">Registration</a></li> -->
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
  <li>
    <details>
      <summary>Consent Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Legal Consent</a></li>
        <li><a>Minor</a></li>
        <li><a>Travel Request</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li><a href="/#/rules">Rules and Regulation</a></li> -->
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
  <!-- <li>
    <details>
      <summary>Lesson Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/lessonforms/teacher">Teacher Request Form</a></li>
        <li><a href="/#/lessonforms/special">Special Classes Form</a></li>
        <li><a href="/#/lessonforms/additional">Additional Classes Form</a></li> -->
  <!-- <li><a>Class Cancellation Form</a></li>
        <li><a>Course Request Form</a></li> -->
  <!-- </ul>
    </details>
  </li> -->
  <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="#/advance/advanceschedule">MTM Input Table</a></li>
        <li><a href="#/advance/advancegroupschedule">GRP Input Table</a></li>
        <li><a href="/#/advance/grouptemplate">GRP Room Template</a></li>
        <li><a href="/#/advance/studenttemplate">Student Template</a></li>
        <li><a href="/#/advance/teachertemplate">Teacher Template</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Current Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/current/scheduleinput">MTM Input Table</a></li>
        <li><a href="/#/current/grouptable">GRP Input Table</a></li>
        <li><a href="/#/current/groupview">GRP Room Table</a></li>
        <li><a href="/#/current/studentview">Student Table</a></li>
        <li><a href="/#/current/teacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Management</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/management/subject">Subject</a></li>
        <li><a href="/#/management/room">Room</a></li>
        <li><a href="/#/management/group">Group</a></li>
        <li><a href="/#/management/student">Student</a></li>
        <li><a href="/#/management/teacher">Teacher</a></li>
      </ul>
    </details>
  </li>
{:else if current.user && current.user.role === 'teacher'}
  <!-- teacher routes -->
  <!-- <li>
    <details>
      <summary>Teacher Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/current/teacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li> -->
{:else if current.user && current.user.role === 'staff'}
  <!-- staff routes -->
  <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/advance/mondayadvanceschedule">Advance Monday Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Current Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/current/mondayscheduleinput">Monday Table</a></li>
      </ul>
    </details>
  </li>
{:else}
  <!-- public routes -->
  <!-- <li>
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
        <li><a href="/#/lessonforms/additional">Additional Classes Form</a></li> -->
  <!-- <li><a>Class Cancellation Form</a></li>
        <li><a>Course Request Form</a></li> -->
  <!-- </ul>
    </details>
  </li> -->
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
  <!-- <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="#/schedule/advanceschedule">Advance Input Table</a></li>
        <li><a href="#/schedule/advancegroupschedule">Advance Group Table</a></li>
        <li><a href="/#/input/grouptemplate">Group Template</a></li>
        <li><a href="/#/input/studenttemplate">Student Template</a></li>
        <li><a href="/#/input/teachertemplate">Teacher Template</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li>
    <details>
      <summary>Templates Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/input/grouptemplate">Group Template</a></li>
        <li><a href="/#/input/studenttemplate">Student Template</a></li>
        <li><a href="/#/input/teachertemplate">Teacher Template</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li>
    <details>
      <summary>Current Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/schedule/scheduleinput">MTM Table</a></li>
        <li><a href="/#/schedule/grouptable">GRP Table</a></li>
        <li><a href="/#/input/groupview">Group View Table</a></li>
        <li><a href="/#/input/studentview">Student View Table</a></li>
        <li><a href="/#/input/teacherview">Teacher View Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>View Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/input/groupview">Group View Table</a></li>
        <li><a href="/#/input/studentview">Student View Table</a></li>
        <li><a href="/#/input/teacherview">Teacher View Table</a></li>
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
  </li> -->
{/if}
