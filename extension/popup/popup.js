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

    // ---- Locked Websites ----
    const siteInput = document.getElementById('site-input');
    const addSiteBtn = document.getElementById('add-site-btn');
    const sitesList = document.getElementById('sites-list');
    const siteDurationSelect = document.getElementById('site-duration-select');

    // Load locked sites and duration
    const siteData = await sendMessage({ type: 'GET_LOCKED_SITES' });
    let lockedSites = siteData.sites || [];
    const siteDuration = siteData.duration || 30;
    siteDurationSelect.value = String(siteDuration);
    renderSitesList(lockedSites, sitesList);

    // Auto-detect current tab domain as placeholder
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
            const url = new URL(activeTab.url);
            if (url.hostname && !url.protocol.startsWith('chrome') && !url.protocol.startsWith('brave')) {
                const domain = url.hostname.replace(/^www\./, '');
                siteInput.placeholder = domain;
            }
        }
    } catch (e) { }

    // Add site
    addSiteBtn.addEventListener('click', async () => {
        const domain = siteInput.value.trim();
        if (!domain) {
            showToast('Enter a domain', true);
            return;
        }
        const result = await sendMessage({ type: 'ADD_LOCKED_SITE', domain });
        if (result.success) {
            lockedSites = result.sites;
            renderSitesList(lockedSites, sitesList);
            siteInput.value = '';
            showToast('Site locked');
        } else {
            showToast(result.error || 'Failed to add site', true);
        }
    });

    siteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSiteBtn.click();
    });

    // Site duration change
    siteDurationSelect.addEventListener('change', async (e) => {
        await sendMessage({ type: 'SET_SITE_LOCK_DURATION', duration: e.target.value });
        showToast('Session duration updated');
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

function renderSitesList(sites, container) {
    container.innerHTML = '';
    if (sites.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sites-empty';
        empty.textContent = 'No locked websites';
        container.appendChild(empty);
        return;
    }
    for (const site of sites) {
        const item = document.createElement('div');
        item.className = 'site-item';

        const domainEl = document.createElement('div');
        domainEl.className = 'site-item-domain';
        domainEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>${site}</span>`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'site-remove-btn';
        removeBtn.title = 'Remove';
        removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        removeBtn.addEventListener('click', async () => {
            const result = await sendMessage({ type: 'REMOVE_LOCKED_SITE', domain: site });
            if (result.success) {
                renderSitesList(result.sites, container);
                showToast('Site removed');
            }
        });

        item.appendChild(domainEl);
        item.appendChild(removeBtn);
        container.appendChild(item);
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
