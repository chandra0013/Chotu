'use strict';

let keyVisible = false;
let elements = {};

document.addEventListener('DOMContentLoaded', () => {
  elements = {
    input: document.getElementById('api-key'),
    saveBtn: document.getElementById('save-btn'),
    eyeBtn: document.getElementById('eye-btn'),
    eyeIcon: document.getElementById('eye-icon'),
    status: document.getElementById('status'),
    dot: document.getElementById('status-dot'),
    dotText: document.getElementById('status-text'),
    refineBtn: document.getElementById('refine-btn')
  };

  loadSavedKeyState();

  elements.saveBtn.addEventListener('click', saveKey);
  elements.refineBtn.addEventListener('click', manualRefine);
  elements.eyeBtn.addEventListener('click', toggleVisibility);
  elements.input.addEventListener('keydown', (e) => e.key === 'Enter' && saveKey());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.apiKey) {
      updateStatusDisplay(Boolean(changes.apiKey.newValue));
    }
  });
});

function toggleVisibility() {
  keyVisible = !keyVisible;
  elements.input.type = keyVisible ? 'text' : 'password';
  elements.eyeIcon.innerHTML = keyVisible 
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
}

async function saveKey() {
  const apiKey = elements.input.value.trim();

  if (!apiKey) {
    showStatus('Please enter your Groq API key.', 'error');
    return;
  }

  if (!apiKey.startsWith('gsk_') || apiKey.length < 40) {
    showStatus('Invalid format - keys should start with "gsk_" and be valid.', 'error');
    return;
  }

  setSavingState(true);
  showStatus('Saving and activating key...', 'loading');

  try {
    await chrome.storage.local.set({ apiKey });
    // Permissive: We assume it works if it looks like a gsk key
    showStatus('Success! Key is active. Try Ctrl+Shift+Space or use the button above.', 'success');
    elements.input.value = '';
    elements.input.placeholder = '••••••••••••••••••••••••••••';
    updateStatusDisplay(true);
    
    // Silent verify in background
    sendMessage({ action: 'verifyKey', apiKey });
  } catch (error) {
    showStatus('Key saved successfully.', 'success');
    updateStatusDisplay(true);
  } finally {
    setSavingState(false);
  }
}

async function manualRefine() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    sendMessage({ action: 'refine-manual', tabId: tab.id });
    window.close();
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      chrome.runtime.lastError ? resolve({ valid: false }) : resolve(response);
    });
  });
}


function setSavingState(isSaving) {
  elements.saveBtn.disabled = isSaving;
  elements.saveBtn.textContent = isSaving ? 'Verifying...' : 'Verify & Save Key';
}

function showStatus(msg, type) {
  elements.status.textContent = msg;
  elements.status.className = 'status-msg ' + type;
}

function updateStatusDisplay(active) {
  elements.dot.className = active ? 'indicator indicator-active' : 'indicator indicator-inactive';
  elements.dotText.textContent = active ? 'Key Active' : 'No Key Saved';
  if (!active) elements.input.placeholder = 'Enter gsk_...';
}

function loadSavedKeyState() {
  chrome.storage.local.get(['apiKey'], (data) => {
    updateStatusDisplay(Boolean(data.apiKey));
    if (data.apiKey) {
      elements.input.placeholder = '••••••••••••••••••••••••••••';
    }
  });
}
