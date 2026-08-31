// ============================================================
// Brave Biometric Lock — Shared Constants
// Single source of truth for storage keys and message types.
// Loaded as a <script> tag in popup.html and lock.html.
// ============================================================

const STORAGE_KEYS = Object.freeze({
  IS_LOCKED: 'biometric_locked',
  LOCK_ENABLED: 'biometric_lock_enabled',
  AUTO_LOCK_MINUTES: 'auto_lock_minutes',
  // Password: { hash: hex, salt: hex, iterations: number }
  FALLBACK_PASSWORD: 'fallback_password_v2',
  // Legacy v1 hash (plain SHA-256 + static salt) — detected for migration
  FALLBACK_PASSWORD_HASH_V1: 'fallback_password_hash',
  SAVED_TABS: 'saved_tabs',
  WEBAUTHN_CREDENTIAL: 'webauthn_credential',
  // Security audit
  LAST_UNLOCK_TIME: 'last_unlock_time',
  FAILED_ATTEMPTS: 'failed_attempts',
  LOCKED_UNTIL: 'locked_until',
  // One-time startup flag stored in session storage (clears on browser close)
  STARTUP_LOCK_APPLIED: 'startup_lock_applied',
});

const MESSAGE_TYPES = Object.freeze({
  GET_LOCK_STATE: 'GET_LOCK_STATE',
  GET_UNLOCK_AUDIT: 'GET_UNLOCK_AUDIT',
  LOCK_NOW: 'LOCK_NOW',
  BIOMETRIC_AUTH_SUCCESS: 'BIOMETRIC_AUTH_SUCCESS',
  AUTHENTICATE_PASSWORD: 'AUTHENTICATE_PASSWORD',
  VERIFY_PASSWORD: 'VERIFY_PASSWORD',
  SET_LOCK_ENABLED: 'SET_LOCK_ENABLED',
  SET_AUTO_LOCK_MINUTES: 'SET_AUTO_LOCK_MINUTES',
  SET_FALLBACK_PASSWORD: 'SET_FALLBACK_PASSWORD',
  REMOVE_FALLBACK_PASSWORD: 'REMOVE_FALLBACK_PASSWORD',
  RESET_CREDENTIAL: 'RESET_CREDENTIAL',
  CHECK_PASSWORD_MIGRATION: 'CHECK_PASSWORD_MIGRATION',
});

const ALARM_NAME = 'biometricLockAutoLock';
