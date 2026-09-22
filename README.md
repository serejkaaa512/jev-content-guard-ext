# Jev Content Guard

A **Manifest V3** browser extension that filters out fraud, advertising, AI slop, spam, clickbait, "info-gypsy" schemes, and toxicity on any web page — powered by the [TypeSafe Jev AI](https://api.typesafe.ai) content analysis API.

## ✨ Features

- **Automatic content scanning** — the extension analyzes page text in the background as you browse (including dynamically added content via `MutationObserver`).
- **7 detection categories**, each reported by the Jev AI model with a probability score:
  | Flag | Badge | Category |
  |---|---|---|
  | `is_fraud` | ⚠️ scam | Phishing, scams, fraudulent financial setups |
  | `is_advertising` | 📢 adv | Paid ads, sponsored messages, tracking promotion |
  | `is_ai_generated` | 🤖 AI | Low-effort, repetitive AI-generated slop |
  | `is_spam` | 🚫 spam | Contextless clutter, bot phrases, automated spam |
  | `is_clickbait` | 🪤 bait | Shocking headlines, "read the full story" bait |
  | `is_infobusiness` | 🤡 guru | Course selling, "success gurus", marathons, mentorship |
  | `is_toxic` | 🤬 toxic | Insults, profanity, hate incitement |
- **Two-tier configurable thresholds**:
  - **Lower threshold** — probability at/above this value flags the element.
  - **Upper limit** — probability above this value triggers *hard mode* (content is blurred with an overlay); otherwise *soft mode* shows a small dismissible badge in the corner.
- **Privacy-friendly storage** — the API key and settings live only in `chrome.storage.local` on your machine.

## 📦 Project Structure

```
jev-content-guard-ext/
├── manifest.json    # MV3 extension manifest (permissions, scripts, popup)
├── background.js    # Service worker: proxies analysis requests to the Jev API
├── content.js       # Content script: scans DOM, queues text, renders badges/overlays
├── popup.html       # Settings popup UI (API key + threshold grid)
├── popup.js         # Popup logic: load/save API key and thresholds
└── styles.css       # Badge & blur overlay styling, per-category color themes
```

## ⚙️ How It Works

1. **`content.js`** runs on all pages (`<all_urls>`). It selects candidate text blocks (`p`, `article`, `section`, `li`, `[role="article"]`, and several site-specific selectors, e.g. Habr classes), skipping navigation, headers, footers, forms, and nested containers (only innermost elements are analyzed).
2. Text is normalized (whitespace collapsed) and filtered by length — between **60** and **4000** characters. Elements are queued and processed in batches (debounced 400 ms, max **3 concurrent** requests), then tracked in a `WeakSet` so each element is analyzed only once.
3. The content script sends an `analyzeContent` message to **`background.js`** (the service worker), which is the only component allowed to call the API.
4. **`background.js`** POSTs the text to `https://api.typesafe.ai/v1/systemone` (model `jev-latest`) with per-category questions, using your API key (`Authorization: Bearer ...`).
5. **`content.js`** reads the returned probabilities, picks the first matching flag in priority order (fraud → advertising → AI → spam → clickbait → infobusiness → toxicity), and decorates the element:
   - *Soft mode* (probability ≤ upper limit): a compact badge pinned to the element's corner; click to dismiss.
   - *Hard mode* (probability > upper limit): a blur overlay covering the element; click the badge to reveal it.

Both `{ probability: N }` and the native Jev format `{ type: "noul", noul: N }` responses are supported.

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
4. Click **Save settings** — thresholds are applied to open tabs instantly via the `chrome.storage.onChanged` listener.

## 🔐 Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Store API key and thresholds locally |
| `activeTab` / `scripting` | Interact with the current page |
| `host_permissions: https://api.typesafe.ai/*` | Call the Jev analysis API |
| Content script on `<all_urls>` | Scan text on every page you visit |

## 🛡️ Privacy Notes

- The API key never leaves your browser except in requests to `api.typesafe.ai`.
- Page text is sent to the TypeSafe Jev API for analysis — do not use the extension on pages whose content you are not allowed to submit to third-party services.
- No analytics, tracking, or external servers are involved.

## 🛠️ Tech Stack

- Plain JavaScript (ES2020+), no build step, no dependencies.
- Chrome Extensions **Manifest V3** (service worker + content scripts + action popup).
- Native `MutationObserver`, `WeakSet`, and `chrome.storage` APIs.

## 📄 License

MIT — see repository for details.
