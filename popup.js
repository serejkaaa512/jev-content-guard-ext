document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const footnote = document.getElementById('footnote');
  const footnoteTip = footnote ? footnote.innerHTML : '';

  let footnoteTimer = null;
  let savedTimer = null;

  // Success feedback lives on the button itself: a green flash plus a check mark.
  function flashSaved() {
    saveBtn.classList.add('saved');
    saveBtn.setAttribute('aria-label', 'Settings saved');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      saveBtn.classList.remove('saved');
      saveBtn.setAttribute('aria-label', 'Save settings');
    }, 1600);
  }

  // The bottom strip shows a keyword tip; it doubles as the validation error line.
  function showFootnoteError(message) {
    if (!footnote) return;
    footnote.textContent = message;
    footnote.classList.add('error');
    clearTimeout(footnoteTimer);
    footnoteTimer = setTimeout(() => {
      footnote.innerHTML = footnoteTip;
      footnote.classList.remove('error');
    }, 2600);
  }
  const excludedUrlsInput = document.getElementById('excludedUrls');
  const excludedBlock = document.getElementById('excludedBlock');

  function getSelectedScope() {
    return document.querySelector('input[name="scanScope"]:checked')?.value === 'selection'
      ? 'selection'
      : 'page';
  }

  // The exclusion list only matters for automatic whole-page scanning.
  function applyExcludedVisibility(scope) {
    if (excludedBlock) excludedBlock.hidden = scope !== 'page';
  }

  document.querySelectorAll('input[name="scanScope"]').forEach((input) => {
    input.addEventListener('change', () => applyExcludedVisibility(getSelectedScope()));
  });

  const DEFAULT_THRESHOLDS = {
    is_fraud: 50,
    is_advertising: 20,
    is_ai_generated: 25,
    is_spam: 25,
    is_clickbait: 20,
    is_infobusiness: 25,
    is_toxic: 25,
    is_plagiat: 25
  };

  chrome.storage.local.get(['jevApiKey', 'jevThresholds', 'jevScanScope', 'jevExcludedUrls'], (result) => {
    if (result.jevApiKey) {
      apiKeyInput.value = result.jevApiKey;
    }
    if (Array.isArray(result.jevExcludedUrls)) {
      excludedUrlsInput.value = result.jevExcludedUrls.join('\n');
    } else if (typeof result.jevExcludedUrls === 'string') {
      excludedUrlsInput.value = result.jevExcludedUrls;
    }
    const scope = result.jevScanScope === 'selection' ? 'selection' : 'page';
    const scopeInput = document.querySelector(`input[name="scanScope"][value="${scope}"]`);
    if (scopeInput) scopeInput.checked = true;
    applyExcludedVisibility(scope);
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
      showFootnoteError('Thresholds: 1–100, upper must be above lower!');
      return;
    }

    const scanScope = getSelectedScope();

    const excludedUrls = excludedUrlsInput.value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    chrome.storage.local.set(
      {
        jevApiKey: key,
        jevThresholds: { ...thresholds, upper_limits: upperLimits },
        jevScanScope: scanScope,
        jevExcludedUrls: excludedUrls
      },
      () => {
        flashSaved();
      }
    );
  });
});