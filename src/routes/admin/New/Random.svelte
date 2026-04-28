<script>
  // Svelte 5 state runes
  let selectedTime = $state('14')
  let recommendations = $state([])
  let isAnalyzing = $state(false)

  const drawOptions = [
    { label: '2:00 PM Draw', value: '14' },
    { label: '5:00 PM Draw', value: '17' },
    { label: '9:00 PM Draw', value: '21' },
  ]

  /**
   * Mulberry32: A fast, seeded PRNG.
   * This mimics "randomness" while staying tied to our specific seed.
   */
  function seededRandom(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function drawBestCombination() {
    isAnalyzing = true
    recommendations = []

    // 1. Create a Seed
    // We use the date + time value to create a unique starting point for the math
    const now = new Date()
    const dateSeed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
    let finalSeed = dateSeed + parseInt(selectedTime)

    const rng = seededRandom(finalSeed)

    // Simulate "Processing Time" for UI feel
    setTimeout(() => {
      const results = []

      for (let i = 0; i < 5; i++) {
        const digits = []

        // Swertres has 3 separate chambers (0-9)
        for (let chamber = 0; chamber < 3; chamber++) {
          // We simulate a "shuffle" of the 10 balls in the chamber
          const balls = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

          // Fisher-Yates Shuffle logic
          for (let j = balls.length - 1; j > 0; j--) {
            const k = Math.floor(rng() * (j + 1))
            ;[balls[j], balls[k]] = [balls[k], balls[j]]
          }

          // Pick the ball that "landed" at the top (index 0)
          digits.push(balls[0])
        }

        results.push({
          id: i,
          digits: digits,
          sum: digits.reduce((a, b) => a + b, 0),
        })
      }

      recommendations = results
      isAnalyzing = false
    }, 1000)
  }
</script>

<div
  style="max-width: 500px; margin: 2rem auto; font-family: sans-serif; background: #064e3b; color: white; padding: 30px; border-radius: 20px;"
>
  <h2 style="text-align: center; color: #34d399;">3D SEEDED ANALYZER</h2>

  <div style="display: flex; gap: 10px; margin-bottom: 25px;">
    <select
      bind:value={selectedTime}
      style="flex: 1; padding: 12px; border-radius: 8px; background: #065f46; color: white;"
    >
      {#each drawOptions as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>

    <button
      onclick={drawBestCombination}
      disabled={isAnalyzing}
      style="flex: 1; background: #34d399; color: #064e3b; border-radius: 8px; font-weight: bold; cursor: pointer;"
    >
      {isAnalyzing ? 'ANALYZING...' : 'GET BEST PICK'}
    </button>
  </div>

  <div style="display: flex; flex-direction: column; gap: 12px;">
    {#each recommendations as item (item.id)}
      <div
        style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 12px; display: flex; align-items: center; justify-content: space-between;"
      >
        <div style="display: flex; gap: 10px;">
          {#each item.digits as digit}
            <div
              style="width: 45px; height: 45px; background: white; color: #064e3b; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;"
            >
              {digit}
            </div>
          {/each}
        </div>
        <span style="color: #a7f3d0;">RANK {item.id + 1}</span>
      </div>
    {/each}
  </div>
</div>
