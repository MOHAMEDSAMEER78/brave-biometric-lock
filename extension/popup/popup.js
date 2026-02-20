// ============================================================
// Brave Biometric Lock — Popup Script
// ============================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    // Read settings directly from storage (more reliable than service worker message)
    const stored = await chrome.storage.local.get([
        'biometric_locked',
        'biometric_lock_enabled',
        'auto_lock_minutes',
        'fallback_password_hash',
    ]);

    const state = {
        isLocked: stored['biometric_locked'] || false,
        lockEnabled: stored['biometric_lock_enabled'] || false,
        autoLockMinutes: stored['auto_lock_minutes'] ?? 5,
        hasPassword: !!stored['fallback_password_hash'],
    };

    const biometrics = await isBiometricAvailable();

    // Populate UI
    updateLockIndicator(state.isLocked);
    document.getElementById('toggle-lock').checked = state.lockEnabled;
    const autoVal = state.autoLockMinutes === 'close' ? 'close' : String(state.autoLockMinutes || 5);
    document.getElementById('auto-lock-select').value = autoVal;
    updateAutoLockDesc(autoVal);
    document.getElementById('password-status').textContent = state.hasPassword ? 'Set ✓' : 'Not set';
    document.getElementById('status-text').textContent = state.lockEnabled ? 'Protection active' : 'Protection disabled';

    // Biometric info
    if (biometrics.supported) {
        document.getElementById('biometric-status').textContent = 'Biometrics available';
    } else {
        document.getElementById('biometric-status').textContent = biometrics.error || 'Biometrics not available — use fallback password';
        document.getElementById('biometric-info').style.borderColor = 'rgba(239, 68, 68, 0.15)';
        document.getElementById('biometric-info').style.background = 'rgba(239, 68, 68, 0.06)';
    }

    // ---- Event Listeners ----

    // Toggle lock
    document.getElementById('toggle-lock').addEventListener('change', async (e) => {
        await sendMessage({ type: 'SET_LOCK_ENABLED', enabled: e.target.checked });
        document.getElementById('status-text').textContent = e.target.checked ? 'Protection active' : 'Protection disabled';
        showToast(e.target.checked ? 'Lock enabled' : 'Lock disabled');
    });

    // Auto-lock select
    document.getElementById('auto-lock-select').addEventListener('change', async (e) => {
        await sendMessage({ type: 'SET_AUTO_LOCK_MINUTES', minutes: e.target.value });
        updateAutoLockDesc(e.target.value);
        showToast('Auto-lock updated');
    });

    // Password setup / reset
    const setPasswordBtn = document.getElementById('set-password-btn');
    setPasswordBtn.textContent = state.hasPassword ? 'Reset' : 'Set';

    setPasswordBtn.addEventListener('click', () => {
        const form = document.getElementById('password-form');
        const verifyStep = document.getElementById('verify-step');
        const newPwStep = document.getElementById('new-password-step');
        const verifyError = document.getElementById('verify-error');

        form.classList.toggle('hidden');
        verifyError.textContent = '';

        if (!form.classList.contains('hidden')) {
            if (state.hasPassword) {
                // Show verify step first
                verifyStep.classList.remove('hidden');
                newPwStep.classList.add('hidden');
                document.getElementById('verify-password-input').focus();
            } else {
                // No existing password — go straight to set
                verifyStep.classList.add('hidden');
                newPwStep.classList.remove('hidden');
                document.getElementById('password-input').focus();
            }
        }
    });

    // Verify with current password
    document.getElementById('verify-password-btn').addEventListener('click', async () => {
        const input = document.getElementById('verify-password-input');
        const verifyError = document.getElementById('verify-error');
        if (!input.value) {
            verifyError.textContent = 'Enter your current password';
            return;
        }
        const result = await sendMessage({ type: 'VERIFY_PASSWORD', password: input.value });
        if (result.success) {
            input.value = '';
            verifyError.textContent = '';
            document.getElementById('verify-step').classList.add('hidden');
            document.getElementById('new-password-step').classList.remove('hidden');
            document.getElementById('password-input').focus();
        } else {
            verifyError.textContent = 'Incorrect password';
            input.value = '';
            input.focus();
        }
    });

    // Verify with biometrics (WebAuthn — no native host needed)
    document.getElementById('verify-biometric-btn').addEventListener('click', async () => {
        const verifyError = document.getElementById('verify-error');
        verifyError.textContent = 'Authenticating...';
        const result = await verifyBiometric();
        if (result.success) {
            verifyError.textContent = '';
            document.getElementById('verify-step').classList.add('hidden');
            document.getElementById('new-password-step').classList.remove('hidden');
            document.getElementById('password-input').focus();
        } else {
            verifyError.textContent = result.error || 'Biometric verification failed';
        }
    });

    document.getElementById('password-save').addEventListener('click', async () => {
        const password = document.getElementById('password-input').value;
        const confirm = document.getElementById('password-confirm').value;

        if (!password) {
            showToast('Enter a password', true);
            return;
        }
        if (password !== confirm) {
            showToast('Passwords don\'t match', true);
            return;
        }
        if (password.length < 4) {
            showToast('Password too short (min 4)', true);
            return;
        }

        await sendMessage({ type: 'SET_FALLBACK_PASSWORD', password });
        document.getElementById('password-form').classList.add('hidden');
        document.getElementById('password-input').value = '';
        document.getElementById('password-confirm').value = '';
        document.getElementById('password-status').textContent = 'Set ✓';
        setPasswordBtn.textContent = 'Reset';
        state.hasPassword = true;
        showToast('Password saved');
    });

    document.getElementById('password-cancel').addEventListener('click', () => {
        document.getElementById('password-form').classList.add('hidden');
        document.getElementById('password-input').value = '';
        document.getElementById('password-confirm').value = '';
        document.getElementById('verify-password-input').value = '';
        document.getElementById('verify-error').textContent = '';
    });

    // Lock now
    document.getElementById('lock-now-btn').addEventListener('click', async () => {
        await sendMessage({ type: 'LOCK_NOW' });
        updateLockIndicator(true);
        showToast('Browser locked');
    });
}

// ---- Helpers ----

function sendMessage(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            resolve(response || {});
        });
    });
}

function updateLockIndicator(isLocked) {
    const indicator = document.getElementById('lock-indicator');
    const label = document.getElementById('lock-status-label');

    if (isLocked) {
        indicator.className = 'lock-indicator locked';
        label.textContent = 'Locked';
    } else {
        indicator.className = 'lock-indicator unlocked';
        label.textContent = 'Unlocked';
    }
}

function updateAutoLockDesc(value) {
    const desc = document.getElementById('auto-lock-desc');
    if (!desc) return;
    if (value === 'close') {
        desc.textContent = 'Locks when browser closes';
    } else if (value === '0') {
        desc.textContent = 'Only manual lock';
    } else {
        desc.textContent = `Lock after ${value} min idle`;
    }
}

function showToast(message, isError = false) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}
