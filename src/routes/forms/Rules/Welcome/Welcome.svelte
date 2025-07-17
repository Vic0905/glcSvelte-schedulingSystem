<script>
  let selectedLanguage = $state()

  // Map language options to Google Drive preview links
  const driveLinks = {
    english: 'https://drive.google.com/file/d/1omSH3vZO6nx359tP3YHSwuVSWEeElJ6a/preview',
    japanese: 'https://drive.google.com/file/d/12Iw5F25BC11lIxJX0wQEG0WL3lrq2QQg/preview',
    taiwanese: 'https://drive.google.com/file/d/1iN0che1bhzsLpDDuhQUfmn2F_pwuS3K_/preview',
    chinese: 'https://drive.google.com/file/d/1uodw3eVxCabU4_b1B0mWlaeJqySuUoGo/preview',
    thai: 'https://drive.google.com/file/d/1dEQN-XRlPWkY0tFCABXvLk3uR91jLNej/preview',
    vietnamese: 'https://drive.google.com/file/d/1tIPMKE2__XJ0mJH62kJv3TGWxbQN1h5R/preview',
    korean: 'https://drive.google.com/file/d/199T_tv4dftIBfufKGCIBZNRbgT9M5lfP/preview',
    russian: 'https://drive.google.com/file/d/1ThEPXRRK6jHLxXW4iJOhHKZzfk9urjr8/preview',
    arabic: 'https://drive.google.com/file/d/1TyMuwcRJP2pAVb0q_ZpvSqow8YSTZG3H/preview',
    mongolian: 'https://drive.google.com/file/d/1Cc4EmYbqZJT3NgA3iJ6SLPmMvWtqKCt6/preview',
  }
</script>

<div class="breadcrumbs text-sm w-[80%] mx-auto">
  <ul>
    <li><a href="/#/" class="badge badge-primary">Dashboard</a></li>
    <li><a href="/#/rules/" class="badge badge-secondary">Welcome Paper</a></li>
    <li><span class="badge badge-neutral capitalize">{selectedLanguage}</span></li>
  </ul>
</div>
<!-- Language Select -->
<div class="w-full max-w-4xl mx-auto text-right">
  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label class="mr-2 font-semibold">Select Language:</label>
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
  <iframe src={driveLinks[selectedLanguage]} width="100%" height="750" class="w-full rounded shadow"></iframe>
</div>
