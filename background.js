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
              is_clickbait: { type: "noul", instructions: "Является ли текст кликбейтом, шокирующим заголовком или байтом на переход/подписку в Telegram-канал (например, 'Читать продолжение в источнике')?" },
              is_infobusiness: { type: "noul", instructions: "Содержит ли текст признаки инфоцыганства, агрессивной продажи курсов, успешного успеха, марафонов или сомнительного наставничества?" },
              is_toxic: { type: "noul", instructions: "Содержит ли текст открытые оскорбления, жесткую токсичность, мат, разжигание ненависти или агрессивный хейт?" }
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