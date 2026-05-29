/**
 * Diablo Popup - Read/write settings from chrome.storage.sync
 *
 * On load: read peek-related settings
 * and set toggle states. On change: write back to storage.
 * Content scripts read these settings when acting, so changes apply immediately.
 *
 * SYNC: when adding a setting, update these keys in all four locations:
 *   shared/constants.js, background.js, peek.js, popup.js
 * Current keys: peekEnabled, peekSizePreset, aggressiveXUnshortenEnabled, readerTheme
 */

(function () {
  const DEFAULTS = globalThis.DIABLO_DEFAULT_SETTINGS || {
    peekEnabled: true,
    peekSizePreset: 'medium',
    aggressiveXUnshortenEnabled: false,
    readerTheme: 'paper',
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
      const themeEl = document.getElementById('readerTheme');
      if (themeEl) {
        const theme = stored.readerTheme;
        themeEl.value = (theme === 'paper' || theme === 'dusk' || theme === 'ink') ? theme : 'paper';
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

  const themeEl = document.getElementById('readerTheme');
  if (themeEl) {
    themeEl.addEventListener('change', () => {
      const value = themeEl.value;
      const theme = (value === 'paper' || value === 'dusk' || value === 'ink') ? value : 'paper';
      save('readerTheme', theme);
    });
  }
})();
