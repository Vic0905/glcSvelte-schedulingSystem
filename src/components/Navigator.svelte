<script>
  import { current } from '../lib/Pocketbase.svelte'
  import { onMount, onDestroy } from 'svelte'

  let openMenus = $state({ daily: false, management: false })

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
  <!-- <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/advance/advanceschedule">MTM Input Table</a></li>
        <li><a href="/#/advance/advancegroupschedule">GRP Input Table</a></li>
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
        <li><a href="/#/current/studentview">Student Table</a></li>
        <li><a href="/#/current/teacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li>
    <details>
      <summary>New Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/new/mtmscheduletable">MTM Input Table</a></li>
        <li><a href="/#/new/grpscheduletable">GRP Input Table</a></li>
        <li><a href="/#/new/studentview">Student Table</a></li>
        <li><a href="/#/new/teacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/new/advanceschedule">Combined Input Table</a></li>

        <li><a href="/#/new/advancestudentview">StudentView Table</a></li>
        <li><a href="/#/new/advanceteacherview">TeacherView Table</a></li>
        <li><a href="/#/new/teacherinfo">Teacher Information</a></li>
        <li><a href="/#/new/studentinfo">Student Information</a></li>
        <li><a href="/#/new/room">Room Information</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li>
    <details>
      <summary>Weekly Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/new/schedule">Combined Input</a></li>
        <li><a href="/#/new/studentview">StudentView</a></li>
        <li><a href="/#/new/teacherview">TeacherView</a></li>
        <li><a href="/#/new/dailyschedule">Daily Input</a></li>
        <li><a href="/#/current/groupview">GRP Room Table</a></li>
        <li><a href="/#/new/teacherinfo">Teacher Information</a></li>
        <li><a href="/#/new/studentinfo">Student Information</a></li>
        <li><a href="/#/new/room">Room Information</a></li>
      </ul>
    </details>
  </li> -->
  <li class="relative">
    <button
      onclick={() => (openMenus.daily = !openMenus.daily)}
      class="flex items-center justify-between px-4 py-2 hover:bg-base-200 rounded-lg"
    >
      <span class="text-xs mr-2">{openMenus.daily ? '▶' : '◀'}</span>
      Daily Booking
    </button>
    {#if openMenus.daily}
      <ul class="absolute right-full top-0 mr-30 text-xs flex flex-row p-2 z-50 whitespace-nowrap">
        <li><a href="/#/new/dailyschedule">MTM Input</a></li>
        <li><a href="/#/new/dailygroupschedule">GRP Input</a></li>
        <li><a href="/#/new/dailystudentview">StudentView</a></li>
        <li><a href="/#/new/dailyteacherview">TeacherView</a></li>
        <li><a href="/#/new/graduatingstudent">Graduating Student</a></li>
      </ul>
    {/if}
  </li>
  <li class="relative">
    <button
      onclick={() => (openMenus.management = !openMenus.management)}
      class="flex items-center justify-between px-4 py-2 hover:bg-base-200 rounded-lg"
    >
      Management
      <span class="text-xs ml-2">{openMenus.management ? '◀' : '▶'}</span>
    </button>
    {#if openMenus.management}
      <ul class="absolute left-full top-0 text-xs flex flex-row p-2 z-50 whitespace-nowrap">
        <li><a href="/#/new/releaselog">Release Logs</a></li>
        <li><a href="/#/new/holidaypicker">Special Days</a></li>
        <li><a href="/#/management/subject">Subject</a></li>
        <li><a href="/#/new/room">Room</a></li>
        <li><a href="/#/new/teacherinfo">Teacher</a></li>
        <li><a href="/#/new/studentinfo">Student</a></li>
      </ul>
    {/if}
  </li>
{:else if current.user && current.user.role === 'teacher'}
  <!-- teacher routes -->
  <!-- <li>
    <details>
      <summary>Teacher Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/new/teachertable">Teacher View</a></li>
      </ul>
    </details>
  </li> -->
  <!-- <li>
    <details>
      <summary>Teacher Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/current/teacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li> -->
{:else if current.user && current.user.role === 'student'}
  <!-- student routes -->
  <!-- <li>
    <details>
      <summary>Student Table</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/new/studenttable">Student View</a></li>
      </ul>
    </details>
  </li> -->
{:else if current.user && current.user.role === 'staff'}
  <!-- staff routes -->
  <li>
    <details>
      <summary>Advance Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/advance/mondayadvanceschedule">MTM Input Table</a></li>
        <li><a href="/#/advance/mondayadvancegroup">GRP Input Table</a></li>
        <li><a href="/#/advance/mondaygrouptemplate">Group Room Table</a></li>
        <li><a href="/#/advance/mondaystudentview">Student Table</a></li>
        <li><a href="/#/advance/mondayteacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Current Booking</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/current/mondayscheduleinput">MTM Input Table</a></li>
        <li><a href="/#/current/mondaygrouptable">GRP Input Table</a></li>
        <!-- <li><a href="/#/current/mondaygroupview">Group Room Table</a></li> -->
        <li><a href="/#/current/mondaystudentview">Student Table</a></li>
        <li><a href="/#/current/mondayteacherview">Teacher Table</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Inventory</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a href="/#/inventory/inventory">Inventory</a></li>
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
