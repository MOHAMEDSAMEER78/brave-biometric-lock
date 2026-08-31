// ============================================================
// Brave Biometric Lock v2 — Lock Screen Script
// ============================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const unlockBtn = document.getElementById('unlock-btn');
  const unlockBtnLabel = document.getElementById('unlock-btn-label');
  const passwordToggle = document.getElementById('password-toggle');
  const passwordSection = document.getElementById('password-section');
  const passwordInput = document.getElementById('password-input');
  const passwordSubmit = document.getElementById('password-submit');
  const passwordError = document.getElementById('password-error');
  const fingerprint = document.getElementById('fingerprint-icon');
  const statusEl = document.getElementById('status');
  const tabHint = document.getElementById('tab-restore-hint');
  const resetCredentialBtn = document.getElementById('reset-credential-btn');

  // ---- 1. Check biometric availability & update button label ----
  const bio = await isBiometricAvailable();
  if (bio.supported) {
    unlockBtnLabel.textContent = `Unlock with ${bio.label}`;
    unlockBtn.disabled = false;
  } else {
    unlockBtnLabel.textContent = 'Biometrics unavailable';
    unlockBtn.disabled = true;
    setStatus('Use your fallback password to unlock.', 'info');
    // Auto-open password section
    showPasswordSection();
  }

  // ---- 2. Show saved tab count hint ----
  try {
    const state = await sendMessage(MESSAGE_TYPES.GET_LOCK_STATE, {});
    if (state && state.savedTabCount > 0) {
      tabHint.textContent = `${state.savedTabCount} tab${state.savedTabCount !== 1 ? 's' : ''} will be restored`;
    }
  } catch (_) {}

  // ---- 3. Biometric unlock ----
  unlockBtn.addEventListener('click', async () => {
    unlockBtn.disabled = true;
    fingerprint.className = 'fingerprint-icon authenticating';
    setStatus('Authenticating…', 'pending');
    passwordError.textContent = '';

    const result = await verifyBiometric();

    if (result.success) {
      setStatus('Authenticated!', 'success');
      fingerprint.className = 'fingerprint-icon success';
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.BIOMETRIC_AUTH_SUCCESS });
    } else {
      fingerprint.className = 'fingerprint-icon error';
      setStatus(result.error || 'Authentication failed.', 'error');
      unlockBtn.disabled = false;

      // If credential is stale, surface the reset button
      if (result.errorCode === 'InvalidStateError') {
        resetCredentialBtn.classList.remove('hidden');
      }

      setTimeout(() => {
        fingerprint.className = 'fingerprint-icon';
      }, 2000);
    }
  });

  // ---- 4. Password toggle ----
  passwordToggle.addEventListener('click', () => {
    const isHidden = passwordSection.getAttribute('aria-hidden') !== 'false';
    showPasswordSection(isHidden);
  });

  function showPasswordSection(show = true) {
    passwordSection.setAttribute('aria-hidden', String(!show));
    passwordSection.classList.toggle('visible', show);
    if (show && passwordInput) passwordInput.focus();
  }

  // ---- 5. Password submission ----
  passwordSubmit.addEventListener('click', submitPassword);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPassword();
  });

  async function submitPassword() {
    const password = passwordInput.value;
    if (!password) {
      passwordError.textContent = 'Enter your password.';
      return;
    }

    passwordError.textContent = '';
    passwordSubmit.disabled = true;

    const response = await sendMessage(MESSAGE_TYPES.AUTHENTICATE_PASSWORD, { password });

    if (response && response.success) {
      setStatus('Authenticated!', 'success');
      fingerprint.className = 'fingerprint-icon success';
    } else {
      const msg = (response && response.rateLimited)
        ? response.error
        : 'Incorrect password.';
      passwordError.textContent = msg;
      fingerprint.className = 'fingerprint-icon error';
      passwordInput.value = '';
      passwordInput.focus();
      setTimeout(() => {
        fingerprint.className = 'fingerprint-icon';
      }, 2000);
    }

    passwordSubmit.disabled = false;
  }

  // ---- 6. Credential reset ----
  resetCredentialBtn.addEventListener('click', async () => {
    resetCredentialBtn.disabled = true;
    await sendMessage(MESSAGE_TYPES.RESET_CREDENTIAL, {});
    await resetCredential(); // clear local storage copy
    resetCredentialBtn.classList.add('hidden');
    unlockBtn.disabled = false;
    setStatus('Credential reset. Click unlock to re-register.', 'info');
  });

  // ---- 7. Listen for unlock broadcast from background ----
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'UNLOCK') {
      fingerprint.className = 'fingerprint-icon success';
      setStatus('Unlocked!', 'success');
    }
  });

  // ---- Helpers ----

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = `status ${type}`;
  }

  function sendMessage(type, extra = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...extra }, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response || null);
      });
    });
  }
}
