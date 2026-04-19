'use strict';

if (!window.__chotuLoaded) {
  window.__chotuLoaded = true;

  let isRefining = false;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refine-command') {
      const active = getActiveEditableElement();

      if (isEditableElement(active) && !isRefining) {
        startRefine(active);
      } else {
        showToast('Focus a text field first, then try Ctrl+Shift+Space', 'warning');
      }

      sendResponse({ handled: true });
      return true;
    }

    return false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.code === 'Space' && !event.altKey && !event.metaKey) {
      const active = getActiveEditableElement();

      if (!isEditableElement(active)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isRefining) {
        showToast('Already refining, please wait', 'warning');
        return;
      }

      startRefine(active);
    }
  }, true);

  function getActiveEditableElement() {
    // Phase 1: Check focused element
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;

    if (isEditableElement(el)) return el;

    // Phase 2: Search for common AI chat input selectors
    const selectors = [
      '[contenteditable="true"]',
      '[role="textbox"]',
      '#prompt-textarea', // ChatGPT
      '.ProseMirror',     // Claude
      'textarea',
      '[data-lexical-editor="true"]'
    ];

    for (const s of selectors) {
      const found = document.querySelector(s);
      if (found) return found;
    }

    return el;
  }

  function isEditableElement(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'textarea' || (tag === 'input' && el.type === 'text')) return true;
    if (el.getAttribute?.('role') === 'textbox' || el.getAttribute?.('contenteditable') === 'true') return true;
    return !!el.closest?.('[contenteditable="true"], [role="textbox"]');
  }

  function getText(el) {
    if (!el) return '';
    if (el.tagName?.toLowerCase() === 'textarea' || el.tagName?.toLowerCase() === 'input') {
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  }

  async function startRefine(el) {
    const text = getText(el).trim();

    if (text.length < 2) {
      showToast('Please type your prompt first.', 'warning');
      return;
    }

    isRefining = true;
    showToast('Connecting to Groq...', 'info');
    showOverlay();

    try {
      const result = await sendWithTimeout({ action: 'refinePrompt', text }, 20000);

      if (result.error === 'INVALID_KEY') {
        hideOverlay();
        isRefining = false;
        showToast('Invalid API Key. Please check your Groq console.', 'error');
        return;
      }

      if (result.error) {
        hideOverlay();
        isRefining = false;
        showToast('Groq Error: ' + result.error, 'error');
        return;
      }

      if (result.refined) {
        const ok = injectText(el, result.refined);
        hideOverlay();
        isRefining = false;

        if (ok) {
          showToast('Prompt refined!', 'success');
        } else {
          navigator.clipboard.writeText(result.refined);
          showToast('Refined text copied to clipboard (auto-inject failed).', 'warning');
        }
      }
    } catch (err) {
      hideOverlay();
      isRefining = false;
      showToast('Error: ' + err.message, 'error');
    }
  }

  function sendWithTimeout(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('No response from extension background. Reload the extension and try again.'));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timer);

          if (chrome.runtime.lastError) {
            setTimeout(() => {
              try {
                chrome.runtime.sendMessage(message, (retryResponse) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error('Background worker is unresponsive. Reload the extension.'));
                    return;
                  }

                  resolve(retryResponse || { error: 'Empty response' });
                });
              } catch (error) {
                reject(error);
              }
            }, 500);
            return;
          }

          resolve(response || { error: 'Empty response from background' });
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function injectText(el, newText) {
    try {
      if (!el) return false;
      el.focus();

      // Try the most modern way (execCommand but with selectAll first)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand('insertText', false, newText);

      if (!inserted) {
        // Fallback for some editors: setting property and triggering React/Vue events
        if (el.tagName?.toLowerCase() === 'textarea' || el.tagName?.toLowerCase() === 'input') {
          el.value = newText;
        } else {
          el.innerText = newText;
        }
      }

      // Vital for ChatGPT/Claude (React-based)
      const events = ['input', 'change', 'blur'];
      for (const name of events) {
        el.dispatchEvent(new Event(name, { bubbles: true, composed: true }));
      }
      
      // Specifically for Lexical/ProseMirror (Claude/ChatGPT)
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertReplacementText', data: newText, bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', data: newText, bubbles: true }));

      return true;
    } catch (error) {
      console.warn('[Chotu] inject failed:', error);
      return false;
    }
  }

  function showOverlay() {
    if (document.getElementById('pr-overlay')) return;

    const div = document.createElement('div');
    div.id = 'pr-overlay';
    div.innerHTML = `
      <div class="pr-card">
        <div class="pr-loader"></div>
        <div class="pr-text-content">
          <div class="pr-title">Refining your prompt</div>
          <div class="pr-sub">Enhancing with Prompt Engineering...</div>
        </div>
      </div>
    `;

    getUiRoot().appendChild(div);
  }

  function hideOverlay() {
    const el = document.getElementById('pr-overlay');
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => el.remove(), 400);
  }

  function showToast(msg, type = 'info') {
    document.getElementById('pr-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'pr-toast';
    toast.className = `pr-toast pr-toast-${type}`;
    toast.textContent = msg;
    getUiRoot().appendChild(toast);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0) scale(1)';
    }));

    const duration = type === 'error' ? 6000 : 3500;
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-12px) scale(0.96)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function getUiRoot() {
    return document.body || document.documentElement;
  }
}
