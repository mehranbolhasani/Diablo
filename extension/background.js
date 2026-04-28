/**
 * Diablo - Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * - Set default settings on install
 * - Route messages from content scripts
 * - Open new tabs from peek panel actions
 * - Manage declarativeNetRequest session rules so the peek iframe can load any site
 *   (strips X-Frame-Options and CSP headers for sub_frame in the active tab)
 */

importScripts('shared/constants.js');

const DEFAULT_SETTINGS = globalThis.DIABLO_DEFAULT_SETTINGS || {
  peekEnabled: true,
  peekSizePreset: 'medium',
  aggressiveXUnshortenEnabled: false,
};

// ---------------------------------------------------------------------------
// Peek: use declarativeNetRequest to strip frame-blocking headers
// ---------------------------------------------------------------------------

const PEEK_RULE_ID_BASE = 100000;
const activePeekSessions = new Map();

function getPeekRuleId(tabId) {
  // Keep deterministic per-tab ids so concurrent peeks in different tabs do not conflict.
  return PEEK_RULE_ID_BASE + tabId;
}

function normalizeHttpUrl(input) {
  if (typeof input !== 'string') return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function getDomain(input) {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTcoUrl(input) {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 't.co' || host.endsWith('.t.co');
  } catch {
    return false;
  }
}

/**
 * Add a session rule that removes X-Frame-Options and Content-Security-Policy
 * response headers for sub_frame requests in the given tab.
 * This lets our peek iframe load any URL without being blocked.
 */
async function enablePeekHeaders(tabId, targetUrl) {
  const targetDomain = getDomain(targetUrl);
  if (!targetDomain) {
    console.warn('[Diablo] Skipping peek header rule due to invalid domain:', targetUrl);
    return;
  }
  const ruleId = getPeekRuleId(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
          ],
        },
        condition: {
          resourceTypes: ['sub_frame'],
          tabIds: [tabId],
          requestDomains: [targetDomain],
        },
      }],
    });
  } catch (e) {
    console.warn('[Diablo] Could not set peek header rules:', e);
  }
}

/** Remove the peek header-stripping rule. */
async function disablePeekHeaders(tabId) {
  const ruleId = getPeekRuleId(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
    });
  } catch (error) {
    console.debug('[Diablo] Failed to remove peek header rule:', error);
  }
}

async function resolveFinalUrl(url, aggressive) {
  let timeoutId = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (res.body) {
      try { await res.body.cancel(); } catch (_) {}
    }
    const normalized = normalizeHttpUrl(res.url);
    const resolved = normalized || url;
    if (!isTcoUrl(url) || !isTcoUrl(resolved)) return resolved;
    if (!aggressive) return resolved;
    return await resolveTcoViaTemporaryTab(resolved);
  } catch {
    if (aggressive && isTcoUrl(url)) return await resolveTcoViaTemporaryTab(url);
    return url;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function resolveTcoViaTemporaryTab(url) {
  console.warn('[Diablo] Aggressive t.co resolution uses a temporary background tab.');
  return new Promise((resolve) => {
    let tempTabId = null;
    let done = false;
    const timeoutId = setTimeout(() => finish(url), 3500);

    function finish(resultUrl) {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (typeof tempTabId === 'number') {
        chrome.tabs.remove(tempTabId, () => {
          // Ignore if tab already closed.
          void chrome.runtime.lastError;
        });
      }
      resolve(normalizeHttpUrl(resultUrl) || url);
    }

    function onUpdated(tabId, changeInfo, tab) {
      if (tabId !== tempTabId) return;
      const candidate = normalizeHttpUrl(changeInfo.url || (tab && tab.url) || '');
      if (candidate && !isTcoUrl(candidate)) {
        finish(candidate);
        return;
      }
      if (changeInfo.status === 'complete') {
        finish(candidate || url);
      }
    }

    function onRemoved(tabId) {
      if (tabId === tempTabId) finish(url);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab || typeof tab.id !== 'number') {
        finish(url);
        return;
      }
      tempTabId = tab.id;
    });
  });
}

// ---------------------------------------------------------------------------
// Install: set default settings
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
    const toSet = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (stored[key] === undefined) toSet[key] = DEFAULT_SETTINGS[key];
    }
    if (Object.keys(toSet).length) chrome.storage.sync.set(toSet);
  });
});

function updateActionBadge(isEnabled) {
  if (isEnabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeBackgroundColor({ color: '#a11a1a' });
  chrome.action.setBadgeText({ text: 'OFF' });
}

function syncBadgeFromStorage() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    const enabled = stored.peekEnabled !== false;
    updateActionBadge(enabled);
  });
}

chrome.runtime.onStartup.addListener(syncBadgeFromStorage);
chrome.runtime.onInstalled.addListener(syncBadgeFromStorage);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes.peekEnabled) return;
  updateActionBadge(changes.peekEnabled.newValue !== false);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activePeekSessions.delete(tabId);
  disablePeekHeaders(tabId);
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'openTab') {
    const safeUrl = normalizeHttpUrl(message.url);
    if (!safeUrl) {
      sendResponse({ ok: false, error: 'Invalid URL' });
      return false;
    }
    chrome.tabs.create({ url: safeUrl, active: false });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'peekStart') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false });
      return false;
    }
    const sessionId = typeof message.sessionId === 'number' ? message.sessionId : 0;
    const targetUrl = normalizeHttpUrl(message.url || '');
    if (!targetUrl) {
      sendResponse({ ok: false, error: 'Invalid target URL' });
      return false;
    }
    activePeekSessions.set(tabId, sessionId);
    enablePeekHeaders(tabId, targetUrl).then(() => sendResponse({ ok: true }));
    return true; // async
  }

  if (message.type === 'peekEnd') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false });
      return false;
    }
    const sessionId = typeof message.sessionId === 'number' ? message.sessionId : 0;
    const activeSessionId = activePeekSessions.get(tabId);
    if (activeSessionId !== sessionId) {
      sendResponse({ ok: true, skipped: true });
      return false;
    }
    activePeekSessions.delete(tabId);
    disablePeekHeaders(tabId).then(() => sendResponse({ ok: true }));
    return true; // async
  }

  if (message.type === 'resolveFinalUrl') {
    const safeUrl = normalizeHttpUrl(message.url);
    if (!safeUrl) {
      sendResponse({ url: message.url || '' });
      return false;
    }
    const aggressive = message.aggressive === true;
    resolveFinalUrl(safeUrl, aggressive).then((resolvedUrl) => sendResponse({ url: resolvedUrl }));
    return true; // async
  }

  sendResponse({ error: 'Unknown message type' });
  return false;
});
