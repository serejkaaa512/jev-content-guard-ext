const SELECTION_MENU_ID = 'jev-analyze-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: SELECTION_MENU_ID,
    title: 'Jev Content Guard: check selection',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU_ID || !tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { action: 'analyzeSelection' }, () => {
    // The content script may be absent (e.g. browser internal pages).
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeContent") {
    chrome.storage.local.get(['jevApiKey'], async (result) => {
      const userApiKey = result.jevApiKey;

      if (!userApiKey) {
        sendResponse({ error: "Missing API Key. Please click the extension icon to set it." });
        return;
      }

      try {
        const response = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${userApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "jev-latest",
            state: request.text,
            questions: {
              is_fraud: { type: "noul", instructions: "Does this text contain phishing attempts, malicious scams, or fraudulent financial setups?" },
              is_advertising: { type: "noul", instructions: "Is this text a paid advertisement, sponsored message, or tracking promotion?" },
              is_ai_generated: { type: "noul", instructions: "Is this content low-effort, structurally repetitive AI-generated slop?" },
              is_spam: { type: "noul", instructions: "Is this contextless clutter, repeated bot phrases, or automated spam?" },
              is_clickbait: { type: "noul", instructions: "Is this text clickbait, a shocking headline, or bait for a click or Telegram-channel subscription (e.g. 'Read the full story at the source')?" },
              is_infobusiness: { type: "noul", instructions: "Does this text show signs of infobusiness, aggressive course selling, 'success gurus', marathons, or questionable mentorship?" },
              is_toxic: { type: "noul", instructions: "Does this text contain open insults, harsh toxicity, profanity, hate incitement, or aggressive hate?" },
              is_plagiat: { type: "noul", instructions: "Is this text plagiarized, near-duplicated from another source, or lifted content without attribution?" }
            }
          })
        });

        if (!response.ok) {
          let message = `HTTP error! status: ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData && (errorData.message || errorData.error)) {
              message = errorData.message || errorData.error.message || message;
            }
          } catch (_) { /* non-JSON error body */ }
          throw new Error(message);
        }

        const data = await response.json();
        // API returns { answers: { is_fraud: { type, noul }, ... } }
        sendResponse({ success: true, results: data.answers || data.results });

      } catch (err) {
        console.error("Jev API Error:", err);
        sendResponse({ error: err.message });
      }
    });

    return true;
  }
});