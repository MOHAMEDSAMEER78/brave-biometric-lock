// ============================================================
// Brave Biometric Lock — Lock Screen Script
// ============================================================

document.addEventListener('DOMContentLoaded', init);

function init() {
    const unlockBtn = document.getElementById('unlock-btn');
    const passwordToggle = document.getElementById('password-toggle');
    const passwordInput = document.getElementById('password-input');
    const passwordSubmit = document.getElementById('password-submit');
    const fingerprint = document.getElementById('fingerprint-icon');
    const statusEl = document.getElementById('status');
    const titleEl = document.getElementById('lock-title');
    const cancelLink = document.getElementById('cancel-link');

    // Parse query params for site lock
    const params = new URLSearchParams(window.location.search);
    const site = params.get('site');
    const returnUrl = params.get('returnUrl');
    const isSiteLock = !!site;

    // Update UI for site lock
    if (isSiteLock) {
        titleEl.textContent = site + ' is locked';
        cancelLink.classList.remove('hidden');
        cancelLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Go back or navigate to new tab
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = 'about:newtab';
            }
        });
    }

    // Unlock with biometrics (WebAuthn — no native host needed)
    unlockBtn.addEventListener('click', async () => {
        setStatus('Authenticating...', 'pending');
        unlockBtn.disabled = true;
        fingerprint.className = 'fingerprint-icon authenticating';

        const result = await verifyBiometric();

        if (result.success) {
            setStatus('Authenticated!', 'success');
            fingerprint.className = 'fingerprint-icon success';

            if (isSiteLock) {
                // Grant site session then redirect back
                chrome.runtime.sendMessage(
                    { type: 'SITE_BIOMETRIC_AUTH_SUCCESS', site },
                    () => {
                        if (returnUrl) {
                            window.location.href = returnUrl;
                        }
                    }
                );
            } else {
                // Global unlock
                chrome.runtime.sendMessage({ type: 'BIOMETRIC_AUTH_SUCCESS' });
            }
        } else {
            setStatus(result.error || 'Authentication failed', 'error');
            fingerprint.className = 'fingerprint-icon error';
            unlockBtn.disabled = false;
            setTimeout(() => {
                fingerprint.className = 'fingerprint-icon';
            }, 2000);
        }
    });

    // Password toggle
    passwordToggle.addEventListener('click', () => {
        const section = document.getElementById('password-section');
        section.classList.toggle('visible');
        if (section.classList.contains('visible')) {
            passwordInput.focus();
        }
    });

    // Password submit
    passwordSubmit.addEventListener('click', submitPassword);
    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitPassword();
    });

    function submitPassword() {
        const password = passwordInput.value;
        if (!password) {
            setStatus('Please enter your password', 'error');
            return;
        }

        if (isSiteLock) {
            chrome.runtime.sendMessage(
                { type: 'SITE_AUTHENTICATE_PASSWORD', password, site },
                (response) => {
                    if (response && response.success) {
                        setStatus('Authenticated!', 'success');
                        fingerprint.className = 'fingerprint-icon success';
                        if (returnUrl) {
                            window.location.href = returnUrl;
                        }
                    } else {
                        setStatus(response?.error || 'Incorrect password', 'error');
                        passwordInput.value = '';
                        passwordInput.focus();
                        fingerprint.className = 'fingerprint-icon error';
                        setTimeout(() => {
                            fingerprint.className = 'fingerprint-icon';
                        }, 2000);
                    }
                }
            );
        } else {
            chrome.runtime.sendMessage(
                { type: 'AUTHENTICATE_PASSWORD', password },
                (response) => {
                    if (response && response.success) {
                        setStatus('Authenticated!', 'success');
                        fingerprint.className = 'fingerprint-icon success';
                    } else {
                        setStatus(response?.error || 'Incorrect password', 'error');
                        passwordInput.value = '';
                        passwordInput.focus();
                        fingerprint.className = 'fingerprint-icon error';
                        setTimeout(() => {
                            fingerprint.className = 'fingerprint-icon';
                        }, 2000);
                    }
                }
            );
        }
    }

    function setStatus(text, type) {
        statusEl.textContent = text;
        statusEl.className = `status ${type}`;
    }

    // Listen for unlock from background (global lock only)
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'UNLOCK') {
            fingerprint.className = 'fingerprint-icon success';
            setStatus('Unlocked!', 'success');
        }
    });
}
