/**
 * Diablo Tab Behavior - Open new tabs outside tab groups
 *
 * When "Open tabs outside groups" is enabled, intercepts:
 * - Ctrl+Click / Cmd+Click (new tab intent)
 * - Middle-click (auxclick, button 1)
 * and opens the link via background script with chrome.tabs.create()
 * so the new tab is not added to the current group.
 *
 * Caches the setting so we can synchronously preventDefault when enabled.
 */

(function () {
  let tabOutsideGroupsEnabled = false;

  chrome.storage.sync.get({ tabOutsideGroupsEnabled: false }, (stored) => {
    tabOutsideGroupsEnabled = stored && stored.tabOutsideGroupsEnabled === true;
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.tabOutsideGroupsEnabled) return;
    tabOutsideGroupsEnabled = changes.tabOutsideGroupsEnabled.newValue === true;
  });

  function findAnchor(e) {
    let t = e.target;
    if (!t) return null;
    if (t.nodeType === Node.TEXT_NODE) t = t.parentElement;
    if (!t || typeof t.closest !== 'function') return null;
    return t.closest('a[href]');
  }

  function getLinkUrl(a) {
    if (!a || !a.href) return null;
    try {
      const url = new URL(a.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function handleClick(e) {
    if (!tabOutsideGroupsEnabled) return;
    const isNewTabModifier = e.ctrlKey || e.metaKey;
    const isMiddleClick = e.button === 1;
    if (!isNewTabModifier && !isMiddleClick) return;

    const a = findAnchor(e);
    if (!a) return;
    const url = getLinkUrl(a);
    if (!url) return;

    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'openTab', url });
  }

  function handleAuxClick(e) {
    if (!tabOutsideGroupsEnabled) return;
    if (e.button !== 1) return;

    const a = findAnchor(e);
    if (!a) return;
    const url = getLinkUrl(a);
    if (!url) return;

    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'openTab', url });
  }

  document.addEventListener('click', handleClick, true);
  document.addEventListener('auxclick', handleAuxClick, true);
})();
