document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  const DEFAULT_THRESHOLDS = {
    is_fraud: 50,
    is_advertising: 20,
    is_ai_generated: 25,
    is_spam: 25,
    is_clickbait: 20,
    is_infobusiness: 25,
    is_toxic: 25
  };

  chrome.storage.local.get(['jevApiKey', 'jevThresholds'], (result) => {
    if (result.jevApiKey) {
      apiKeyInput.value = result.jevApiKey;
    }
    const saved = result.jevThresholds || {};
    // Storage holds fractions (0.25); popup shows percents (25).
    const thresholds = { ...DEFAULT_THRESHOLDS };
    for (const key of Object.keys(thresholds)) {
      const value = saved[key];
      if (typeof value === 'number' && value > 0 && value <= 1) {
        thresholds[key] = Math.round(value * 100);
      }
    }
    const savedUppers = saved.upper_limits || {};
    for (const [key, value] of Object.entries(thresholds)) {
      const input = document.getElementById(`th_${key}`);
      if (input) input.value = value;
      const upperInput = document.getElementById(`thu_${key}`);
      if (upperInput) upperInput.value = savedUppers[key] != null
        ? Math.round(savedUppers[key] * 100)
        : 80;
    }
  });

  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();

    const thresholds = {};
    const upperLimits = {};
    let valid = true;
    for (const flagKey of Object.keys(DEFAULT_THRESHOLDS)) {
      const input = document.getElementById(`th_${flagKey}`);
      const upperInput = document.getElementById(`thu_${flagKey}`);
      const percent = Number(input?.value);
      const upperPercent = Number(upperInput?.value);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100 ||
          !Number.isFinite(upperPercent) || upperPercent < 1 || upperPercent > 100) {
        valid = false;
        break;
      }
      // Each upper limit must be strictly above its lower threshold.
      if (upperPercent <= percent) {
        valid = false;
        break;
      }
      thresholds[flagKey] = percent / 100;
      upperLimits[flagKey] = upperPercent / 100;
    }

    if (!valid) {
      status.textContent = 'Thresholds: 1–100, upper must be above lower!';
      status.style.color = '#dc3545';
      status.style.display = 'block';
      setTimeout(() => {
        status.style.display = 'none';
        status.textContent = 'Settings saved successfully!';
        status.style.color = '#28a745';
      }, 2000);
      return;
    }

    chrome.storage.local.set({ jevApiKey: key, jevThresholds: { ...thresholds, upper_limits: upperLimits } }, () => {
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 2000);
    });
  });
});