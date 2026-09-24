const MIN_CHAR_LENGTH = 60;
const MIDDLE_CHAR_LENGTH = 500;
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
  is_toxic: 0.25,
  is_plagiat: 0.25
};

const DEFAULT_UPPER_THRESHOLDS = {
  is_fraud: 0.80,
  is_advertising: 0.80,
  is_ai_generated: 0.80,
  is_spam: 0.80,
  is_clickbait: 0.80,
  is_infobusiness: 0.80,
  is_toxic: 0.80,
  is_plagiat: 0.80
};

let thresholds = { ...DEFAULT_THRESHOLDS, upper_limits: { ...DEFAULT_UPPER_THRESHOLDS } };
let upperLimits = { ...DEFAULT_UPPER_THRESHOLDS };

loadThresholds();

function loadThresholds() {
  chrome.storage.local.get(['jevThresholds'], (result) => {
    if (result.jevThresholds) {
      applyThresholds({ ...DEFAULT_THRESHOLDS, ...result.jevThresholds });
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.jevThresholds) {
    applyThresholds({ ...DEFAULT_THRESHOLDS, ...(changes.jevThresholds.newValue || {}) });
  }
  if (changes.jevScanScope) {
    applyScanScope(changes.jevScanScope.newValue === 'selection' ? 'selection' : 'page');
  }
});

function applyThresholds(merged) {
  thresholds = { ...DEFAULT_THRESHOLDS, ...merged };
  upperLimits = {
    ...DEFAULT_UPPER_THRESHOLDS,
    ...(merged.upper_limits && typeof merged.upper_limits === 'object' ? merged.upper_limits : {})
  };
}

const processedElements = new WeakSet();
let analysisQueue = [];
let debounceTimer = null;

// "page" scans the whole document automatically; "selection" analyzes only
// fragments explicitly picked by the user through the context menu.
// `null` means the saved preference has not loaded yet.
let scanScope = null;
let domReady = false;
let observersStarted = false;

initContentScanner();

function initContentScanner() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      domReady = true;
      startScanningIfReady();
    });
  } else {
    domReady = true;
  }

  chrome.storage.local.get(['jevScanScope'], (result) => {
    applyScanScope(result.jevScanScope === 'selection' ? 'selection' : 'page');
  });
}

function applyScanScope(scope) {
  const previous = scanScope;
  scanScope = scope;
  startScanningIfReady();
  // Resuming whole-page mode walks the DOM again for never-analyzed elements.
  if (previous === 'selection' && scope === 'page' && observersStarted) {
    queueElementForAnalysis(document.body);
  }
}

function startScanningIfReady() {
  if (!domReady || scanScope === null || observersStarted) return;
  observersStarted = true;
  setupObservers();
  if (scanScope === 'page') {
    queueElementForAnalysis(document.body);
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
}

function queueElementForAnalysis(rootElement) {
  // Automatic scanning is limited to whole-page scope; selections are analyzed
  // on demand through the context menu.
  if (scanScope !== 'page') return;

  // Only the innermost matching elements are analyzed. If an element contains
  // another matching target (e.g. an <article> wrapping <p> tags), it is skipped
  // so the same text is never sent to the API as part of multiple chunks.
  const TARGET_SELECTOR = 'p, article, section, li, [role="article"], .tm-articles-list__item, .tm-article-presenter, .article-snippet, .tm-comment-thread__comment, .tm-comment';

  const targets = rootElement.querySelectorAll(TARGET_SELECTOR);

  targets.forEach(el => {
    if (processedElements.has(el)) return;

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
  // The scope switched to "selection" while items were pending: drop them.
  if (scanScope !== 'page') {
    analysisQueue.length = 0;
    return;
  }
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
          console.warn("[Jev Guard] Communication error:", chrome.runtime.lastError.message);
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
          console.warn("[Jev Guard] Empty or invalid API response for element.");
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

const MATCHERS = [
  { flag: 'is_fraud', text: '⚠️ scam', theme: 'jev-theme-fraud' },
  { flag: 'is_advertising', text: '📢 adv', theme: 'jev-theme-ad' },
  { flag: 'is_ai_generated', text: '🤖 AI', theme: 'jev-theme-ai' },
  { flag: 'is_spam', text: '🚫 spam', theme: 'jev-theme-spam' },
  { flag: 'is_clickbait', text: '🪤 bait', theme: 'jev-theme-clickbait' },
  { flag: 'is_infobusiness', text: '🤡 guru', theme: 'jev-theme-infobiz' },
  { flag: 'is_toxic', text: '🤬 toxic', theme: 'jev-theme-toxic' },
  { flag: 'is_plagiat', text: '📕 plag', theme: 'jev-theme-plagiat' }
];

// Collect all flags at/above their threshold, sorted by probability descending.
function matchFlags(flags) {
  return MATCHERS
    .map(({ flag, text, theme }) => ({
      flag, text, theme,
      probability: getProbability(flags[flag])
    }))
    .filter(({ probability, flag }) => probability >= thresholds[flag])
    .sort((a, b) => b.probability - a.probability);
}

function processJevResults(domElement, flags) {
  const matched = matchFlags(flags);

  if (matched.length === 0) return;

  // Remove any existing badges from previous runs.
  for (const node of domElement.querySelectorAll('.jev-warning-badge, .jev-soft-badge-stack, .jev-blur-overlay')) {
    node.remove();
  }

  // For short text, show only the top match.
  // For longer text (>= 2000 chars), show all matches ordered by percentage.
  const textLength = domElement.innerText?.length || 0;
  const badgesToRender = textLength >= MIDDLE_CHAR_LENGTH ? matched : [matched[0]];

  for (const { probability, text, theme, flag } of badgesToRender) {
    const percent = Math.round(probability * 100);
    const reasonText = `${text} · ${percent}%`;

    if (probability > (upperLimits[flag] ?? DEFAULT_UPPER_THRESHOLDS[flag])) {
      flagElement(domElement, reasonText, theme, 'full');
    } else {
      flagElement(domElement, reasonText, theme, 'soft');
    }
  }
}

function flagElement(element, reasonText, themeClass, mode) {
  element.style.position = 'relative';

  const badge = document.createElement('button');
  badge.className = `jev-warning-badge ${themeClass}`;
  badge.innerHTML = mode === 'soft'
    ? reasonText
    : `${reasonText} <span style="margin-left:8px; font-size:10px; opacity:0.8;">[Expand]</span>`;

  if (mode === 'soft') {
    // Soft mode: compact non-blurring badges stacked at the bottom right corner.
    badge.classList.add('jev-soft-badge');
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      badge.remove();
    });

    let stack = element.querySelector(':scope > .jev-soft-badge-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'jev-soft-badge-stack';
      element.appendChild(stack);
    }
    stack.appendChild(badge);
    return;
  }

  // Full mode: one shared blur overlay per element with all full badges stacked.
  let overlay = element.querySelector(':scope > .jev-blur-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'jev-blur-overlay';

    overlay.setAttribute('style', `
      position: absolute !important;
      inset: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 10px !important;
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

    element.appendChild(overlay);
  }

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    badge.remove();
    if (!overlay.querySelector('.jev-warning-badge')) {
      overlay.remove();
    }
  });

  overlay.appendChild(badge);
}

// Context-menu entry point: analyzes the current selection through the same
// API pipeline and pins every matching badge next to it. Unlike automatic
// scanning, all matches are shown (no short-text top-match restriction).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeSelection') {
    analyzeSelection();
    sendResponse({ ok: true });
  } else if (request.action === 'extractKeywords') {
    extractKeywordsFromSelection();
    sendResponse({ ok: true });
  } else if (request.action === 'extractKeywordsPage') {
    extractKeywordsFromPage();
    sendResponse({ ok: true });
  }
});

function analyzeSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (!text) return;

  // Captured before the async request so badges land next to the fragment
  // the user actually picked.
  const rect = selection.getRangeAt(0).getBoundingClientRect();

  chrome.runtime.sendMessage(
    { action: 'analyzeContent', text: text.slice(0, MAX_CHAR_LENGTH) },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Jev Guard] Communication error:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.success && response.results) {
        renderSelectionBadges(response.results, rect);
      } else if (response && response.error) {
        console.error('[Jev Guard] API Error:', response.error);
      }
    }
  );
}

function renderSelectionBadges(flags, rect) {
  const matched = matchFlags(flags);
  if (matched.length === 0) return;

  const container = document.createElement('div');
  container.className = 'jev-selection-badges';
  container.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;
  container.style.left = `${Math.round(rect.left + window.scrollX)}px`;

  for (const { probability, text, theme } of matched) {
    const percent = Math.round(probability * 100);
    const badge = document.createElement('button');
    badge.className = `jev-warning-badge jev-soft-badge ${theme}`;
    badge.textContent = `${text} · ${percent}%`;
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      badge.remove();
      if (!container.firstChild) container.remove();
    });
    container.appendChild(badge);
  }

  document.body.appendChild(container);
}

const STOP_WORDS = new Set([
  // English common stop words
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d',
  'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s',
  'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself',
  'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or',
  'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s',
  'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were',
  'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom',
  'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your',
  'yours', 'yourself', 'yourselves',
  // Russian common stop words
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты',
  'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему',
  'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь',
  'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней',
  'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет',
  'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой',
  'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой',
  'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три',
  'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им',
  'более', 'всегда', 'точной', 'между', 'это'
]);

function extractCandidateWords(text, maxCandidates = 35) {
  const matches = text.match(/[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/gu);
  if (!matches) return [];

  const candidatesInOrder = [];
  const seen = new Set();
  const freq = new Map();
  // Map lowercased form to first seen original case in text
  const originalCaseMap = new Map();

  for (const token of matches) {
    const lower = token.toLowerCase();
    if (lower.length < 3) continue;
    if (STOP_WORDS.has(lower)) continue;

    const count = freq.get(lower) || 0;
    freq.set(lower, count + 1);

    if (!seen.has(lower)) {
      seen.add(lower);
      originalCaseMap.set(lower, token);
      candidatesInOrder.push(lower);
    }
  }

  // If there are too many unique words, keep those with higher frequency,
  // but preserve their original order of appearance in the text.
  let selected = candidatesInOrder;
  if (candidatesInOrder.length > maxCandidates) {
    const allowed = new Set(
      Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxCandidates)
        .map(entry => entry[0])
    );
    selected = candidatesInOrder.filter(word => allowed.has(word));
  }

  // Return the words in their original case as found in the text
  return selected.map(lower => originalCaseMap.get(lower) || lower);
}

function extractKeywordsFromSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const rawText = selection.toString().replace(/\s+/g, ' ').trim();
  if (!rawText) return;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const candidates = extractCandidateWords(rawText, 35);

  if (candidates.length === 0) {
    showKeywordToast("No key words found in selection.", rect);
    return;
  }

  const loadingIndicator = showKeywordLoading(rect);

  chrome.runtime.sendMessage(
    {
      action: 'extractKeywords',
      text: rawText.slice(0, MAX_CHAR_LENGTH),
      words: candidates
    },
    (response) => {
      loadingIndicator?.remove();
      if (chrome.runtime.lastError) {
        console.warn('[Jev Guard] Keywords communication error:', chrome.runtime.lastError.message);
        showKeywordToast("Communication error.", rect);
        return;
      }

      if (response && response.success && Array.isArray(response.results)) {
        renderKeywordResults(response.results, rect);
      } else if (response && response.error) {
        console.error('[Jev Guard] Keywords API error:', response.error);
        showKeywordToast(`Error: ${response.error}`, rect);
      }
    }
  );
}

function extractKeywordsFromPage() {
  const TARGET_SELECTOR = 'p, article, section, li, [role="article"], .tm-articles-list__item, .tm-article-presenter, .article-snippet, .tm-comment-thread__comment, .tm-comment';
  const targets = document.body.querySelectorAll(TARGET_SELECTOR);
  const textChunks = [];

  targets.forEach(el => {
    const isNoise = el.closest('nav, footer, header, script, style, noscript, form, .tm-page-sidebar, .tm-navbar');
    if (isNoise) return;
    if (el.querySelector(TARGET_SELECTOR)) return;

    const t = el.innerText?.replace(/\s+/g, ' ').trim() || '';
    if (t.length >= 30) {
      textChunks.push(t);
    }
  });

  const fullText = textChunks.join(' ').slice(0, MAX_CHAR_LENGTH);
  if (!fullText) {
    showKeywordToast("No readable text found on page.", { top: 80, bottom: 80, left: 40 });
    return;
  }

  // Floating placement near the top right of the viewport
  const viewportRect = {
    top: window.scrollY + 80,
    bottom: window.scrollY + 80,
    left: Math.max(20, window.scrollX + window.innerWidth - 380)
  };

  const candidates = extractCandidateWords(fullText, 40);
  if (candidates.length === 0) {
    showKeywordToast("No key words found on page.", viewportRect);
    return;
  }

  const loadingIndicator = showKeywordLoading(viewportRect);

  chrome.runtime.sendMessage(
    {
      action: 'extractKeywords',
      text: fullText,
      words: candidates
    },
    (response) => {
      loadingIndicator?.remove();
      if (chrome.runtime.lastError) {
        console.warn('[Jev Guard] Keywords communication error:', chrome.runtime.lastError.message);
        showKeywordToast("Communication error.", viewportRect);
        return;
      }

      if (response && response.success && Array.isArray(response.results)) {
        renderKeywordResults(response.results, viewportRect);
      } else if (response && response.error) {
        console.error('[Jev Guard] Keywords API error:', response.error);
        showKeywordToast(`Error: ${response.error}`, viewportRect);
      }
    }
  );
}

function showKeywordLoading(rect) {
  const toast = document.createElement('div');
  toast.className = 'jev-keywords-card jev-keywords-loading';
  toast.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;
  toast.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  toast.innerHTML = '<span>⚡ Jev: extracting main words...</span>';
  document.body.appendChild(toast);
  return toast;
}

function showKeywordToast(message, rect) {
  const toast = document.createElement('div');
  toast.className = 'jev-keywords-card';
  toast.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;
  toast.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function renderKeywordResults(results, rect) {
  // Filter by threshold (>= 60%), keeping the original order in which words appeared in text
  const filtered = results
    .filter(r => typeof r.probability === 'number' && r.probability >= 0.60);

  const container = document.createElement('div');
  container.className = 'jev-keywords-card';
  container.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;
  container.style.left = `${Math.round(rect.left + window.scrollX)}px`;

  const header = document.createElement('div');
  header.className = 'jev-keywords-header';

  const title = document.createElement('span');
  title.className = 'jev-keywords-title';
  title.textContent = '✨ Key Words (Jev)';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'jev-keywords-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'jev-btn-link';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy main words to clipboard';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wordList = filtered.map(k => k.word).join(', ');
    navigator.clipboard.writeText(wordList).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });
  actions.appendChild(copyBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'jev-btn-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    container.remove();
  });
  actions.appendChild(closeBtn);

  header.appendChild(actions);
  container.appendChild(header);

  const listContainer = document.createElement('div');
  listContainer.className = 'jev-keywords-list';

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'jev-keywords-empty';
    emptyMsg.textContent = 'No strong keywords identified above 60% threshold.';
    listContainer.appendChild(emptyMsg);
  } else {
    for (const item of filtered) {
      const chip = document.createElement('span');
      chip.className = 'jev-keyword-chip';
      chip.innerHTML = `<span class="jev-kw-text">${item.word}</span>`;
      listContainer.appendChild(chip);
    }
  }

  container.appendChild(listContainer);
  document.body.appendChild(container);
}

