// ============================================================
// Brave Biometric Lock — WebAuthn Biometric Module
// ============================================================
// Replaces the native messaging host with browser-native WebAuthn API.
// Uses platform authenticators (Touch ID, Face ID, Windows Hello)
// just like how browsers handle biometrics for saved passwords.
// ============================================================

const WEBAUTHN_CREDENTIAL_KEY = 'webauthn_credential';

/**
 * Check if a platform authenticator (Touch ID / Face ID / Windows Hello) is available.
 */
async function isBiometricAvailable() {
  if (typeof PublicKeyCredential === 'undefined') {
    return { supported: false, error: 'WebAuthn not supported in this browser' };
  }
  try {
    const available =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return {
      supported: available,
      biometryType: available ? 'platform' : 'none',
    };
  } catch (e) {
    return { supported: false, error: e.message };
  }
}

/**
 * Check if a biometric credential has already been registered.
 */
async function hasRegisteredCredential() {
  const stored = await chrome.storage.local.get([WEBAUTHN_CREDENTIAL_KEY]);
  return !!stored[WEBAUTHN_CREDENTIAL_KEY];
}

/**
 * Register a new platform credential (triggers Touch ID / Face ID / Windows Hello).
 * Called once during initial setup.
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
          { alg: -7, type: 'public-key' },  // ES256
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

    // Store credential ID for future verification
    const credentialId = Array.from(new Uint8Array(credential.rawId));
    await chrome.storage.local.set({
      [WEBAUTHN_CREDENTIAL_KEY]: { id: credentialId },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error:
        e.name === 'NotAllowedError'
          ? 'Biometric registration cancelled'
          : e.message,
      errorCode: e.name === 'NotAllowedError' ? 'user_cancel' : 'unknown',
    };
  }
}

/**
 * Verify user identity via platform biometrics.
 * If no credential exists yet, auto-registers one first
 * (registration itself requires biometric verification).
 */
async function verifyBiometric() {
  const stored = await chrome.storage.local.get([WEBAUTHN_CREDENTIAL_KEY]);
  const storedCredential = stored[WEBAUTHN_CREDENTIAL_KEY];

  if (!storedCredential) {
    // First use — register a credential (this triggers biometric prompt)
    const regResult = await registerBiometric();
    if (!regResult.success) return regResult;
    // Registration itself verified the user
    return { success: true };
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credentialId = new Uint8Array(storedCredential.id);

    await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: credentialId,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return { success: true };
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      return {
        success: false,
        error: 'Authentication cancelled',
        errorCode: 'user_cancel',
      };
    }
    if (e.name === 'InvalidStateError') {
      // Credential may be invalid — clear it so next attempt re-registers
      await chrome.storage.local.remove(WEBAUTHN_CREDENTIAL_KEY);
      return {
        success: false,
        error: 'Credential expired. Please try again.',
        errorCode: 'invalid_credential',
      };
    }
    return { success: false, error: e.message, errorCode: 'unknown' };
  }
}
