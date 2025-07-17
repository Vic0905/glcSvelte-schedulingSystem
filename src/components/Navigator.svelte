<script>
  import { current } from '../lib/Pocketbase.svelte'
</script>

{#if current.user}
  <!-- admin routes -->
  <li><a href="/#/registration">Registration</a></li>
  <li>
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
  </li>
  <li><a>Item 3</a></li>
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
      <summary>Lesson Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Teacher Request Form</a></li>
        <li><a>Special Classes Form</a></li>
        <li><a>Additional Classes Form</a></li>
        <li><a>Class Cancellation Form</a></li>
        <li><a>Course Request Form</a></li>
      </ul>
    </details>
  </li>
  <li>
    <details>
      <summary>Consent Forms</summary>
      <ul class="relative z-50 text-xs p-2">
        <li><a>Legal Consent Form</a></li>
        <li><a>Minor Form</a></li>
        <li><a>Travel Request Form</a></li>
      </ul>
    </details>
  </li>
  <li><a>Item 3</a></li>
{/if}
