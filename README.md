# Jev Content Guard

A **Manifest V3** browser extension that filters out fraud, advertising, AI slop, spam, clickbait, "info-gypsy" schemes, and toxicity on any web page, and extracts & highlights core key words from selections or whole pages — powered by the [TypeSafe Jev AI](https://api.typesafe.ai) content analysis API.

## ✨ Features

- **Automatic content scanning** — the extension analyzes page text in the background as you browse (including dynamically added content via `MutationObserver`).
- **Selectable scan scope** — choose in the popup between *Entire page* (automatic scanning) and *Selection only* (nothing is scanned until you ask for it).
- **Excluded pages / domains** — configure a list of pages, domains, or wildcard patterns (e.g. `example.com`, `github.com/my-repo/*`) that will be excluded from automatic detection and scanning. The list is shown only for the *Entire page* scope (it applies to automatic scanning) and is preserved when switching to *Selection only*.
- **Compact card popup** — every block sits in its own rounded card (API token · thresholds · scan scope · exclusions). The scope and exclusion labels carry hover tooltips, a successful save flashes a green ✓ on the **Save settings** button, and the footer strip reminds you how to extract key words (validation errors appear there in red).
- **Context menu actions**:
  - **Check selection**: Select any fragment of a page, right-click and choose **“Jev: check selection”** to analyze content categories and pin matching badges next to it.
  - **Extract main words from selection**: Select any fragment, right-click and choose **“Jev: keywords in selection”** to ask Jev which words have the most meaning and core significance.
  - **Extract main words from page**: Right-click anywhere on the page and choose **“Jev: keywords on page”** to extract key conceptual words across the main content of the entire page.
- **Key Word Extraction & Highlighting**:
  - **Extraction without generation**: Since Jev evaluates parallel structured questions rather than generating text, words are tokenized client-side, filtered against multilingual stop words (English, Russian, Spanish, French, German, Chinese), and evaluated in parallel via Jev `noul` questions.
  - **Strict threshold (≥ 60%)**: Only words judged to carry the core meaning of the text qualify.
  - **Jev semantic deduplication**: Synonyms and morphological variants are compared pairwise via Jev in the context of the text; redundant terms are deduplicated automatically.
  - **Original order & casing preserved**: Words stay in the exact casing and sequence in which they appear in the original text.
  - **In-text highlighting & interactive navigation**: Words above the threshold are highlighted in the document with `<mark>`. Clicking any keyword chip in the floating card smoothly scrolls and centers the viewport on that word, cycling through multiple occurrences.
  - **Sticky viewport placement**: The floating keywords card stays fixed in view during scrolling.
  - **Automatic cleanup**: Closing the card, clicking any link on the page, or closing/navigating away from the page immediately unmounts the card and restores text nodes back to normal.
- **8 detection categories**, each reported by the Jev AI model with a probability score:
  | Flag | Badge | Category |
  |---|---|---|
  | `is_fraud` | ⚠️ scam | Phishing, scams, fraudulent financial setups |
  | `is_advertising` | 📢 adv | Paid ads, sponsored messages, tracking promotion |
  | `is_ai_generated` | 🤖 AI | Low-effort, repetitive AI-generated slop |
  | `is_spam` | 🚫 spam | Contextless clutter, bot phrases, automated spam |
  | `is_clickbait` | 🪤 bait | Shocking headlines, "read the full story" bait |
  | `is_infobusiness` | 🤡 guru | Course selling, "success gurus", marathons, mentorship |
  | `is_toxic` | 🤬 toxic | Incitement, profanity, hate incitement |
  | `is_plagiat` | 📕 plag | Plagiarized, near-duplicated from another source |
- **Two-tier configurable thresholds**:
  - **Lower threshold** — probability at/above this value flags the element.
  - **Upper limit** — probability above this value triggers *hard mode* (content is blurred with an overlay); otherwise *soft mode* shows a small dismissible badge in the corner.
- **Privacy-friendly storage** — the API key and settings live only in `chrome.storage.local` on your machine.

## 📦 Project Structure

```
jev-content-guard-ext/
├── manifest.json    # MV3 extension manifest (permissions, scripts, popup, description)
├── background.js    # Service worker: context menu entries + proxies category & keyword requests to Jev API
├── content.js       # Content script: DOM scanning, keyword extraction & highlighting, badges/overlays
├── popup.html       # Settings popup UI: one card per block (API key · thresholds · scan scope · exclusions)
├── popup.js         # Popup logic: load/save settings, scope-dependent exclusion card, save feedback
└── styles.css       # Badge, blur overlay, floating keyword card & text highlight styling
```

## ⚙️ How It Works

### 1. Safety & Content Guard Scanning
1. **`content.js`** runs on all pages (`<all_urls>`). It selects candidate text blocks (`p`, `article`, `section`, `li`, `[role="article"]`, and several site-specific selectors, e.g. Habr classes), skipping navigation, headers, footers, forms, and nested containers (only innermost elements are analyzed).
2. Text is normalized (whitespace collapsed) and filtered by length — between **60** and **4000** characters. Elements are queued and processed in batches (debounced 400 ms, max **3 concurrent** requests), then tracked in a `WeakSet` so each element is analyzed only once.
3. The content script sends an `analyzeContent` message to **`background.js`** (the service worker), which is the only component allowed to call the API.
4. **`background.js`** POSTs the text to `https://api.typesafe.ai/v1/systemone` (model `jev-latest`) with per-category questions, using your API key (`Authorization: Bearer ...`).
5. **`content.js`** reads the returned probabilities, picks the first matching flag in priority order (fraud → advertising → AI → spam → clickbait → infobusiness → toxicity), and decorates the element:
   - *Soft mode* (probability ≤ upper limit): a compact badge pinned to the element's corner; click to dismiss.
   - *Hard mode* (probability > upper limit): a blur overlay covering the element; click the badge to reveal it.

Both `{ probability: N }` and the native Jev format `{ type: "noul", noul: N }` responses are supported.

6. **Scan scope** (`jevScanScope` setting in the popup):
   - *Entire page* — the automatic pipeline above runs as you browse.
   - *Selection only* — automatic scanning is disabled; analysis runs only through the context-menu item. The selected fragment (no minimum length, capped at 4000 characters) goes through the same API, and **all** flags above their thresholds are rendered as dismissible badges pinned next to the selection (short selections included — the automatic top-match-only rule does not apply here).

7. **Excluded pages** (`jevExcludedUrls`, shown for *Entire page* only): each line is a domain (`example.com` — also matches its subdomains), a path or full-URL pattern, and `*` wildcards are supported (`github.com/my-repo/*`). Matching pages are skipped completely — nothing is queued and any pending items are dropped.

### 2. Main Words (Keyword) Extraction Pipeline
1. **Candidate Extraction**: Selected text or page content is tokenized into word candidates using Unicode letter segmentation (`\p{L}+`). Stop words across 6 languages (English, Russian, Spanish, French, German, Chinese) and words shorter than 3 characters are removed. Original order of appearance and casing are preserved.
2. **Parallel Jev Evaluation**: `background.js` asks Jev parallel `noul` questions asking if each candidate represents a core keyword carrying the key meaning of the text.
3. **Threshold & Deduplication**: Only words with $\ge 60\%$ significance qualify. If multiple words qualify, Jev checks pairs for identical semantic meaning or synonymy in context, deduplicating redundant items.
4. **Interactive Display & Navigation**:
   - The qualifying words are rendered in a fixed floating card on screen.
   - All occurrences of the words are highlighted directly in the document body.
   - Clicking a keyword chip smoothly scrolls to and focuses that word in the text (cycling across repeated occurrences).
   - Clicking the **Copy** button copies the words to the clipboard.
   - The card and highlights automatically dismiss when a link is clicked, when the page is closed/navigated, or when the `×` button is pressed.

## 🚀 Installation (Developer Mode)

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. The extension works in Chrome and any Chromium-based browser supporting Manifest V3.

## 🔑 Getting Started

1. Click the extension icon in the toolbar to open the settings popup.
2. Paste your **TypeSafe Jev API token** (e.g. `jev_live_...`).
3. Optionally tune per-category **lower / upper thresholds** (percent, 1–100). Defaults:
   - Fraud: 50% · Advertising: 20% · AI: 25% · Spam: 25% · Clickbait: 20% · Infobusiness: 25% · Toxicity: 25%
   - Upper limits default to 80% for all categories and must be strictly above the lower threshold.
4. With *Entire page* scope, optionally list **excluded pages / domains** (one per line: `example.com`, `github.com/my-repo/*`). The card is hidden in *Selection only* mode, but the saved list is kept.
5. Click **Save settings** — settings are applied to open tabs instantly via the `chrome.storage.onChanged` listener, and a green ✓ flashes on the button to confirm the save.
6. Highlight any fragment or right-click anywhere to use the context menu actions:
   - **Jev: check selection** — check safety & category flags for selected text.
   - **Jev: keywords in selection** — extract and highlight key conceptual words in the selected text.
   - **Jev: keywords on page** — extract and highlight key conceptual words across the entire page.

## 🔐 Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Store the API key, thresholds, scan scope and exclusion list locally |
| `activeTab` / `scripting` | Interact with the current page |
| `contextMenus` | Offer selection check and keyword extraction in the right-click menu |
| `host_permissions: https://api.typesafe.ai/*` | Call the Jev analysis API |
| Content script on `<all_urls>` | Scan text and highlight keywords on visited pages |

## 🛡️ Privacy Notes

- The API key never leaves your browser except in requests to `api.typesafe.ai`.
- Page text is sent to the TypeSafe Jev API for analysis — do not use the extension on pages whose content you are not allowed to submit to third-party services.
- No analytics, tracking, or external servers are involved.

## 🛠️ Tech Stack

- Plain JavaScript (ES2020+), no build step, no dependencies.
- Chrome Extensions **Manifest V3** (service worker + content scripts + action popup).
- Native `MutationObserver`, `TreeWalker`, `WeakSet`, and `chrome.storage` APIs.

## 📄 License

MIT — see repository for details.
