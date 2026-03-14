/**
 * Diablo Popup - Read/write settings from chrome.storage.sync
 *
 * On load: read peekEnabled, hoverPreviewEnabled, tabOutsideGroupsEnabled
 * and set toggle states. On change: write back to storage.
 * Content scripts read these settings when acting, so changes apply immediately.
 */

(function () {
  const DEFAULTS = {
    peekEnabled: true,
    hoverPreviewEnabled: true,
    tabOutsideGroupsEnabled: false,
  };

  const ids = ['peekEnabled', 'hoverPreviewEnabled', 'tabOutsideGroupsEnabled'];

  function load() {
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = stored[id] === true;
      });
    });
  }

  function save(id, checked) {
    chrome.storage.sync.set({ [id]: checked });
  }

  load();

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      el.setAttribute('aria-checked', el.checked ? 'true' : 'false');
      save(id, el.checked);
    });
  });
})();
