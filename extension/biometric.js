// ============================================================
// Brave Biometric Lock v2 — WebAuthn Biometric Module
// ============================================================
// Provides:
//   isBiometricAvailable()  → { supported, biometryType, label }
//   hasRegisteredCredential() → boolean
//   registerBiometric()     → { success, error?, errorCode? }
//   verifyBiometric()       → { success, error?, errorCode? }
//   resetCredential()       → void
// ============================================================

const WEBAUTHN_CREDENTIAL_KEY = 'webauthn_credential';

const BIOMETRY_ERROR_MAP = {
  NotAllowedError: 'Authentication cancelled or timed out.',
  InvalidStateError: 'Credential is no longer valid. Please reset and re-register.',
  NotSupportedError: 'Biometrics are not supported on this device.',
  SecurityError: 'Security error during authentication.',
  AbortError: 'Authentication was aborted.',
  UnknownError: 'An unknown error occurred.',
};

function friendlyError(e) {
  return BIOMETRY_ERROR_MAP[e.name] || e.message || 'Unknown error';
}

/**
 * Detect platform authenticator availability and identify biometry type.
 * Returns: { supported: boolean, biometryType: string, label: string }
 */
async function isBiometricAvailable() {
  if (typeof PublicKeyCredential === 'undefined') {
    return { supported: false, biometryType: 'none', label: 'Biometrics' };
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return { supported: false, biometryType: 'none', label: 'Biometrics' };
    }

    const { biometryType, label } = detectBiometryType();
    return { supported: true, biometryType, label };
  } catch (e) {
    return { supported: false, biometryType: 'none', label: 'Biometrics', error: e.message };
  }
}

function detectBiometryType() {
  const ua = navigator.userAgent;
  const platform = navigator.platform || '';

  if (/Mac/.test(platform) || /Macintosh/.test(ua)) {
    return { biometryType: 'touchId', label: 'Touch ID' };
  }
  if (/Win/.test(platform) || /Windows/.test(ua)) {
    return { biometryType: 'windowsHello', label: 'Windows Hello' };
  }
  if (/CrOS/.test(ua)) {
    return { biometryType: 'chromeos', label: 'Device PIN' };
  }
  if (/Linux/.test(platform)) {
    return { biometryType: 'platform', label: 'Biometrics' };
  }
  return { biometryType: 'platform', label: 'Biometrics' };
}

/**
 * Check if a WebAuthn credential has been registered.
 */
async function hasRegisteredCredential() {
  const stored = await chrome.storage.local.get([WEBAUTHN_CREDENTIAL_KEY]);
  return !!stored[WEBAUTHN_CREDENTIAL_KEY];
}

/**
 * Register a new platform credential (triggers the biometric prompt).
 * Called once during initial setup; registration itself verifies the user.
 */
async function registerBiometric() {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Brave Biometric Lock' },
        user: {
          id: userId,
          name: 'brave-biometric-lock',
          displayName: 'Brave Biometric Lock',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60000,
      },
    });

    const credentialId = Array.from(new Uint8Array(credential.rawId));
    await chrome.storage.local.set({
      [WEBAUTHN_CREDENTIAL_KEY]: { id: credentialId },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: friendlyError(e),
      errorCode: e.name,
    };
  }
}

/**
 * Verify user identity via platform biometrics.
 * If no credential is stored, auto-registers one first.
 */
async function verifyBiometric() {
  const stored = await chrome.storage.local.get([WEBAUTHN_CREDENTIAL_KEY]);
  const storedCredential = stored[WEBAUTHN_CREDENTIAL_KEY];

  if (!storedCredential) {
    const regResult = await registerBiometric();
    if (!regResult.success) return regResult;
    // Registration itself verifies identity
    return { success: true };
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credentialId = new Uint8Array(storedCredential.id);

    await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credentialId, type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return { success: true };
  } catch (e) {
    if (e.name === 'InvalidStateError') {
      // Stale credential — clear it so the user can re-register
      await chrome.storage.local.remove(WEBAUTHN_CREDENTIAL_KEY);
    }
    return {
      success: false,
      error: friendlyError(e),
      errorCode: e.name,
    };
  }
}

/**
 * Clear the stored WebAuthn credential (credential management).
 * The next biometric prompt will re-register.
 */
async function resetCredential() {
  await chrome.storage.local.remove(WEBAUTHN_CREDENTIAL_KEY);
}
