/**
 * Diablo - Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * - Set default settings on install
 * - Route messages from content scripts
 * - Open new tabs (ungrouped) for tabBehavior.js
 * - Manage declarativeNetRequest session rules so the peek iframe can load any site
 *   (strips X-Frame-Options and CSP headers for sub_frame in the active tab)
 * - Fetch page metadata for hoverPreview.js with in-memory LRU cache
 */

const DEFAULT_SETTINGS = {
  peekEnabled: true,
  hoverPreviewEnabled: true,
  tabOutsideGroupsEnabled: false,
};

// ---------------------------------------------------------------------------
// Peek: use declarativeNetRequest to strip frame-blocking headers
// ---------------------------------------------------------------------------

const PEEK_RULE_ID = 99999;

/**
 * Add a session rule that removes X-Frame-Options and Content-Security-Policy
 * response headers for sub_frame requests in the given tab.
 * This lets our peek iframe load any URL without being blocked.
 */
async function enablePeekHeaders(tabId) {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [PEEK_RULE_ID],
      addRules: [{
        id: PEEK_RULE_ID,
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
        },
      }],
    });
  } catch (e) {
    console.warn('[Diablo] Could not set peek header rules:', e);
  }
}

/** Remove the peek header-stripping rule. */
async function disablePeekHeaders() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [PEEK_RULE_ID],
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Metadata LRU cache
// ---------------------------------------------------------------------------

const METADATA_CACHE_MAX = 200;
const metadataCache = new Map();

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function parseMetadata(html, url) {
  const domain = getDomain(url);
  let title = '';
  let description = '';

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (metaDesc) description = metaDesc[1].trim();

  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i);
  if (ogTitle && !title) title = ogTitle[1].trim();

  return { title: title || domain, description, domain };
}

function cacheSet(key, value) {
  if (metadataCache.has(key)) metadataCache.delete(key);
  metadataCache.set(key, value);
  if (metadataCache.size > METADATA_CACHE_MAX) {
    const firstKey = metadataCache.keys().next().value;
    metadataCache.delete(firstKey);
  }
}

async function fetchMetadata(url) {
  const cached = metadataCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
    const html = await res.text();
    const meta = parseMetadata(html, url);
    cacheSet(url, meta);
    return meta;
  } catch {
    const domain = getDomain(url);
    const fallback = { title: domain, description: '', domain };
    cacheSet(url, fallback);
    return fallback;
  }
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

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'openTab') {
    chrome.tabs.create({ url: message.url, active: false });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'peekStart') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) enablePeekHeaders(tabId).then(() => sendResponse({ ok: true }));
    else sendResponse({ ok: false });
    return true; // async
  }

  if (message.type === 'peekEnd') {
    disablePeekHeaders().then(() => sendResponse({ ok: true }));
    return true; // async
  }

  if (message.type === 'fetchMetadata') {
    fetchMetadata(message.url).then(sendResponse);
    return true; // async
  }

  sendResponse({ error: 'Unknown message type' });
  return false;
});
