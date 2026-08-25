// ============================================================
// Brave Biometric Lock v2 — Popup Script
// ============================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Read all state in one storage call
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.IS_LOCKED,
    STORAGE_KEYS.LOCK_ENABLED,
    STORAGE_KEYS.AUTO_LOCK_MINUTES,
    STORAGE_KEYS.FALLBACK_PASSWORD,
    STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1,
    STORAGE_KEYS.WEBAUTHN_CREDENTIAL,
  ]);

  const state = {
    isLocked: stored[STORAGE_KEYS.IS_LOCKED] || false,
    lockEnabled: stored[STORAGE_KEYS.LOCK_ENABLED] || false,
    autoLockMinutes: stored[STORAGE_KEYS.AUTO_LOCK_MINUTES] ?? 5,
    hasPassword: !!(stored[STORAGE_KEYS.FALLBACK_PASSWORD] || stored[STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1]),
    hasLegacyPassword: !!stored[STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1] && !stored[STORAGE_KEYS.FALLBACK_PASSWORD],
    hasCredential: !!stored[STORAGE_KEYS.WEBAUTHN_CREDENTIAL],
  };

  // ---- Populate UI ----
  updateLockIndicator(state.isLocked);
  el('toggle-lock').checked = state.lockEnabled;

  const autoVal = state.autoLockMinutes === 'close' ? 'close' : String(state.autoLockMinutes ?? 5);
  el('auto-lock-select').value = autoVal;
  updateAutoLockDesc(autoVal);

  el('status-text').textContent = state.lockEnabled ? 'Protection active' : 'Protection disabled';

  // Password section
  updatePasswordUI(state.hasPassword, state.hasLegacyPassword);

  // Credential section
  updateCredentialUI(state.hasCredential);

  // Lock Now button state
  el('lock-now-btn').disabled = !state.lockEnabled || state.isLocked;

  // Biometric availability
  const bio = await isBiometricAvailable();
  const bioStatusEl = el('biometric-status');
  const biometricInfoEl = el('biometric-info');
  if (bio.supported) {
    bioStatusEl.textContent = `${bio.label} available`;
    // Update verify button label dynamically
    el('verify-biometric-btn').textContent = `Use ${bio.label}`;
  } else {
    bioStatusEl.textContent = 'Biometrics unavailable — use fallback password';
    biometricInfoEl.classList.add('unavailable');
    el('verify-biometric-btn').disabled = true;
  }

  // Unlock audit
  await loadAudit();

  // ---- Event Listeners ----

  el('toggle-lock').addEventListener('change', async (e) => {
    await sendMsg(MESSAGE_TYPES.SET_LOCK_ENABLED, { enabled: e.target.checked });
    el('status-text').textContent = e.target.checked ? 'Protection active' : 'Protection disabled';
    el('lock-now-btn').disabled = !e.target.checked || state.isLocked;
    showToast(e.target.checked ? 'Lock enabled' : 'Lock disabled');
  });

  el('auto-lock-select').addEventListener('change', async (e) => {
    await sendMsg(MESSAGE_TYPES.SET_AUTO_LOCK_MINUTES, { minutes: e.target.value });
    updateAutoLockDesc(e.target.value);
    showToast('Auto-lock updated');
  });

  // ---- Password management ----
  el('set-password-btn').addEventListener('click', () => openPasswordForm(state));
  el('remove-password-btn').addEventListener('click', async () => {
    if (!confirm('Remove your fallback password?')) return;
    await sendMsg(MESSAGE_TYPES.REMOVE_FALLBACK_PASSWORD, {});
    state.hasPassword = false;
    state.hasLegacyPassword = false;
    updatePasswordUI(false, false);
    showToast('Password removed');
  });

  el('verify-password-btn').addEventListener('click', async () => {
    const input = el('verify-password-input');
    if (!input.value) { showFieldError('verify-error', 'Enter your current password'); return; }

    const result = await sendMsg(MESSAGE_TYPES.VERIFY_PASSWORD, { password: input.value });
    if (result && result.success) {
      input.value = '';
      clearFieldError('verify-error');
      showStep('new-password-step');
      el('password-input').focus();
    } else {
      if (result && result.rateLimited) {
        showFieldError('verify-error', result.error);
      } else {
        showFieldError('verify-error', 'Incorrect password');
      }
      input.value = '';
      input.focus();
    }
  });

  el('verify-biometric-btn').addEventListener('click', async () => {
    showFieldError('verify-error', 'Authenticating…');
    const result = await verifyBiometric();
    if (result.success) {
      clearFieldError('verify-error');
      showStep('new-password-step');
      el('password-input').focus();
    } else {
      showFieldError('verify-error', result.error || 'Biometric verification failed');
    }
  });

  el('password-save').addEventListener('click', async () => {
    const password = el('password-input').value;
    const confirm = el('password-confirm').value;
    const errorEl = 'password-form-error';

    if (!password) { showFieldError(errorEl, 'Enter a password'); return; }
    if (password.length < 8) { showFieldError(errorEl, 'Password must be at least 8 characters'); return; }
    if (password !== confirm) { showFieldError(errorEl, 'Passwords do not match'); return; }

    const result = await sendMsg(MESSAGE_TYPES.SET_FALLBACK_PASSWORD, { password });
    if (!result || !result.success) {
      showFieldError(errorEl, result?.error || 'Failed to save password');
      return;
    }

    closePasswordForm();
    state.hasPassword = true;
    state.hasLegacyPassword = false;
    updatePasswordUI(true, false);
    showToast('Password saved');
  });

  el('password-cancel').addEventListener('click', closePasswordForm);

  // ---- Credential management ----
  el('reset-credential-btn').addEventListener('click', async () => {
    if (!confirm('Reset your biometric credential? You will need to re-register on next unlock.')) return;
    await sendMsg(MESSAGE_TYPES.RESET_CREDENTIAL, {});
    state.hasCredential = false;
    updateCredentialUI(false);
    showToast('Credential reset');
  });

  // ---- Lock now ----
  el('lock-now-btn').addEventListener('click', async () => {
    const result = await sendMsg(MESSAGE_TYPES.LOCK_NOW, {});
    if (result && result.success) {
      state.isLocked = true;
      updateLockIndicator(true);
      el('lock-now-btn').disabled = true;
      showToast('Browser locked');
    } else {
      showToast(result?.error || 'Could not lock', true);
    }
  });
}

// ---- Password form helpers ----

function openPasswordForm(state) {
  const form = el('password-form');
  form.classList.remove('hidden');

  // Show legacy notice if old hash format detected
  el('legacy-notice').classList.toggle('hidden', !state.hasLegacyPassword);

  if (state.hasPassword) {
    showStep('verify-step');
    el('verify-password-input').focus();
  } else {
    showStep('new-password-step');
    el('password-input').focus();
  }
}

function closePasswordForm() {
  el('password-form').classList.add('hidden');
  el('verify-step').classList.add('hidden');
  el('new-password-step').classList.add('hidden');
  el('verify-password-input').value = '';
  el('password-input').value = '';
  el('password-confirm').value = '';
  clearFieldError('verify-error');
  clearFieldError('password-form-error');
}

function showStep(stepId) {
  ['verify-step', 'new-password-step'].forEach((id) => {
    el(id).classList.toggle('hidden', id !== stepId);
  });
}

function updatePasswordUI(hasPassword, hasLegacyPassword) {
  const desc = el('password-status');
  const setBtn = el('set-password-btn');
  const removeBtn = el('remove-password-btn');

  if (hasPassword) {
    desc.textContent = hasLegacyPassword ? 'Set (upgrade needed)' : 'Set ✓';
    desc.style.color = hasLegacyPassword ? '#fbbf24' : '';
    setBtn.textContent = 'Reset';
    removeBtn.classList.remove('hidden');
  } else {
    desc.textContent = 'Not set';
    desc.style.color = '';
    setBtn.textContent = 'Set';
    removeBtn.classList.add('hidden');
  }
}

function updateCredentialUI(hasCredential) {
  el('credential-status').textContent = hasCredential ? 'Registered ✓' : 'Not registered';
  el('reset-credential-btn').classList.toggle('hidden', !hasCredential);
}

// ---- Audit ----

async function loadAudit() {
  const data = await sendMsg(MESSAGE_TYPES.GET_UNLOCK_AUDIT, {});
  if (!data) return;

  el('audit-failed').textContent = String(data.failedAttempts || 0);
  el('audit-last-unlock').textContent = data.lastUnlockTime
    ? formatRelativeTime(data.lastUnlockTime)
    : '—';

  if (data.failedAttempts > 0) {
    el('audit-failed').classList.add('audit-value-warn');
  }
}

function formatRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---- Generic helpers ----

function el(id) { return document.getElementById(id); }

function sendMsg(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (response) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(response || null);
    });
  });
}

function updateLockIndicator(isLocked) {
  const indicator = el('lock-indicator');
  const label = el('lock-status-label');
  indicator.className = `lock-indicator ${isLocked ? 'locked' : 'unlocked'}`;
  label.textContent = isLocked ? 'Locked' : 'Unlocked';
}

function updateAutoLockDesc(value) {
  const desc = el('auto-lock-desc');
  if (!desc) return;
  if (value === 'close') { desc.textContent = 'Locks when browser closes'; return; }
  if (value === '0') { desc.textContent = 'Only manual lock'; return; }
  desc.textContent = `Lock after ${value} min idle`;
}

function showFieldError(id, msg) {
  const e = el(id);
  if (e) e.textContent = msg;
}

function clearFieldError(id) {
  const e = el(id);
  if (e) e.textContent = '';
}

function showToast(message, isError = false) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}
