// ============================================================
// Brave Biometric Lock — Content Script
// ============================================================

(function () {
    'use strict';

    let lockOverlay = null;
    let isCurrentlyLocked = false;

    // ---- Check lock state on page load ----
    chrome.runtime.sendMessage({ type: 'GET_LOCK_STATE' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.isLocked && response.lockEnabled) {
            showLockOverlay();
        }
    });

    // ---- Listen for lock/unlock messages ----
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'LOCK') {
            showLockOverlay();
        } else if (message.type === 'UNLOCK') {
            hideLockOverlay();
        }
    });

    // ---- Lock Overlay ----
    function showLockOverlay() {
        if (isCurrentlyLocked) return;
        isCurrentlyLocked = true;

        // Prevent scrolling
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        // Create overlay
        lockOverlay = document.createElement('div');
        lockOverlay.id = 'brave-biometric-lock-overlay';
        lockOverlay.innerHTML = createLockHTML();

        // Inject styles
        const style = document.createElement('style');
        style.id = 'brave-biometric-lock-styles';
        style.textContent = getLockStyles();
        document.head.appendChild(style);
        document.body.appendChild(lockOverlay);

        // Wire up event handlers
        setTimeout(() => {
            const unlockBtn = lockOverlay.querySelector('#bbl-unlock-btn');
            const passwordInput = lockOverlay.querySelector('#bbl-password-input');
            const passwordSubmit = lockOverlay.querySelector('#bbl-password-submit');
            const showPasswordBtn = lockOverlay.querySelector('#bbl-show-password');

            if (unlockBtn) {
                unlockBtn.addEventListener('click', handleBiometricUnlock);
            }

            if (passwordInput && passwordSubmit) {
                passwordSubmit.addEventListener('click', handlePasswordUnlock);
                passwordInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handlePasswordUnlock();
                });
            }

            if (showPasswordBtn) {
                showPasswordBtn.addEventListener('click', togglePasswordSection);
            }
        }, 100);
    }

    function hideLockOverlay() {
        isCurrentlyLocked = false;

        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';

        const overlay = document.getElementById('brave-biometric-lock-overlay');
        const styles = document.getElementById('brave-biometric-lock-styles');

        if (overlay) {
            overlay.classList.add('bbl-unlocking');
            setTimeout(() => overlay.remove(), 500);
        }
        if (styles) {
            setTimeout(() => styles.remove(), 500);
        }
    }

    // ---- Auth Handlers ----
    async function handleBiometricUnlock() {
        const statusEl = lockOverlay.querySelector('#bbl-status');
        const unlockBtn = lockOverlay.querySelector('#bbl-unlock-btn');
        const fingerprintIcon = lockOverlay.querySelector('#bbl-fingerprint');

        if (statusEl) statusEl.textContent = 'Redirecting to unlock...';
        if (statusEl) statusEl.className = 'bbl-status bbl-status-pending';
        if (unlockBtn) unlockBtn.disabled = true;
        if (fingerprintIcon) fingerprintIcon.classList.add('bbl-pulse');

        // Navigate to the lock page where WebAuthn can run in the extension context
        window.location.href = chrome.runtime.getURL('lock/lock.html');
    }

    async function handlePasswordUnlock() {
        const passwordInput = lockOverlay.querySelector('#bbl-password-input');
        const password = passwordInput?.value;

        if (!password) {
            showStatus('Please enter your password', 'error');
            return;
        }

        chrome.runtime.sendMessage(
            { type: 'AUTHENTICATE_PASSWORD', password },
            (response) => {
                if (response && response.success) {
                    showStatus('Authenticated!', 'success');
                } else {
                    showStatus(response?.error || 'Incorrect password', 'error');
                    if (passwordInput) {
                        passwordInput.value = '';
                        passwordInput.focus();
                    }
                }
            }
        );
    }

    function showStatus(text, type) {
        const statusEl = lockOverlay?.querySelector('#bbl-status');
        if (statusEl) {
            statusEl.textContent = text;
            statusEl.className = `bbl-status bbl-status-${type}`;
        }
    }

    function togglePasswordSection() {
        const section = lockOverlay?.querySelector('#bbl-password-section');
        if (section) {
            section.classList.toggle('bbl-visible');
            const input = section.querySelector('#bbl-password-input');
            if (input) input.focus();
        }
    }

    // ---- HTML Template ----
    function createLockHTML() {
        return `
      <div class="bbl-container">
        <div class="bbl-card">
          <div class="bbl-glow"></div>

          <div id="bbl-fingerprint" class="bbl-fingerprint">
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
          
          <button id="bbl-unlock-btn" class="bbl-unlock-btn">
            <span class="bbl-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
                <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
                <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
                <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
              </svg>
            </span>
            Unlock with Touch ID
          </button>

          <p id="bbl-status" class="bbl-status"></p>

          <button id="bbl-show-password" class="bbl-text-btn">
            Use password instead
          </button>

          <div id="bbl-password-section" class="bbl-password-section">
            <div class="bbl-input-group">
              <input 
                type="password" 
                id="bbl-password-input" 
                class="bbl-input" 
                placeholder="Enter fallback password"
                autocomplete="off"
              />
              <button id="bbl-password-submit" class="bbl-submit-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <p class="bbl-footer">Brave Biometric Lock v1.0</p>
      </div>
    `;
    }

    // ---- Styles ----
    function getLockStyles() {
        return `
      #brave-biometric-lock-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background: #0a0a0f !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: bbl-fadeIn 0.4s ease-out !important;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif !important;
        -webkit-font-smoothing: antialiased !important;
      }

      #brave-biometric-lock-overlay.bbl-unlocking {
        animation: bbl-fadeOut 0.5s ease-in forwards !important;
      }

      #brave-biometric-lock-overlay * {
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .bbl-container {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 24px !important;
        width: 100% !important;
        max-width: 420px !important;
        padding: 20px !important;
      }

      .bbl-card {
        position: relative !important;
        background: rgba(255, 255, 255, 0.04) !important;
        backdrop-filter: blur(40px) !important;
        -webkit-backdrop-filter: blur(40px) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 24px !important;
        padding: 48px 40px !important;
        width: 100% !important;
        text-align: center !important;
        overflow: hidden !important;
      }

      .bbl-glow {
        position: absolute !important;
        top: -80px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: 200px !important;
        height: 200px !important;
        background: radial-gradient(circle, rgba(251, 146, 60, 0.15) 0%, transparent 70%) !important;
        pointer-events: none !important;
        animation: bbl-glowPulse 4s ease-in-out infinite !important;
      }

      .bbl-fingerprint {
        width: 80px !important;
        height: 80px !important;
        margin: 0 auto 24px !important;
        color: #fb923c !important;
        transition: all 0.3s ease !important;
        position: relative !important;
      }

      .bbl-fingerprint svg {
        width: 100% !important;
        height: 100% !important;
        filter: drop-shadow(0 0 20px rgba(251, 146, 60, 0.3)) !important;
      }

      .bbl-fingerprint.bbl-pulse {
        animation: bbl-fingerprintPulse 1.5s ease-in-out infinite !important;
      }

      .bbl-fingerprint.bbl-success {
        color: #34d399 !important;
        animation: bbl-successPop 0.5s ease-out !important;
      }

      .bbl-title {
        font-size: 28px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
        margin-bottom: 4px !important;
        letter-spacing: -0.5px !important;
      }

      .bbl-unlock-btn {
        display: inline-flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 14px 32px !important;
        margin-top: 24px !important;
        background: linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%) !important;
        color: #fff !important;
        font-size: 16px !important;
        font-weight: 600 !important;
        border: none !important;
        border-radius: 14px !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        letter-spacing: -0.2px !important;
        box-shadow: 0 4px 24px rgba(249, 115, 22, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
      }

      .bbl-unlock-btn:hover:not(:disabled) {
        transform: translateY(-2px) !important;
        box-shadow: 0 8px 32px rgba(249, 115, 22, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
      }

      .bbl-unlock-btn:active:not(:disabled) {
        transform: translateY(0) !important;
      }

      .bbl-unlock-btn:disabled {
        opacity: 0.6 !important;
        cursor: not-allowed !important;
      }

      .bbl-btn-icon {
        display: flex !important;
        align-items: center !important;
      }

      .bbl-status {
        margin-top: 16px !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        min-height: 20px !important;
        transition: all 0.3s ease !important;
      }

      .bbl-status-pending { color: #fbbf24 !important; }
      .bbl-status-success { color: #34d399 !important; }
      .bbl-status-error { color: #f87171 !important; }

      .bbl-text-btn {
        background: none !important;
        border: none !important;
        color: rgba(255, 255, 255, 0.35) !important;
        font-size: 13px !important;
        cursor: pointer !important;
        padding: 8px !important;
        margin-top: 12px !important;
        transition: color 0.2s ease !important;
        font-weight: 500 !important;
      }

      .bbl-text-btn:hover {
        color: rgba(255, 255, 255, 0.65) !important;
      }

      .bbl-password-section {
        max-height: 0 !important;
        overflow: hidden !important;
        transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease !important;
        opacity: 0 !important;
      }

      .bbl-password-section.bbl-visible {
        max-height: 100px !important;
        opacity: 1 !important;
        margin-top: 16px !important;
      }

      .bbl-input-group {
        display: flex !important;
        gap: 8px !important;
      }

      .bbl-input {
        flex: 1 !important;
        padding: 12px 16px !important;
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 12px !important;
        color: #fff !important;
        font-size: 14px !important;
        outline: none !important;
        transition: border-color 0.2s ease !important;
        font-family: inherit !important;
      }

      .bbl-input:focus {
        border-color: rgba(251, 146, 60, 0.5) !important;
      }

      .bbl-input::placeholder {
        color: rgba(255, 255, 255, 0.25) !important;
      }

      .bbl-submit-btn {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 48px !important;
        background: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 12px !important;
        color: #fff !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
      }

      .bbl-submit-btn:hover {
        background: rgba(251, 146, 60, 0.2) !important;
        border-color: rgba(251, 146, 60, 0.3) !important;
      }

      .bbl-footer {
        font-size: 11px !important;
        color: rgba(255, 255, 255, 0.15) !important;
        font-weight: 500 !important;
        letter-spacing: 0.5px !important;
        text-transform: uppercase !important;
      }

      /* ---- Animations ---- */
      @keyframes bbl-fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes bbl-fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      @keyframes bbl-glowPulse {
        0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
        50% { opacity: 1; transform: translateX(-50%) scale(1.2); }
      }

      @keyframes bbl-fingerprintPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.7; }
      }

      @keyframes bbl-successPop {
        0% { transform: scale(1); }
        50% { transform: scale(1.3); }
        100% { transform: scale(1); }
      }
    `;
    }

    // ---- Block keyboard shortcuts when locked ----
    document.addEventListener('keydown', (e) => {
        if (!isCurrentlyLocked) return;

        // Allow password input keystrokes
        if (e.target && e.target.id === 'bbl-password-input') return;

        // Block everything else
        e.preventDefault();
        e.stopPropagation();
    }, true);

    // Block right-click when locked
    document.addEventListener('contextmenu', (e) => {
        if (isCurrentlyLocked) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
})();
