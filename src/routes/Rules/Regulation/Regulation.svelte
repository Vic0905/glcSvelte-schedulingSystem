<script>
  import { pb } from '../../../lib/Pocketbase.svelte'

  let selectedLanguage = 'english'

  // Map language options to Google Drive preview links
  const driveLinks = {
    english: 'https://drive.google.com/file/d/15H5GJGp6SR4vEXVSsNZNJZ3tO0QWIQRq/preview',
    japanese: 'https://drive.google.com/file/d/1_xYo27rkyMs7IN8xBfQJFFi8cw66s_nS/preview',
    taiwanese: 'https://drive.google.com/file/d/1C7saTVLrDF5rld5LbFpO33JYh1ppyaYl/preview',
    chinese: 'https://drive.google.com/file/d/1qAnK1rwbAjGEjbT3UF3PIROTt2VbYJhi/preview',
    thai: 'https://drive.google.com/file/d/1YLrd0nf_1E2ziND0kBIyzzCybfuQf6N-/preview',
    vietnamese: 'https://drive.google.com/file/d/1ElqCwbchIhta-SQHncLx4Pwt651iUxT-/preview',
    korean: 'https://drive.google.com/file/d/110uL1anrQXBZB8jEPWDhgsu3yPXri85h/preview',
    russian: 'https://drive.google.com/file/d/11S70BytE4jChS-zkNElBro1jrR6i9ZrU/preview',
    arabic: 'https://drive.google.com/file/d/1R2bjQ1vAievN4I5D_UzyYuEm5qIAfOTs/preview',
    mongolian: 'https://drive.google.com/file/d/1s59tx7iktUCA9Vy-olqAxgz-6ZJ1Ifyq/preview',
  }
</script>

<div class="breadcrumbs text-sm w-[80%] mx-auto">
  <ul>
    <li><a href="/#/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/rules/" class="badge badge-secondary">Rules&Regulation</a></li>
    <li><span class="badge badge-neutral capitalize">{selectedLanguage}</span></li>
  </ul>
</div>

<!-- Language Select -->
<div class="w-full max-w-4xl mx-auto mt-6 text-right">
  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class="mr-2 font-semibold text-gray-100">Select Language:</label>
  <select bind:value={selectedLanguage} class="select w-xs select-primary">
    <option value="english">English</option>
    <option value="japanese">Japanese</option>
    <option value="taiwanese">Taiwanese</option>
    <option value="chinese">Chinese</option>
    <option value="thai">Thai</option>
    <option value="vietnamese">Vietnamese</option>
    <option value="korean">Korean</option>
    <option value="russian">Russian</option>
    <option value="arabic">Arabic</option>
    <option value="mongolian">Mongolian</option>
  </select>
</div>

<!-- iFrame Preview -->
<div class="w-full max-w-4xl mx-auto mt-6">
  <!-- svelte-ignore a11y_missing_attribute -->
  <iframe src={driveLinks[selectedLanguage]} width="100%" height="800" class="w-full rounded shadow"></iframe>
</div>
