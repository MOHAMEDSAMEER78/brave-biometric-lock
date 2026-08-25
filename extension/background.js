// ============================================================
// Brave Biometric Lock v2 — Background Service Worker
// ============================================================

// NOTE: Service workers can be killed and restarted at any time.
// All persistent state lives in chrome.storage. Mutable globals
// are only used as within-wake caches and must never be trusted
// across wake cycles.

const LOCK_PAGE = chrome.runtime.getURL('lock/lock.html');

// Inline constants (background.js cannot import ES modules or
// load a <script> tag, so we duplicate the frozen objects here).
const STORAGE_KEYS = Object.freeze({
  IS_LOCKED: 'biometric_locked',
  LOCK_ENABLED: 'biometric_lock_enabled',
  AUTO_LOCK_MINUTES: 'auto_lock_minutes',
  FALLBACK_PASSWORD: 'fallback_password_v2',
  FALLBACK_PASSWORD_HASH_V1: 'fallback_password_hash',
  SAVED_TABS: 'saved_tabs',
  WEBAUTHN_CREDENTIAL: 'webauthn_credential',
  LAST_UNLOCK_TIME: 'last_unlock_time',
  FAILED_ATTEMPTS: 'failed_attempts',
  LOCKED_UNTIL: 'locked_until',
  STARTUP_LOCK_APPLIED: 'startup_lock_applied',
});

const ALARM_NAME = 'biometricLockAutoLock';

// Brute-force lockout thresholds: after N failures, lock out for D ms.
const LOCKOUT_SCHEDULE = [
  { after: 3, durationMs: 30_000 },
  { after: 5, durationMs: 300_000 },
  { after: 10, durationMs: Infinity }, // permanent until biometric succeeds
];

// ---- Initialization ----

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const data = await chrome.storage.local.get([STORAGE_KEYS.LOCK_ENABLED]);
  if (data[STORAGE_KEYS.LOCK_ENABLED] === undefined) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LOCK_ENABLED]: false,
      [STORAGE_KEYS.AUTO_LOCK_MINUTES]: 5,
      [STORAGE_KEYS.IS_LOCKED]: false,
    });
  }
});

// ---- Startup: lock browser if lock was enabled ----
// Uses chrome.storage.session (cleared on browser close) to prevent
// the startup handler from re-locking after a service worker restart
// within the same browser session.
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LOCK_ENABLED,
    STORAGE_KEYS.IS_LOCKED,
  ]);

  if (!data[STORAGE_KEYS.LOCK_ENABLED]) return;

  // Check if we already handled startup locking this session
  let sessionData = {};
  try {
    sessionData = await chrome.storage.session.get([STORAGE_KEYS.STARTUP_LOCK_APPLIED]);
  } catch (_) {
    // chrome.storage.session unavailable in older builds — fall through
  }

  if (sessionData[STORAGE_KEYS.STARTUP_LOCK_APPLIED]) return;

  try {
    await chrome.storage.session.set({ [STORAGE_KEYS.STARTUP_LOCK_APPLIED]: true });
  } catch (_) {}

  // Snapshot current tabs before redirecting
  await snapshotTabs();

  await chrome.storage.local.set({ [STORAGE_KEYS.IS_LOCKED]: true });
  await redirectAllTabsToLockPage();
  setBadgeLocked();
});

// ---- Tab Snapshotting ----
// Continuously records real tab URLs so restoration is accurate after locking.

async function snapshotTabs() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LOCK_ENABLED,
    STORAGE_KEYS.IS_LOCKED,
  ]);

  if (!data[STORAGE_KEYS.LOCK_ENABLED] || data[STORAGE_KEYS.IS_LOCKED]) return;

  const tabs = await chrome.tabs.query({});
  const realTabs = tabs
    .filter((t) => t.url && !isExtensionUrl(t.url) && !isInternalUrl(t.url))
    .map((t) => ({ url: t.url, pinned: t.pinned, index: t.index }));

  if (realTabs.length > 0) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_TABS]: realTabs });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') snapshotTabs();
});

chrome.tabs.onRemoved.addListener(() => snapshotTabs());

// Reset the auto-lock alarm whenever the user switches tabs (activity signal)
chrome.tabs.onActivated.addListener(() => rescheduleAutoLockAlarm());

// Intercept newly created tabs while locked
chrome.tabs.onCreated.addListener(async (tab) => {
  const data = await chrome.storage.local.get([STORAGE_KEYS.IS_LOCKED]);
  if (data[STORAGE_KEYS.IS_LOCKED]) {
    try {
      await chrome.tabs.update(tab.id, { url: LOCK_PAGE });
    } catch (_) {}
  }
});

// Intercept URL changes while locked
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const data = await chrome.storage.local.get([STORAGE_KEYS.IS_LOCKED]);
  if (data[STORAGE_KEYS.IS_LOCKED] && !isExtensionUrl(changeInfo.url)) {
    try {
      await chrome.tabs.update(tabId, { url: LOCK_PAGE });
    } catch (_) {}
  }
});

// ---- Lock / Unlock ----

async function lockBrowser() {
  await snapshotTabs(); // capture final state before locking

  await chrome.storage.local.set({ [STORAGE_KEYS.IS_LOCKED]: true });
  await redirectAllTabsToLockPage();
  setBadgeLocked();
  cancelAutoLockAlarm();
}

async function unlockBrowser() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.IS_LOCKED]: false,
    [STORAGE_KEYS.LAST_UNLOCK_TIME]: Date.now(),
    [STORAGE_KEYS.FAILED_ATTEMPTS]: 0,
    [STORAGE_KEYS.LOCKED_UNTIL]: null,
  });

  const data = await chrome.storage.local.get([STORAGE_KEYS.SAVED_TABS]);
  const savedTabs = (data[STORAGE_KEYS.SAVED_TABS] || []).filter(
    (t) => t.url && !isExtensionUrl(t.url) && !isInternalUrl(t.url)
  );

  const lockTabs = await chrome.tabs.query({});

  if (savedTabs.length > 0) {
    // Restore: navigate the first lock tab to the first saved URL,
    // open new tabs for the rest, then close excess lock tabs.
    for (let i = 0; i < savedTabs.length; i++) {
      if (i === 0 && lockTabs.length > 0) {
        try {
          await chrome.tabs.update(lockTabs[0].id, { url: savedTabs[0].url, pinned: savedTabs[0].pinned });
        } catch (_) {
          try { await chrome.tabs.create({ url: savedTabs[0].url, pinned: savedTabs[0].pinned }); } catch (_2) {}
        }
      } else {
        try {
          await chrome.tabs.create({ url: savedTabs[i].url, pinned: savedTabs[i].pinned });
        } catch (_) {}
      }
    }

    // Close any extra lock-page tabs that have no matching saved tab
    for (let i = 1; i < lockTabs.length; i++) {
      try { await chrome.tabs.remove(lockTabs[i].id); } catch (_) {}
    }
  } else {
    // No saved tabs — open new tab page
    if (lockTabs.length > 0) {
      try { await chrome.tabs.update(lockTabs[0].id, { url: 'chrome://newtab/' }); } catch (_) {}
    } else {
      try { await chrome.tabs.create({ url: 'chrome://newtab/' }); } catch (_) {}
    }
    for (let i = 1; i < lockTabs.length; i++) {
      try { await chrome.tabs.remove(lockTabs[i].id); } catch (_) {}
    }
  }

  await chrome.storage.local.remove(STORAGE_KEYS.SAVED_TABS);
  chrome.action.setBadgeText({ text: '' });
  rescheduleAutoLockAlarm();

  // Notify any content scripts that are still alive on restored tabs
  const updatedTabs = await chrome.tabs.query({});
  for (const tab of updatedTabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'UNLOCK' });
    } catch (_) {}
  }
}

async function redirectAllTabsToLockPage() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && isExtensionUrl(tab.url)) continue;
    try {
      await chrome.tabs.update(tab.id, { url: LOCK_PAGE });
    } catch (_) {}
  }
}

// ---- Auto-Lock via chrome.alarms ----
// Alarms survive service worker termination; chrome.idle does not.

async function rescheduleAutoLockAlarm() {
  await chrome.alarms.clear(ALARM_NAME);

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LOCK_ENABLED,
    STORAGE_KEYS.AUTO_LOCK_MINUTES,
    STORAGE_KEYS.IS_LOCKED,
  ]);

  if (!data[STORAGE_KEYS.LOCK_ENABLED] || data[STORAGE_KEYS.IS_LOCKED]) return;

  const minutes = data[STORAGE_KEYS.AUTO_LOCK_MINUTES];
  if (minutes === 'close' || minutes === 0 || minutes === '0') return;

  const delayInMinutes = parseInt(minutes, 10);
  if (!isNaN(delayInMinutes) && delayInMinutes > 0) {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes });
  }
}

function cancelAutoLockAlarm() {
  chrome.alarms.clear(ALARM_NAME);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LOCK_ENABLED,
    STORAGE_KEYS.IS_LOCKED,
  ]);
  if (data[STORAGE_KEYS.LOCK_ENABLED] && !data[STORAGE_KEYS.IS_LOCKED]) {
    await lockBrowser();
  }
});

// Kick off the alarm on service worker wake if applicable
rescheduleAutoLockAlarm();

// ---- Password Hashing (PBKDF2) ----
// Each password is stored as { hash: hex, salt: hex, iterations: number }.
// The random salt means identical passwords produce different hashes.

async function hashPasswordPBKDF2(password) {
  const encoder = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 310_000;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    keyMaterial,
    256
  );

  const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  return {
    hash: toHex(hashBuffer),
    salt: toHex(saltBytes),
    iterations,
  };
}

async function verifyPasswordPBKDF2(password, stored) {
  const encoder = new TextEncoder();
  const saltBytes = new Uint8Array(stored.salt.match(/.{2}/g).map((b) => parseInt(b, 16)));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: stored.iterations },
    keyMaterial,
    256
  );

  const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return toHex(hashBuffer) === stored.hash;
}

// Legacy SHA-256 verification (for migration detection only)
async function hashPasswordV1(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_brave_biometric_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Brute-Force Rate Limiting ----

async function checkRateLimit() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.FAILED_ATTEMPTS,
    STORAGE_KEYS.LOCKED_UNTIL,
  ]);

  const lockedUntil = data[STORAGE_KEYS.LOCKED_UNTIL];
  if (lockedUntil) {
    if (lockedUntil === Infinity || lockedUntil > Date.now()) {
      const remaining = lockedUntil === Infinity ? null : Math.ceil((lockedUntil - Date.now()) / 1000);
      return { locked: true, remainingSeconds: remaining };
    }
  }

  return { locked: false };
}

async function recordFailedAttempt() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.FAILED_ATTEMPTS]);
  const attempts = (data[STORAGE_KEYS.FAILED_ATTEMPTS] || 0) + 1;

  let lockedUntil = null;
  for (const rule of LOCKOUT_SCHEDULE) {
    if (attempts >= rule.after) {
      lockedUntil = rule.durationMs === Infinity ? Infinity : Date.now() + rule.durationMs;
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.FAILED_ATTEMPTS]: attempts,
    [STORAGE_KEYS.LOCKED_UNTIL]: lockedUntil,
  });
}

// ---- Message Handling ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case 'GET_LOCK_STATE': {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.IS_LOCKED,
        STORAGE_KEYS.LOCK_ENABLED,
        STORAGE_KEYS.AUTO_LOCK_MINUTES,
        STORAGE_KEYS.FALLBACK_PASSWORD,
        STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1,
        STORAGE_KEYS.WEBAUTHN_CREDENTIAL,
        STORAGE_KEYS.SAVED_TABS,
      ]);
      return {
        isLocked: data[STORAGE_KEYS.IS_LOCKED] || false,
        lockEnabled: data[STORAGE_KEYS.LOCK_ENABLED] || false,
        autoLockMinutes: data[STORAGE_KEYS.AUTO_LOCK_MINUTES] ?? 5,
        hasPassword: !!(data[STORAGE_KEYS.FALLBACK_PASSWORD] || data[STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1]),
        hasLegacyPassword: !!data[STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1] && !data[STORAGE_KEYS.FALLBACK_PASSWORD],
        hasCredential: !!data[STORAGE_KEYS.WEBAUTHN_CREDENTIAL],
        savedTabCount: (data[STORAGE_KEYS.SAVED_TABS] || []).length,
      };
    }

    case 'GET_UNLOCK_AUDIT': {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.LAST_UNLOCK_TIME,
        STORAGE_KEYS.FAILED_ATTEMPTS,
        STORAGE_KEYS.LOCKED_UNTIL,
      ]);
      return {
        lastUnlockTime: data[STORAGE_KEYS.LAST_UNLOCK_TIME] || null,
        failedAttempts: data[STORAGE_KEYS.FAILED_ATTEMPTS] || 0,
        lockedUntil: data[STORAGE_KEYS.LOCKED_UNTIL] || null,
      };
    }

    case 'BIOMETRIC_AUTH_SUCCESS': {
      // Only accept from extension pages (not content scripts)
      if (!sender.url || !isExtensionUrl(sender.url)) {
        return { success: false, error: 'Unauthorized sender' };
      }
      await unlockBrowser();
      return { success: true };
    }

    case 'AUTHENTICATE_PASSWORD': {
      const rateCheck = await checkRateLimit();
      if (rateCheck.locked) {
        const msg = rateCheck.remainingSeconds
          ? `Too many attempts. Try again in ${rateCheck.remainingSeconds}s`
          : 'Too many attempts. Use biometrics to unlock.';
        return { success: false, error: msg, rateLimited: true };
      }

      const verified = await verifyPasswordAny(message.password);
      if (verified) {
        await unlockBrowser();
        return { success: true };
      }

      await recordFailedAttempt();
      return { success: false, error: 'Incorrect password' };
    }

    case 'VERIFY_PASSWORD': {
      const rateCheck = await checkRateLimit();
      if (rateCheck.locked) {
        return { success: false, error: 'Rate limited', rateLimited: true };
      }
      const verified = await verifyPasswordAny(message.password);
      if (!verified) await recordFailedAttempt();
      return { success: verified };
    }

    case 'SET_LOCK_ENABLED': {
      await chrome.storage.local.set({ [STORAGE_KEYS.LOCK_ENABLED]: message.enabled });
      if (!message.enabled) {
        await chrome.storage.local.set({ [STORAGE_KEYS.IS_LOCKED]: false });
        cancelAutoLockAlarm();
      } else {
        rescheduleAutoLockAlarm();
      }
      return { success: true };
    }

    case 'SET_AUTO_LOCK_MINUTES': {
      const raw = message.minutes;
      const value = raw === 'close' ? 'close' : parseInt(raw, 10);
      await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_LOCK_MINUTES]: value });
      rescheduleAutoLockAlarm();
      return { success: true };
    }

    case 'SET_FALLBACK_PASSWORD': {
      if (!message.password || message.password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }
      const stored = await hashPasswordPBKDF2(message.password);
      await chrome.storage.local.set({ [STORAGE_KEYS.FALLBACK_PASSWORD]: stored });
      // Clear legacy v1 hash on upgrade
      await chrome.storage.local.remove(STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1);
      return { success: true };
    }

    case 'REMOVE_FALLBACK_PASSWORD': {
      await chrome.storage.local.remove([
        STORAGE_KEYS.FALLBACK_PASSWORD,
        STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1,
      ]);
      return { success: true };
    }

    case 'RESET_CREDENTIAL': {
      await chrome.storage.local.remove(STORAGE_KEYS.WEBAUTHN_CREDENTIAL);
      return { success: true };
    }

    case 'LOCK_NOW': {
      const data = await chrome.storage.local.get([STORAGE_KEYS.LOCK_ENABLED]);
      if (!data[STORAGE_KEYS.LOCK_ENABLED]) {
        return { success: false, error: 'Lock is not enabled' };
      }
      await lockBrowser();
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ---- Helpers ----

async function verifyPasswordAny(password) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.FALLBACK_PASSWORD,
    STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1,
  ]);

  // Prefer new PBKDF2 format
  if (data[STORAGE_KEYS.FALLBACK_PASSWORD]) {
    return verifyPasswordPBKDF2(password, data[STORAGE_KEYS.FALLBACK_PASSWORD]);
  }

  // Fall back to legacy v1 format (detected but NOT auto-migrated — user prompted in UI)
  if (data[STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1]) {
    const inputHash = await hashPasswordV1(password);
    return inputHash === data[STORAGE_KEYS.FALLBACK_PASSWORD_HASH_V1];
  }

  return false;
}

function isExtensionUrl(url) {
  return url.startsWith(chrome.runtime.getURL(''));
}

function isInternalUrl(url) {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('brave://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://')
  );
}

function setBadgeLocked() {
  chrome.action.setBadgeText({ text: '🔒' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
}
