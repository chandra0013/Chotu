const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VERIFY_URL = 'https://api.groq.com/openai/v1/models';
const INJECTABLE_PROTOCOLS = new Set(['http:', 'https:']);

const SYSTEM_PROMPT = `You are an elite prompt engineer. Your only task is to transform a rough, vague user prompt into a precision-crafted prompt that maximizes AI response quality and accuracy.

Analyze the prompt and improve it across these dimensions:

1. ROLE - Add an expert persona when helpful: "Act as a senior DevOps engineer..."
2. CLARITY - Replace every vague word with a specific one. "good code" -> "production-ready code with error handling and comments"
3. CONTEXT - Add what the AI needs to know: use case, audience, constraints, environment.
4. OUTPUT FORMAT - Specify exactly how the response should be structured: numbered steps, markdown table, code block only, etc.
5. REASONING TRIGGER - For complex tasks add: "Think step by step before answering."
6. QUALITY ANCHORS - Add: "include real-world examples", "consider edge cases", "be comprehensive but concise"
7. SCOPE - State what to include AND what to exclude.

STRICT RULES:
- Return ONLY the refined prompt text. No preamble, no "Here is the refined version:", no quotes.
- The output must be ready to paste directly into any AI chat.
- Preserve the original intent 100%. Enhance expression, never change the goal.
- Keep the refined prompt under 250 words unless the task genuinely requires more.
- Do not add fictional details not implied by the original.`;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refinePrompt') {
    refinePrompt(request.text)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === 'verifyKey') {
    verifyKey(request.apiKey)
      .then((valid) => sendResponse({ valid }))
      .catch(() => sendResponse({ valid: false }));
    return true;
  }

  if (request.action === 'refine-manual') {
    (async () => {
      const tabId = request.tabId;
      await ensureContentScript(tabId);
      chrome.tabs.sendMessage(tabId, { action: 'refine-command' });
    })();
    return false;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'refine-prompt') {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  await ensureContentScript(tab.id);

  chrome.tabs.sendMessage(tab.id, { action: 'refine-command' }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[Chotu] Could not send refine command:', chrome.runtime.lastError.message);
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenTabs().catch((error) => {
    console.warn('[Chotu] Initial tab injection failed:', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenTabs().catch((error) => {
    console.warn('[Chotu] Startup tab injection failed:', error);
  });
});

async function refinePrompt(text) {
  const data = await chrome.storage.local.get(['apiKey']);
  const apiKey = data.apiKey;

  if (!apiKey) return { error: 'NO_KEY' };

  async function tryFetch(modelId) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Refine this prompt:\n\n${text}` }
          ],
          max_tokens: 1024,
          temperature: 0.2
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  try {
    // Try Llama 3.3 70B first
    let res = await tryFetch('llama-3.3-70b-versatile');

    // Fallback to Llama 3.1 70B if 3.3 is not found/available
    if (res.status === 404 || res.status === 400) {
      res = await tryFetch('llama-3.1-70b-versatile');
    }

    if (res.status === 401) return { error: 'INVALID_KEY: Your Groq API key is invalid or has expired.' };
    if (res.status === 429) return { error: 'RATE_LIMIT: Groq is rate-limiting your key. Wait 1 min.' };

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.error?.message || `Groq Error ${res.status}`;
      return { error: errMsg };
    }

    const json = await res.json();
    const refined = json?.choices?.[0]?.message?.content?.trim();
    
    if (!refined) return { error: 'Groq returned an empty response. Try a different prompt.' };
    return { refined };
  } catch (err) {
    console.error('[Chotu] API Call failed:', err);
    if (err.name === 'AbortError') return { error: 'Timeout: Groq took too long to respond.' };
    return { error: 'Network Error: Check your internet or VPN. (' + err.message + ')' };
  }
}

async function verifyKey(apiKey) {
  // Permissive verification: if it looks like a key, we let them proceed.
  // We'll catch actual API errors during the refinement process.
  if (!apiKey || !apiKey.startsWith('gsk_')) return false;
  
  if (apiKey.length < 40) return false;

  // We still do a silent background check but don't block the UI
  try {
    fetch(VERIFY_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
  } catch (e) {}

  return true;
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !canInjectIntoUrl(tab.url)) {
      return;
    }

    await ensureContentScript(tab.id);
  }));
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles.css']
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes('Duplicate CSS')) {
      console.warn('[Chotu] CSS injection skipped:', message);
    }
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes('Cannot access') && !message.includes('The extensions gallery cannot be scripted')) {
      console.warn('[Chotu] Script injection skipped:', message);
    }
  }
}

function canInjectIntoUrl(url) {
  if (!url) {
    return false;
  }

  try {
    return INJECTABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch (error) {
    return false;
  }
}
