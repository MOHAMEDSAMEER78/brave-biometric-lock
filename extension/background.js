// ============================================================
// Brave Biometric Lock — Background Service Worker
// ============================================================

const LOCK_PAGE = chrome.runtime.getURL('lock/lock.html');

const STORAGE_KEYS = {
  IS_LOCKED: 'biometric_locked',
  LOCK_ENABLED: 'biometric_lock_enabled',
  AUTO_LOCK_MINUTES: 'auto_lock_minutes',
  FALLBACK_PASSWORD_HASH: 'fallback_password_hash',
  SAVED_TABS: 'saved_tabs',
  LOCKED_SITES: 'locked_sites',
  SITE_SESSIONS: 'site_sessions',
  SITE_LOCK_DURATION: 'site_lock_duration',
};

// ---- Site Lock Utilities ----

function getMatchingLockedSite(url, lockedSites) {
  try {
    const hostname = new URL(url).hostname;
    for (const site of lockedSites) {
      // Exact match or subdomain match (google.com matches mail.google.com)
      if (hostname === site || hostname.endsWith('.' + site)) {
        return site;
      }
    }
  } catch (e) { }
  return null;
}

function normalizeDomain(input) {
  let domain = input.trim().toLowerCase();
  // Strip protocol
  domain = domain.replace(/^https?:\/\//, '');
  // Strip path, query, hash
  domain = domain.split('/')[0].split('?')[0].split('#')[0];
  // Strip www.
  domain = domain.replace(/^www\./, '');
  // Strip trailing dots
  domain = domain.replace(/\.+$/, '');
  return domain;
}

async function grantSiteSession(site) {
  const data = await chrome.storage.local.get([STORAGE_KEYS.SITE_SESSIONS, STORAGE_KEYS.SITE_LOCK_DURATION]);
  const sessions = data[STORAGE_KEYS.SITE_SESSIONS] || {};
  const duration = data[STORAGE_KEYS.SITE_LOCK_DURATION] || 30;
  sessions[site] = Date.now() + duration * 60 * 1000;
  await chrome.storage.local.set({ [STORAGE_KEYS.SITE_SESSIONS]: sessions });
}

function isInternalUrl(url) {
  return url.startsWith('chrome://') || url.startsWith('brave://') ||
    url.startsWith('chrome-extension://') || url.startsWith('about:') ||
    url.startsWith('edge://') || url.startsWith('devtools://');
}

// ---- Initialization ----
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([STORAGE_KEYS.LOCK_ENABLED]);

  if (data[STORAGE_KEYS.LOCK_ENABLED] === undefined) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LOCK_ENABLED]: false,
      [STORAGE_KEYS.AUTO_LOCK_MINUTES]: 5,
      [STORAGE_KEYS.IS_LOCKED]: false,
    });
  }
});

// Lock on browser startup
chrome.runtime.onStartup.addListener(async () => {
  // Clear all site sessions on restart (forces re-auth)
  await chrome.storage.local.set({ [STORAGE_KEYS.SITE_SESSIONS]: {} });

  const data = await chrome.storage.local.get([STORAGE_KEYS.LOCK_ENABLED]);
  if (data[STORAGE_KEYS.LOCK_ENABLED]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.IS_LOCKED]: true });

    // Save restored tabs FIRST — these are the real URLs from the last session
    const tabs = await chrome.tabs.query({});
    const realTabs = tabs.filter(t => t.url && !t.url.includes('lock/lock.html') && !t.url.startsWith('chrome-extension://'));
    if (realTabs.length > 0) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SAVED_TABS]: realTabs.map(t => ({ id: t.id, url: t.url })),
      });
    }

    // NOW redirect all tabs to lock page
    for (const tab of tabs) {
      try {
        if (tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) continue;
        await chrome.tabs.update(tab.id, { url: LOCK_PAGE });
      } catch (e) { }
    }
    chrome.action.setBadgeText({ text: '🔒' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }
});

// Continuously snapshot open tabs so we always have latest URLs
// (handles the case where user closes browser directly without locking first)
async function snapshotTabs() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.LOCK_ENABLED, STORAGE_KEYS.IS_LOCKED]);
  // Only snapshot when lock is enabled but browser is NOT currently locked
  if (data[STORAGE_KEYS.LOCK_ENABLED] && !data[STORAGE_KEYS.IS_LOCKED]) {
    const tabs = await chrome.tabs.query({});
    const realTabs = tabs.filter(t => t.url && !t.url.includes('lock/lock.html') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:'));
    if (realTabs.length > 0) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.SAVED_TABS]: realTabs.map(t => ({ id: t.id, url: t.url })),
      });
    }
  }
}

// Snapshot on tab changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') snapshotTabs();
});
chrome.tabs.onRemoved.addListener(() => snapshotTabs());

// Fallback: also check lock state when any tab is created (catches startup tabs)
let startupLockChecked = false;
chrome.tabs.onCreated.addListener(async (tab) => {
  const data = await chrome.storage.local.get([STORAGE_KEYS.IS_LOCKED, STORAGE_KEYS.LOCK_ENABLED]);

  // On very first tab after startup, ensure lock is applied
  if (!startupLockChecked && data[STORAGE_KEYS.LOCK_ENABLED]) {
    startupLockChecked = true;
    if (data[STORAGE_KEYS.IS_LOCKED]) {
      try {
        await chrome.tabs.update(tab.id, { url: LOCK_PAGE });
      } catch (e) { }
      return;
    }
  }

  // Normal lock interception for new tabs while locked
  if (data[STORAGE_KEYS.IS_LOCKED]) {
    try {
      await chrome.tabs.update(tab.id, { url: LOCK_PAGE });
    } catch (e) { }
  }
});

// ---- Lock / Unlock ----
async function lockBrowser() {
  // Clear all site sessions when global lock activates
  await chrome.storage.local.set({
    [STORAGE_KEYS.IS_LOCKED]: true,
    [STORAGE_KEYS.SITE_SESSIONS]: {},
  });

  const tabs = await chrome.tabs.query({});

  // Only save tabs if we don't already have real saved tabs
  // (prevents overwriting real URLs with lock page URLs on startup)
  const existing = await chrome.storage.local.get([STORAGE_KEYS.SAVED_TABS]);
  const alreadySaved = existing[STORAGE_KEYS.SAVED_TABS] || [];
  const hasRealSavedTabs = alreadySaved.some(t => t.url && !t.url.includes('lock/lock.html'));

  if (!hasRealSavedTabs) {
    const realTabs = tabs.filter(t => t.url && !t.url.startsWith(chrome.runtime.getURL('')));
    if (realTabs.length > 0) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SAVED_TABS]: realTabs.map(t => ({ id: t.id, url: t.url })) });
    }
  }

  // Redirect ALL tabs to the lock page
  for (const tab of tabs) {
    try {
      // Skip tabs already showing the lock page
      if (tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) continue;
      await chrome.tabs.update(tab.id, { url: LOCK_PAGE });
    } catch (e) {
      // Some tabs can't be updated (devtools, etc.)
    }
  }

  // Update badge
  chrome.action.setBadgeText({ text: '🔒' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
}

async function unlockBrowser() {
  await chrome.storage.local.set({ [STORAGE_KEYS.IS_LOCKED]: false });

  // Restore saved tab URLs
  const data = await chrome.storage.local.get([STORAGE_KEYS.SAVED_TABS]);
  const savedTabs = data[STORAGE_KEYS.SAVED_TABS] || [];

  const currentTabs = await chrome.tabs.query({});

  // Filter saved tabs to only real URLs (not extension pages)
  const restorable = savedTabs.filter(
    (t) => t.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('about:')
  );

  if (restorable.length > 0) {
    // Restore each current tab to its corresponding saved URL
    for (let i = 0; i < currentTabs.length; i++) {
      const savedUrl = restorable[i] ? restorable[i].url : null;

      if (savedUrl) {
        try {
          await chrome.tabs.update(currentTabs[i].id, { url: savedUrl });
        } catch (e) {
          // If we can't update, try creating a new tab
          try { await chrome.tabs.create({ url: savedUrl }); } catch (e2) { }
        }
      } else if (i > 0) {
        // Extra lock tabs with no corresponding saved tab — close them
        try { await chrome.tabs.remove(currentTabs[i].id); } catch (e) { }
      } else {
        // First tab, no saved URL — go to new tab
        try { await chrome.tabs.update(currentTabs[i].id, { url: 'brave://newtab' }); } catch (e) { }
      }
    }

    // If we had more saved tabs than current tabs, open the remaining ones
    if (restorable.length > currentTabs.length) {
      for (let i = currentTabs.length; i < restorable.length; i++) {
        try {
          await chrome.tabs.create({ url: restorable[i].url });
        } catch (e) { }
      }
    }
  } else {
    // No saved tabs — just navigate away from lock page
    if (currentTabs.length > 0) {
      await chrome.tabs.update(currentTabs[0].id, { url: 'brave://newtab' });
    }
    // Close extra lock tabs
    for (let i = 1; i < currentTabs.length; i++) {
      try { await chrome.tabs.remove(currentTabs[i].id); } catch (e) { }
    }
  }

  // Clear saved tabs
  await chrome.storage.local.remove(STORAGE_KEYS.SAVED_TABS);

  // Clear badge
  chrome.action.setBadgeText({ text: '' });
}

// Also intercept tab navigation while locked (global + site locks)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (isInternalUrl(changeInfo.url) || changeInfo.url.startsWith(chrome.runtime.getURL(''))) return;

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.IS_LOCKED,
    STORAGE_KEYS.LOCKED_SITES,
    STORAGE_KEYS.SITE_SESSIONS,
  ]);

  // Global lock takes priority
  if (data[STORAGE_KEYS.IS_LOCKED]) {
    try {
      await chrome.tabs.update(tabId, { url: LOCK_PAGE });
    } catch (e) { }
    return;
  }

  // Site lock check
  const lockedSites = data[STORAGE_KEYS.LOCKED_SITES] || [];
  if (lockedSites.length === 0) return;

  const matchedSite = getMatchingLockedSite(changeInfo.url, lockedSites);
  if (!matchedSite) return;

  const sessions = data[STORAGE_KEYS.SITE_SESSIONS] || {};
  if (sessions[matchedSite] && Date.now() < sessions[matchedSite]) return;

  // No valid session — redirect to lock page
  const lockUrl = LOCK_PAGE + '?site=' + encodeURIComponent(matchedSite) +
    '&returnUrl=' + encodeURIComponent(changeInfo.url);
  try {
    await chrome.tabs.update(tabId, { url: lockUrl });
  } catch (e) { }
});

// ---- Password Hashing ----
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_brave_biometric_salt_v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.FALLBACK_PASSWORD_HASH]);
  const storedHash = stored[STORAGE_KEYS.FALLBACK_PASSWORD_HASH];
  if (!storedHash) return false;
  const inputHash = await hashPassword(password);
  return inputHash === storedHash;
}

// ---- Idle Detection ----
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'locked' || state === 'idle') {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.LOCK_ENABLED,
      STORAGE_KEYS.IS_LOCKED,
      STORAGE_KEYS.AUTO_LOCK_MINUTES,
    ]);

    // Skip idle lock if set to "close" (only lock on browser restart) or "0" (never)
    const autoLock = data[STORAGE_KEYS.AUTO_LOCK_MINUTES];
    if (autoLock === 'close' || autoLock === 0 || autoLock === '0') return;

    if (data[STORAGE_KEYS.LOCK_ENABLED] && !data[STORAGE_KEYS.IS_LOCKED]) {
      await lockBrowser();
    }
  }
});

// Set idle detection interval
chrome.storage.local.get([STORAGE_KEYS.AUTO_LOCK_MINUTES], (data) => {
  const minutes = data[STORAGE_KEYS.AUTO_LOCK_MINUTES] || 5;
  if (minutes > 0) {
    chrome.idle.setDetectionInterval(minutes * 60);
  }
});

// ---- Site Lock Navigation Interception ----
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only intercept main frame navigations
  if (details.frameId !== 0) return;

  const url = details.url;
  if (isInternalUrl(url) || url.startsWith(chrome.runtime.getURL(''))) return;

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.IS_LOCKED,
    STORAGE_KEYS.LOCKED_SITES,
    STORAGE_KEYS.SITE_SESSIONS,
  ]);

  // Global lock takes priority (handled by existing logic)
  if (data[STORAGE_KEYS.IS_LOCKED]) return;

  const lockedSites = data[STORAGE_KEYS.LOCKED_SITES] || [];
  if (lockedSites.length === 0) return;

  const matchedSite = getMatchingLockedSite(url, lockedSites);
  if (!matchedSite) return;

  // Check session (lazy expiry)
  const sessions = data[STORAGE_KEYS.SITE_SESSIONS] || {};
  if (sessions[matchedSite] && Date.now() < sessions[matchedSite]) return;

  // No valid session — redirect to lock page
  const lockUrl = LOCK_PAGE + '?site=' + encodeURIComponent(matchedSite) +
    '&returnUrl=' + encodeURIComponent(url);
  try {
    await chrome.tabs.update(details.tabId, { url: lockUrl });
  } catch (e) { }
});

// ---- Message Handling ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_LOCK_STATE': {
      const data = await chrome.storage.local.get([
        STORAGE_KEYS.IS_LOCKED,
        STORAGE_KEYS.LOCK_ENABLED,
        STORAGE_KEYS.AUTO_LOCK_MINUTES,
        STORAGE_KEYS.FALLBACK_PASSWORD_HASH,
      ]);
      return {
        isLocked: data[STORAGE_KEYS.IS_LOCKED] || false,
        lockEnabled: data[STORAGE_KEYS.LOCK_ENABLED] || false,
        autoLockMinutes: data[STORAGE_KEYS.AUTO_LOCK_MINUTES] || 5,
        hasPassword: !!data[STORAGE_KEYS.FALLBACK_PASSWORD_HASH],
      };
    }

    case 'BIOMETRIC_AUTH_SUCCESS': {
      // Called by lock page / popup after successful WebAuthn verification.
      // Verify the sender is an extension page (not a content script).
      if (sender.url && sender.url.startsWith(chrome.runtime.getURL(''))) {
        await unlockBrowser();
        return { success: true };
      }
      return { success: false, error: 'Unauthorized sender' };
    }

    case 'AUTHENTICATE_PASSWORD': {
      const verified = await verifyPassword(message.password);
      if (verified) {
        await unlockBrowser();
        return { success: true };
      }
      return { success: false, error: 'Incorrect password' };
    }

    case 'VERIFY_PASSWORD': {
      const verified = await verifyPassword(message.password);
      return { success: verified, error: verified ? '' : 'Incorrect password' };
    }

    case 'VERIFY_BIOMETRIC': {
      // Biometric verification now happens directly in the popup/lock page
      // via WebAuthn. This message type is kept for backward compatibility
      // but the actual auth is handled client-side.
      return { success: false, error: 'Use WebAuthn directly from extension page' };
    }

    case 'SET_LOCK_ENABLED': {
      await chrome.storage.local.set({
        [STORAGE_KEYS.LOCK_ENABLED]: message.enabled,
      });
      if (!message.enabled) {
        await chrome.storage.local.set({ [STORAGE_KEYS.IS_LOCKED]: false });
      }
      return { success: true };
    }

    case 'SET_AUTO_LOCK_MINUTES': {
      const raw = message.minutes;
      const value = raw === 'close' ? 'close' : parseInt(raw, 10);
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_LOCK_MINUTES]: value,
      });
      if (typeof value === 'number' && value > 0) {
        chrome.idle.setDetectionInterval(value * 60);
      }
      return { success: true };
    }

    case 'SET_FALLBACK_PASSWORD': {
      if (message.password) {
        const hash = await hashPassword(message.password);
        await chrome.storage.local.set({
          [STORAGE_KEYS.FALLBACK_PASSWORD_HASH]: hash,
        });
      } else {
        await chrome.storage.local.remove(STORAGE_KEYS.FALLBACK_PASSWORD_HASH);
      }
      return { success: true };
    }

    case 'LOCK_NOW': {
      await lockBrowser();
      return { success: true };
    }

    case 'CHECK_BIOMETRIC_SUPPORT': {
      // Biometric support is now checked directly in extension pages via WebAuthn.
      // Service workers don't have access to navigator.credentials, so we return
      // a hint to check from the extension page context.
      return { supported: false, error: 'Check from extension page using isBiometricAvailable()' };
    }

    // ---- Site Lock Message Handlers ----

    case 'SITE_BIOMETRIC_AUTH_SUCCESS': {
      if (sender.url && sender.url.startsWith(chrome.runtime.getURL(''))) {
        const site = message.site;
        if (site) {
          await grantSiteSession(site);
          return { success: true };
        }
        return { success: false, error: 'No site specified' };
      }
      return { success: false, error: 'Unauthorized sender' };
    }

    case 'SITE_AUTHENTICATE_PASSWORD': {
      const verified = await verifyPassword(message.password);
      if (verified) {
        const site = message.site;
        if (site) {
          await grantSiteSession(site);
          return { success: true };
        }
        return { success: false, error: 'No site specified' };
      }
      return { success: false, error: 'Incorrect password' };
    }

    case 'ADD_LOCKED_SITE': {
      const domain = normalizeDomain(message.domain || '');
      if (!domain || !domain.includes('.')) {
        return { success: false, error: 'Invalid domain' };
      }
      const siteData = await chrome.storage.local.get([STORAGE_KEYS.LOCKED_SITES]);
      const sites = siteData[STORAGE_KEYS.LOCKED_SITES] || [];
      if (sites.includes(domain)) {
        return { success: false, error: 'Site already locked' };
      }
      sites.push(domain);
      await chrome.storage.local.set({ [STORAGE_KEYS.LOCKED_SITES]: sites });
      return { success: true, sites };
    }

    case 'REMOVE_LOCKED_SITE': {
      const siteData = await chrome.storage.local.get([STORAGE_KEYS.LOCKED_SITES, STORAGE_KEYS.SITE_SESSIONS]);
      const sites = (siteData[STORAGE_KEYS.LOCKED_SITES] || []).filter(s => s !== message.domain);
      const sessions = siteData[STORAGE_KEYS.SITE_SESSIONS] || {};
      delete sessions[message.domain];
      await chrome.storage.local.set({
        [STORAGE_KEYS.LOCKED_SITES]: sites,
        [STORAGE_KEYS.SITE_SESSIONS]: sessions,
      });
      return { success: true, sites };
    }

    case 'GET_LOCKED_SITES': {
      const siteData = await chrome.storage.local.get([
        STORAGE_KEYS.LOCKED_SITES,
        STORAGE_KEYS.SITE_LOCK_DURATION,
      ]);
      return {
        success: true,
        sites: siteData[STORAGE_KEYS.LOCKED_SITES] || [],
        duration: siteData[STORAGE_KEYS.SITE_LOCK_DURATION] || 30,
      };
    }

    case 'SET_SITE_LOCK_DURATION': {
      const duration = parseInt(message.duration, 10);
      if (isNaN(duration) || duration < 1) {
        return { success: false, error: 'Invalid duration' };
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.SITE_LOCK_DURATION]: duration });
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}
