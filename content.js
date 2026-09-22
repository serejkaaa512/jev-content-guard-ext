const MIN_CHAR_LENGTH = 60;
const MAX_CHAR_LENGTH = 4000;
const DEBOUNCE_DELAY = 400;
const MAX_CONCURRENT_REQUESTS = 3;

const DEFAULT_THRESHOLDS = {
  is_fraud: 0.50,
  is_advertising: 0.20,
  is_ai_generated: 0.25,
  is_spam: 0.25,
  is_clickbait: 0.20,
  is_infobusiness: 0.25,
  is_toxic: 0.25
};

let thresholds = { ...DEFAULT_THRESHOLDS };

loadThresholds();

function loadThresholds() {
  chrome.storage.local.get(['jevThresholds'], (result) => {
    if (result.jevThresholds) {
      thresholds = { ...DEFAULT_THRESHOLDS, ...result.jevThresholds };
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.jevThresholds) {
    thresholds = { ...DEFAULT_THRESHOLDS, ...(changes.jevThresholds.newValue || {}) };
  }
});

const processedElements = new WeakSet();
let analysisQueue = [];
let debounceTimer = null;

initContentScanner();

function initContentScanner() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupObservers);
  } else {
    setupObservers();
  }
}

function setupObservers() {
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          queueElementForAnalysis(node);
        }
      }
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  queueElementForAnalysis(document.body);
}

function queueElementForAnalysis(rootElement) {
  // Only the innermost matching elements are analyzed. If an element contains
  // another matching target (e.g. an <article> wrapping <p> tags), it is skipped
  // so the same text is never sent to the API as part of multiple chunks.
  const TARGET_SELECTOR = 'p, article, section, li, [role="article"], .tm-articles-list__item, .tm-article-presenter, .article-snippet, .tm-comment-thread__comment, .tm-comment';

  const targets = rootElement.querySelectorAll(TARGET_SELECTOR);

  targets.forEach(el => {
    if (processedElements.has(el) || el.dataset.jevFlagged === "true") return;

    const isNoise = el.closest('nav, footer, header, script, style, noscript, form, .tm-page-sidebar, .tm-navbar');
    if (isNoise) return;

    if (el.querySelector(TARGET_SELECTOR)) return;

    // Collapse whitespace (line breaks, repeated spaces) so the API receives
    // clean continuous text without layout artifacts.
    const text = el.innerText?.replace(/\s+/g, " ").trim() || "";
    if (text.length >= MIN_CHAR_LENGTH && text.length <= MAX_CHAR_LENGTH) {
      analysisQueue.push({ element: el, text: text });
    }
  });

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(processQueue, DEBOUNCE_DELAY);
}

async function processQueue() {
  if (analysisQueue.length === 0) return;

  const currentBatch = analysisQueue.splice(0, analysisQueue.length);

  let index = 0;
  const worker = async () => {
    while (index < currentBatch.length) {
      const item = currentBatch[index++];
      if (processedElements.has(item.element) || !item.element.isConnected) continue;

      const success = await analyzeItem(item);
      if (success) {
        // Only mark as processed after a successful response, so failed items
        // can be retried on later DOM mutations.
        processedElements.add(item.element);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, currentBatch.length) }, worker)
  );
}

function analyzeItem(item) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "analyzeContent", text: item.text },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Jev Guard] Ошибка связи:", chrome.runtime.lastError.message);
          resolve(false);
          return;
        }

        if (response && response.success && response.results) {
          processJevResults(item.element, response.results);
          resolve(true);
        } else if (response && response.error) {
          console.error("[Jev Guard] API Error:", response.error);
          resolve(false);
        } else {
          console.warn("[Jev Guard] Пустой или некорректный ответ API для элемента.");
          resolve(false);
        }
      }
    );
  });
}

// Accepts both { probability: N } and the real Jev format { type: "noul", noul: N }.
function getProbability(flag) {
  if (!flag) return 0;
  if (typeof flag.probability === "number") return flag.probability;
  if (typeof flag.noul === "number") return flag.noul;
  return 0;
}

function processJevResults(domElement, flags) {
  if (getProbability(flags.is_fraud) >= thresholds.is_fraud) {
    flagElement(domElement, "⚠️ Подозрение на мошенничество / Скам", "jev-theme-fraud");
  } else if (getProbability(flags.is_advertising) >= thresholds.is_advertising) {
    flagElement(domElement, "📢 Рекламный контент", "jev-theme-ad");
  } else if (getProbability(flags.is_ai_generated) >= thresholds.is_ai_generated) {
    flagElement(domElement, "🤖 Подозрение на AI-генерацию (Слоп)", "jev-theme-ai");
  } else if (getProbability(flags.is_spam) >= thresholds.is_spam) {
    flagElement(domElement, "🚫 Скрытый спам", "jev-theme-spam");
  } else if (getProbability(flags.is_clickbait) >= thresholds.is_clickbait) {
    flagElement(domElement, "🪤 Кликбейт / Байт на подписку", "jev-theme-clickbait");
  } else if (getProbability(flags.is_infobusiness) >= thresholds.is_infobusiness) {
    flagElement(domElement, "💎 Инфоцыганство / «Успешный успех»", "jev-theme-infobiz");
  } else if (getProbability(flags.is_toxic) >= thresholds.is_toxic) {
    flagElement(domElement, "🤬 Токсичный контент / Хейт", "jev-theme-toxic");
  }
}

function flagElement(element, reasonText, themeClass) {
  if (element.dataset.jevFlagged === "true") return;
  element.dataset.jevFlagged = "true";

  element.style.position = 'relative';
  
  const overlay = document.createElement('div');
  overlay.className = 'jev-blur-overlay';
  
  overlay.setAttribute('style', `
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: rgba(255, 255, 255, 0.85) !important;
    backdrop-filter: blur(15px) !important;
    -webkit-backdrop-filter: blur(15px) !important;
    z-index: 10000 !important;
    border-radius: 8px !important;
    pointer-events: auto !important;
  `);

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    overlay.style.setProperty('background', 'rgba(24, 24, 26, 0.85)', 'important');
  }

  const badge = document.createElement('button');
  badge.className = `jev-warning-badge ${themeClass}`;
  badge.innerHTML = `${reasonText} <span style="margin-left:8px; font-size:10px; opacity:0.8;">[Развернуть]</span>`;
  
  overlay.appendChild(badge);

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    overlay.remove();
  });

  element.appendChild(overlay);
}