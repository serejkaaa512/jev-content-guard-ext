const SELECTION_MENU_ID = 'jev-analyze-selection';
const EXTRACT_KEYWORDS_MENU_ID = 'jev-extract-keywords';
const EXTRACT_KEYWORDS_PAGE_MENU_ID = 'jev-extract-keywords-page';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: SELECTION_MENU_ID,
    title: 'Jev: check selection',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: EXTRACT_KEYWORDS_MENU_ID,
    title: 'Jev: keywords in selection',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: EXTRACT_KEYWORDS_PAGE_MENU_ID,
    title: 'Jev: keywords on page',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === SELECTION_MENU_ID) {
    chrome.tabs.sendMessage(tab.id, { action: 'analyzeSelection' }, () => {
      void chrome.runtime.lastError;
    });
  } else if (info.menuItemId === EXTRACT_KEYWORDS_MENU_ID) {
    chrome.tabs.sendMessage(tab.id, { action: 'extractKeywords' }, () => {
      void chrome.runtime.lastError;
    });
  } else if (info.menuItemId === EXTRACT_KEYWORDS_PAGE_MENU_ID) {
    chrome.tabs.sendMessage(tab.id, { action: 'extractKeywordsPage' }, () => {
      void chrome.runtime.lastError;
    });
  }
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

  if (request.action === "extractKeywords") {
    chrome.storage.local.get(['jevApiKey'], async (result) => {
      const userApiKey = result.jevApiKey;

      if (!userApiKey) {
        sendResponse({ error: "Missing API Key. Please click the extension icon to set it." });
        return;
      }

      const words = Array.isArray(request.words) ? request.words : [];
      if (words.length === 0) {
        sendResponse({ success: true, results: [] });
        return;
      }

      // Build parallel noul questions asking if the word is a core keyword
      const questions = {};
      words.forEach((word, idx) => {
        const key = `kw_${idx}`;
        questions[key] = {
          type: "noul",
          instructions: `Does the term "${word}" represent one of the main key ideas or most significant words carrying the core meaning of this text?`
        };
      });

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
            questions: questions
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
        const answers = data.answers || data.results || {};

        // Map answer key back to word
        const qualifyingWords = [];
        words.forEach((word, idx) => {
          const key = `kw_${idx}`;
          const ans = answers[key];
          let prob = 0;
          if (ans) {
            prob = typeof ans.noul === 'number' ? ans.noul : (typeof ans.probability === 'number' ? ans.probability : 0);
          }
          if (prob >= 0.60) {
            qualifyingWords.push({ word, probability: prob });
          }
        });

        // Deduplicate words with identical/substantially identical meaning using Jev
        if (qualifyingWords.length > 1) {
          const simQuestions = {};
          let pairCount = 0;
          for (let i = 0; i < qualifyingWords.length; i++) {
            for (let j = i + 1; j < qualifyingWords.length; j++) {
              simQuestions[`sim_${i}_${j}`] = {
                type: "noul",
                instructions: `In the context of this text, do the words "${qualifyingWords[i].word}" and "${qualifyingWords[j].word}" have essentially the same meaning, refer to the identical concept, or act as morphological variants/synonyms?`
              };
              pairCount++;
            }
          }

          if (pairCount > 0) {
            try {
              const simResponse = await fetch("https://api.typesafe.ai/v1/systemone", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${userApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: "jev-latest",
                  state: request.text,
                  questions: simQuestions
                })
              });

              if (simResponse.ok) {
                const simData = await simResponse.json();
                const simAnswers = simData.answers || simData.results || {};
                const removedIndices = new Set();

                for (let i = 0; i < qualifyingWords.length; i++) {
                  if (removedIndices.has(i)) continue;
                  for (let j = i + 1; j < qualifyingWords.length; j++) {
                    if (removedIndices.has(j)) continue;
                    const ans = simAnswers[`sim_${i}_${j}`];
                    const simProb = ans ? (typeof ans.noul === 'number' ? ans.noul : (ans.probability || 0)) : 0;
                    // If similarity is high (>= 0.70), remove the lower probability word
                    // or keep the first occurrence if probabilities are equal to preserve text order.
                    if (simProb >= 0.70) {
                      if (qualifyingWords[j].probability > qualifyingWords[i].probability) {
                        removedIndices.add(i);
                        break;
                      } else {
                        removedIndices.add(j);
                      }
                    }
                  }
                }

                const deduplicated = qualifyingWords.filter((_, idx) => !removedIndices.has(idx));
                sendResponse({ success: true, results: deduplicated });
                return;
              }
            } catch (simErr) {
              console.warn("[Jev Guard] Synonym deduplication check error:", simErr);
            }
          }
        }

        sendResponse({ success: true, results: qualifyingWords });
      } catch (err) {
        console.error("Jev Keywords API Error:", err);
        sendResponse({ error: err.message });
      }
    });

    return true;
  }
});