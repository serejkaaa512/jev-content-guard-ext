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
    for (const [key, value] of Object.entries(thresholds)) {
      const input = document.getElementById(`th_${key}`);
      if (input) input.value = value;
    }
  });

  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();

    const thresholds = {};
    let valid = true;
    for (const flagKey of Object.keys(DEFAULT_THRESHOLDS)) {
      const input = document.getElementById(`th_${flagKey}`);
      const percent = Number(input?.value);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        valid = false;
        break;
      }
      thresholds[flagKey] = percent / 100;
    }

    if (!valid) {
      status.textContent = 'Пороги должны быть от 1 до 100!';
      status.style.color = '#dc3545';
      status.style.display = 'block';
      setTimeout(() => {
        status.style.display = 'none';
        status.textContent = 'Ключ успешно сохранен!';
        status.style.color = '#28a745';
      }, 2000);
      return;
    }

    chrome.storage.local.set({ jevApiKey: key, jevThresholds: thresholds }, () => {
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 2000);
    });
  });
});