/**
 * Diablo Popup - Read/write settings from chrome.storage.sync
 *
 * On load: read peek-related settings
 * and set toggle states. On change: write back to storage.
 * Content scripts read these settings when acting, so changes apply immediately.
 */

(function () {
  const DEFAULTS = globalThis.DIABLO_DEFAULT_SETTINGS || {
    peekEnabled: true,
    peekSizePreset: 'medium',
    aggressiveXUnshortenEnabled: false,
  };

  const ids = ['peekEnabled', 'aggressiveXUnshortenEnabled'];

  function load() {
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = stored[id] === true;
      });
      const sizeEl = document.getElementById('peekSizePreset');
      if (sizeEl) {
        const preset = stored.peekSizePreset;
        sizeEl.value = (preset === 'small' || preset === 'large' || preset === 'medium') ? preset : 'medium';
      }
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

  const sizeEl = document.getElementById('peekSizePreset');
  if (sizeEl) {
    sizeEl.addEventListener('change', () => {
      const value = sizeEl.value;
      const preset = (value === 'small' || value === 'large' || value === 'medium') ? value : 'medium';
      save('peekSizePreset', preset);
    });
  }
})();
