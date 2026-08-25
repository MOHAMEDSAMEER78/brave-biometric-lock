// ============================================================
// Brave Biometric Lock v2 — Content Script
// ============================================================

(function () {
  'use strict';

  let isLocked = false;
  let overlayRoot = null;

  // Guard: wait until body is available before doing anything DOM-related
  function ready(fn) {
    if (document.body) {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  }

  // Check lock state on page load
  chrome.runtime.sendMessage({ type: 'GET_LOCK_STATE' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.isLocked && response.lockEnabled) {
      ready(showOverlay);
    }
  });

  // Listen for lock/unlock broadcasts from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LOCK') ready(showOverlay);
    if (message.type === 'UNLOCK') hideOverlay();
  });

  // ---- Overlay ----

  function showOverlay() {
    if (isLocked) return;
    isLocked = true;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    const style = document.createElement('style');
    style.id = 'bbl-style';
    style.textContent = overlayCSS();
    document.head.appendChild(style);

    overlayRoot = document.createElement('div');
    overlayRoot.id = 'bbl-overlay';
    overlayRoot.setAttribute('role', 'dialog');
    overlayRoot.setAttribute('aria-modal', 'true');
    overlayRoot.setAttribute('aria-label', 'Browser Locked');
    overlayRoot.innerHTML = overlayHTML();
    document.body.appendChild(overlayRoot);

    wireEvents();
  }

  function hideOverlay() {
    if (!isLocked) return;
    isLocked = false;

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    const overlay = document.getElementById('bbl-overlay');
    const style = document.getElementById('bbl-style');

    if (overlay) {
      overlay.classList.add('bbl-out');
      setTimeout(() => overlay.remove(), 400);
    }
    if (style) setTimeout(() => style.remove(), 400);
    overlayRoot = null;
  }

  function wireEvents() {
    // Biometric unlock — navigate to the extension lock page which has
    // WebAuthn context (content scripts cannot call navigator.credentials)
    const biometricBtn = document.getElementById('bbl-biometric-btn');
    if (biometricBtn) {
      biometricBtn.addEventListener('click', () => {
        biometricBtn.disabled = true;
        document.getElementById('bbl-status').textContent = 'Opening unlock screen...';
        document.getElementById('bbl-status').className = 'bbl-status bbl-pending';
        window.location.href = chrome.runtime.getURL('lock/lock.html');
      });
    }

    // Password unlock
    const passwordBtn = document.getElementById('bbl-password-btn');
    const passwordInput = document.getElementById('bbl-pw-input');
    const passwordSection = document.getElementById('bbl-pw-section');
    const toggleBtn = document.getElementById('bbl-toggle-pw');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const hidden = passwordSection.getAttribute('aria-hidden') !== 'false';
        passwordSection.setAttribute('aria-hidden', String(!hidden));
        passwordSection.classList.toggle('bbl-visible', hidden);
        if (hidden && passwordInput) passwordInput.focus();
      });
    }

    if (passwordBtn) {
      passwordBtn.addEventListener('click', submitPassword);
    }
    if (passwordInput) {
      passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitPassword();
      });
    }
  }

  function submitPassword() {
    const input = document.getElementById('bbl-pw-input');
    const pw = input ? input.value : '';
    if (!pw) {
      setStatus('Enter your password.', 'error');
      return;
    }

    chrome.runtime.sendMessage({ type: 'AUTHENTICATE_PASSWORD', password: pw }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('Connection error. Reload the page.', 'error');
        return;
      }
      if (response && response.success) {
        setStatus('Authenticated!', 'success');
      } else {
        const msg = response && response.rateLimited
          ? response.error
          : 'Incorrect password.';
        setStatus(msg, 'error');
        if (input) { input.value = ''; input.focus(); }
      }
    });
  }

  function setStatus(text, type) {
    const el = document.getElementById('bbl-status');
    if (el) {
      el.textContent = text;
      el.className = `bbl-status bbl-${type}`;
    }
  }

  // ---- Keyboard / context-menu blocking while locked ----

  document.addEventListener('keydown', (e) => {
    if (!isLocked) return;
    // Allow typing in the password field
    if (e.target && e.target.id === 'bbl-pw-input') return;
    // Block all other keyboard events (including F12, Ctrl+L, etc.)
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  document.addEventListener('contextmenu', (e) => {
    if (isLocked) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // ---- Templates ----

  function overlayHTML() {
    return `
      <div class="bbl-wrap">
        <div class="bbl-card">
          <div class="bbl-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
              <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
              <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
              <path d="M2 12a10 10 0 0 1 18-6"/>
              <path d="M2 16h.01"/>
              <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
              <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
              <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
              <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>
            </svg>
          </div>
          <h1 class="bbl-title">Browser Locked</h1>
          <button id="bbl-biometric-btn" class="bbl-primary-btn">Unlock with Biometrics</button>
          <p id="bbl-status" class="bbl-status" aria-live="polite"></p>
          <button id="bbl-toggle-pw" class="bbl-ghost-btn">Use password instead</button>
          <div id="bbl-pw-section" class="bbl-pw-section" aria-hidden="true">
            <div class="bbl-row">
              <input type="password" id="bbl-pw-input" class="bbl-input"
                placeholder="Fallback password" autocomplete="off" aria-label="Fallback password">
              <button id="bbl-password-btn" class="bbl-submit-btn" aria-label="Submit password">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <p class="bbl-footer">Brave Biometric Lock v2</p>
      </div>
    `;
  }

  function overlayCSS() {
    return `
      #bbl-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        background: #0a0a0f !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        -webkit-font-smoothing: antialiased !important;
        animation: bbl-in 0.35s ease-out !important;
      }
      #bbl-overlay.bbl-out { animation: bbl-out 0.4s ease-in forwards !important; }
      #bbl-overlay * { box-sizing: border-box !important; margin: 0 !important; padding: 0 !important; }
      .bbl-wrap { display: flex !important; flex-direction: column !important; align-items: center !important; gap: 20px !important; width: 100% !important; max-width: 400px !important; padding: 20px !important; }
      .bbl-card { background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 24px !important; padding: 48px 40px !important; width: 100% !important; text-align: center !important; }
      .bbl-icon { width: 72px !important; height: 72px !important; margin: 0 auto 20px !important; color: #fb923c !important; }
      .bbl-icon svg { width: 100% !important; height: 100% !important; filter: drop-shadow(0 0 16px rgba(251,146,60,0.35)) !important; }
      .bbl-title { font-size: 26px !important; font-weight: 700 !important; color: #fff !important; margin-bottom: 0 !important; letter-spacing: -0.4px !important; }
      .bbl-primary-btn { display: inline-flex !important; align-items: center !important; gap: 8px !important; padding: 13px 28px !important; margin-top: 22px !important; background: linear-gradient(135deg, #fb923c, #f97316) !important; color: #fff !important; font-size: 15px !important; font-weight: 600 !important; border: none !important; border-radius: 13px !important; cursor: pointer !important; box-shadow: 0 4px 20px rgba(249,115,22,0.3) !important; transition: transform 0.15s, box-shadow 0.15s !important; font-family: inherit !important; }
      .bbl-primary-btn:hover:not(:disabled) { transform: translateY(-2px) !important; box-shadow: 0 8px 28px rgba(249,115,22,0.4) !important; }
      .bbl-primary-btn:disabled { opacity: 0.55 !important; cursor: not-allowed !important; }
      .bbl-status { font-size: 13px !important; font-weight: 500 !important; min-height: 18px !important; margin-top: 14px !important; }
      .bbl-pending { color: #fbbf24 !important; }
      .bbl-success { color: #34d399 !important; }
      .bbl-error { color: #f87171 !important; }
      .bbl-ghost-btn { background: none !important; border: none !important; color: rgba(255,255,255,0.3) !important; font-size: 12px !important; cursor: pointer !important; padding: 8px !important; margin-top: 10px !important; font-family: inherit !important; transition: color 0.2s !important; }
      .bbl-ghost-btn:hover { color: rgba(255,255,255,0.6) !important; }
      .bbl-pw-section { max-height: 0 !important; overflow: hidden !important; transition: max-height 0.3s ease !important; opacity: 0 !important; }
      .bbl-pw-section.bbl-visible { max-height: 80px !important; opacity: 1 !important; margin-top: 14px !important; }
      .bbl-row { display: flex !important; gap: 8px !important; }
      .bbl-input { flex: 1 !important; padding: 11px 14px !important; background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 11px !important; color: #fff !important; font-size: 14px !important; outline: none !important; font-family: inherit !important; }
      .bbl-input:focus { border-color: rgba(251,146,60,0.5) !important; }
      .bbl-input::placeholder { color: rgba(255,255,255,0.25) !important; }
      .bbl-submit-btn { display: flex !important; align-items: center !important; justify-content: center !important; width: 44px !important; background: rgba(255,255,255,0.07) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 11px !important; color: #fff !important; cursor: pointer !important; transition: background 0.2s !important; }
      .bbl-submit-btn:hover { background: rgba(251,146,60,0.2) !important; }
      .bbl-footer { font-size: 10px !important; color: rgba(255,255,255,0.12) !important; font-weight: 500 !important; letter-spacing: 0.5px !important; text-transform: uppercase !important; }
      @keyframes bbl-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes bbl-out { from { opacity: 1; } to { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        #bbl-overlay, #bbl-overlay.bbl-out { animation: none !important; }
      }
    `;
  }
})();
