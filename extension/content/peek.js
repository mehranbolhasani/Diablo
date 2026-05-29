/**
 * Diablo Peek - Floating link preview on Shift+Click
 *
 * How it works:
 * 1. User Shift+Clicks a link.
 * 2. Content script tells background to add a declarativeNetRequest session rule
 *    that strips X-Frame-Options and CSP headers for sub_frame requests in this tab.
 * 3. An iframe with src=URL loads the page normally -- correct origin, all resources,
 *    full JS -- because the blocking headers have been removed.
 * 4. When the panel closes, the rule is removed.
 *
 * This avoids the problems with srcdoc (CORS / wrong origin) and lets every site render.
 *
 * SYNC: when adding a setting, update these keys in all four locations:
 *   shared/constants.js, background.js, peek.js, popup.js
 * Current keys: peekEnabled, peekSizePreset, aggressiveXUnshortenEnabled, readerTheme
 */

(function () {
  const PEEK_HOST_ID = 'diablo-peek-host';
  const DEFAULT_SETTINGS = globalThis.DIABLO_DEFAULT_SETTINGS || {
    peekEnabled: true,
    peekSizePreset: 'medium',
    aggressiveXUnshortenEnabled: false,
    readerTheme: 'paper',
  };
  const PEEK_SIZE_CLASS = {
    small: 'diablo-peek-size-small',
    medium: 'diablo-peek-size-medium',
    large: 'diablo-peek-size-large',
  };
  const FALLBACK_CSS = `
    .diablo-peek-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647}
    .diablo-peek-panel{width:80vw;height:80vh;max-width:1200px;max-height:800px;background:#1a1a1a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
    .diablo-peek-topbar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#252525}
    .diablo-peek-actions{display:flex;align-items:center;gap:6px}
    .diablo-peek-url-wrap{flex:1;display:flex;align-items:center;gap:4px;padding:4px 4px 4px 10px;background:#1a1a1a;border-radius:6px;min-width:0}
    .diablo-peek-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a0a0a0;font-size:13px}
    .diablo-peek-btn{padding:6px 10px;border:none;border-radius:6px;cursor:pointer;background:#333;color:#e0e0e0;white-space:nowrap}
    .diablo-peek-btn-close{padding:6px 10px;background:transparent;color:#888;font-size:16px}
    .diablo-peek-btn-copy{padding:4px 6px;background:transparent;color:#888;flex-shrink:0}
    .diablo-peek-frame-wrap{flex:1;min-height:0;position:relative}
    .diablo-peek-frame{width:100%;height:100%;border:none;background:#fff}
    .diablo-peek-loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#888;background:#1a1a1a}
    .diablo-peek-spinner{width:32px;height:32px;border:3px solid #333;border-top-color:#888;border-radius:50%;animation:s .7s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
  `;

  const ICONS = {
    back: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-chevron-left-icon lucide-chevron-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    forward: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-chevron-right-icon lucide-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    refresh: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-refresh-ccw-icon lucide-refresh-ccw" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
    copy: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-copy-icon lucide-copy" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    reader: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-notepad-text-icon lucide-notepad-text" viewBox="0 0 24 24"><path d="M8 2v4M12 2v4M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6M8 14h8M8 18h5"/></svg><span>Reader</span>',
    openTab: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-arrow-up-right-icon lucide-arrow-up-right" viewBox="0 0 24 24"><path d="M7 7h10v10M7 17 17 7"/></svg>',
    close: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" class="lucide lucide-x-icon lucide-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };

  const EXCLUDED_HOSTS = [
    'docs.google.com',
    'mail.google.com',
    'drive.google.com',
    'accounts.google.com',
  ];

  // ---------------------------------------------------------------------------
  // Domain & URL helpers
  // ---------------------------------------------------------------------------

  function isExcluded() {
    try {
      const host = window.location.hostname.toLowerCase();
      return EXCLUDED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  }

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

  function getExpandedXUrl(a, fallbackUrl) {
    function toHttpUrl(candidate) {
      if (!candidate || typeof candidate !== 'string') return null;
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      try {
        const direct = new URL(trimmed);
        if (direct.protocol === 'http:' || direct.protocol === 'https:') return direct.href;
      } catch (_) {}
      if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
        try {
          return new URL('https://' + trimmed).href;
        } catch (_) {}
      }
      return null;
    }

    try {
      const host = window.location.hostname.toLowerCase();
      if (!(host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com'))) {
        return fallbackUrl;
      }
      const fallbackHost = new URL(fallbackUrl).hostname.toLowerCase();
      if (fallbackHost !== 't.co') return fallbackUrl;

      const candidates = [
        a.getAttribute('title'),
        a.getAttribute('data-expanded-url'),
        a.getAttribute('data-full-url'),
        a.getAttribute('aria-label'),
        a.textContent,
      ].filter(Boolean);
      for (const candidate of candidates) {
        const normalized = toHttpUrl(candidate);
        if (normalized) return normalized;
      }
      return fallbackUrl;
    } catch {
      return fallbackUrl;
    }
  }

  // ---------------------------------------------------------------------------
  // CSS, settings & lifecycle helpers
  // ---------------------------------------------------------------------------

  function loadExtensionCSS(path) {
    return fetch(chrome.runtime.getURL(path)).then((r) => r.text());
  }

  let cachedCssText = null;
  let cssLoadPromise = null;
  let currentPeekHost = null;
  let currentShadow = null;
  let escapeHandler = null;
  let currentPeekSessionId = 0;
  let nextPeekSessionId = 1;
  let suppressNextClick = false;
  let suppressedClickUrl = null;
  let scrollLockState = null;
  let currentLoaderRevealTimer = null;
  let currentFailureTimer = null;
  let urlCheckInterval = null;
  let cachedSettings = { ...DEFAULT_SETTINGS };
  let settingsListenerAttached = false;
  let focusTrapHandler = null;
  let readerHtml = null;
  let readerAvailable = false;
  let readerActive = false;

  function clearNavigationTimers() {
    if (currentLoaderRevealTimer) {
      clearTimeout(currentLoaderRevealTimer);
      currentLoaderRevealTimer = null;
    }
    if (currentFailureTimer) {
      clearTimeout(currentFailureTimer);
      currentFailureTimer = null;
    }
  }

  function ensureCssLoaded() {
    if (cachedCssText) return Promise.resolve(cachedCssText);
    if (!cssLoadPromise) {
      cssLoadPromise = Promise.all([
        loadExtensionCSS('styles/theme.css'),
        loadExtensionCSS('styles/peek.css'),
        loadExtensionCSS('styles/reader.css'),
      ]).then(([themeCss, peekCss, readerCss]) => {
        let readerCssText = readerCss || '';
        readerCssText = readerCssText.replaceAll('__EXTENSION_URL__', chrome.runtime.getURL(''));
        cachedCssText = (themeCss ? themeCss + '\n' : '') + (peekCss || FALLBACK_CSS) + '\n' + readerCssText;
        return cachedCssText;
      }).catch(() => {
        cachedCssText = FALLBACK_CSS;
        return cachedCssText;
      });
    }
    return cssLoadPromise;
  }

  function syncSettingsCache() {
    if (settingsListenerAttached) return;
    settingsListenerAttached = true;
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      if (chrome.runtime.lastError || !chrome.runtime?.id) return;
      cachedSettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
      };
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!(key in changes)) continue;
        cachedSettings[key] = changes[key].newValue;
      }
    });
  }

  function lockBackgroundScroll() {
    if (scrollLockState) return;
    scrollLockState = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
    };
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockBackgroundScroll() {
    if (!scrollLockState) return;
    document.body.style.overflow = scrollLockState.bodyOverflow;
    document.documentElement.style.overflow = scrollLockState.htmlOverflow;
    scrollLockState = null;
  }

  function isPreviewSameOrigin(previewUrl) {
    try {
      return new URL(previewUrl).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function removeStalePeekHost() {
    const stale = document.getElementById(PEEK_HOST_ID);
    if (stale && stale !== currentPeekHost) {
      try { stale.remove(); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Peek panel rendering
  // ---------------------------------------------------------------------------

  function closePeek() {
    if (!currentPeekHost) return;

    // Tell background to remove the header-stripping rule
    const sessionId = currentPeekSessionId;
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage({ type: 'peekEnd', sessionId }, () => {
        void chrome.runtime.lastError;
      });
    }
    currentPeekSessionId = 0;

    const backdrop = currentShadow && currentShadow.querySelector('.diablo-peek-backdrop');
    const panel = currentShadow && currentShadow.querySelector('.diablo-peek-panel');
    if (backdrop) backdrop.classList.add('diablo-peek-animating');
    if (panel) panel.classList.add('diablo-peek-animating');
    if (backdrop) backdrop.classList.add('diablo-peek-closing');
    if (panel) panel.classList.add('diablo-peek-closing');

    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    if (focusTrapHandler) {
      document.removeEventListener('keydown', focusTrapHandler, true);
      focusTrapHandler = null;
    }
    unlockBackgroundScroll();
    clearNavigationTimers();
    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }
    suppressNextClick = false;
    suppressedClickUrl = null;

    const hostToRemove = currentPeekHost;
    currentPeekHost = null;
    currentShadow = null;
    let removed = false;
    const removeHost = () => {
      if (removed) return;
      removed = true;
      try { hostToRemove.remove(); } catch (_) {}
    };
    const animatedNode = panel || backdrop;
    if (!animatedNode) {
      removeHost();
      return;
    }
    const fallbackTimer = setTimeout(removeHost, 200);
    animatedNode.addEventListener('animationend', () => {
      clearTimeout(fallbackTimer);
      removeHost();
    }, { once: true });
  }

  function openInNewTab(url) {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage({ type: 'openTab', url }, () => {
        void chrome.runtime.lastError;
      });
    }
    closePeek();
  }

  function resolveFinalPreviewUrl(url, aggressive) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'resolveFinalUrl', url, aggressive }, (response) => {
        if (chrome.runtime.lastError || !chrome.runtime?.id) {
          resolve(url);
          return;
        }
        const resolved = response && response.url;
        if (!resolved) {
          resolve(url);
          return;
        }
        try {
          const parsed = new URL(resolved);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            resolve(url);
            return;
          }
          resolve(parsed.href);
        } catch {
          resolve(url);
        }
      });
    });
  }

  async function showPeekPanel(url, sizePreset, aggressiveXUnshortenEnabled) {
    if (currentPeekHost) closePeek();
    const sessionId = nextPeekSessionId++;
    currentPeekSessionId = sessionId;
    readerHtml = null;
    readerAvailable = false;
    readerActive = false;

    // Wait for CSS before building DOM to avoid a flash of fallback styles.
    const cssText = await ensureCssLoaded();

    // Step 1: build shadow DOM panel immediately
    const host = document.createElement('div');
    host.id = PEEK_HOST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = cssText;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'diablo-peek-backdrop';
    backdrop.classList.add('diablo-peek-animating');
    backdrop.addEventListener('animationend', (e) => {
      if (e.animationName === 'diablo-peek-backdrop-in') {
        backdrop.classList.remove('diablo-peek-animating');
        backdrop.classList.add('diablo-peek-backdrop-blur-ready');
      }
      if (e.animationName === 'diablo-peek-backdrop-out') {
        backdrop.classList.remove('diablo-peek-animating');
      }
    });

    const panel = document.createElement('div');
    const panelSizeClass = PEEK_SIZE_CLASS[sizePreset] || PEEK_SIZE_CLASS.medium;
    panel.className = `diablo-peek-panel ${panelSizeClass}`;
    panel.classList.add('diablo-peek-animating');
    panel.addEventListener('animationend', (e) => {
      if (e.animationName === 'diablo-peek-panel-in' || e.animationName === 'diablo-peek-panel-out') {
        panel.classList.remove('diablo-peek-animating');
      }
    });

    // -- Top bar --
    const topbar = document.createElement('div');
    topbar.className = 'diablo-peek-topbar';

    const urlWrap = document.createElement('div');
    urlWrap.className = 'diablo-peek-url-wrap';

    const urlEl = document.createElement('div');
    urlEl.className = 'diablo-peek-url';
    urlEl.title = url;
    urlEl.textContent = url;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'diablo-peek-btn diablo-peek-btn-copy';
    copyBtn.innerHTML = ICONS.copy;
    copyBtn.title = 'Copy link';
    copyBtn.setAttribute('aria-label', 'Copy preview link');

    urlWrap.append(urlEl, copyBtn);

    let currentDisplayUrl = url;
    let canGoForward = false;
    let navHistory = [];
    let navIndex = 0;
    let isProgrammaticNav = false;
    let initialLoadProcessed = false;
    let lastCheckedUrl = null;

    function updateNavButtons(canGoBack) {
      backBtn.disabled = !canGoBack;
      forwardBtn.disabled = !canGoForward;
    }

    function hideFallback() {
      fallback.style.display = 'none';
    }

    function showFallback() {
      loader.style.display = 'none';
      iframe.style.display = 'none';
      fallback.style.display = 'flex';
      updateNavButtons(false);
    }

    function setLoadingState() {
      loader.style.display = 'flex';
      hideFallback();
      iframe.style.display = 'none';
      clearNavigationTimers();
      isProgrammaticNav = false;
      currentLoaderRevealTimer = setTimeout(() => {
        // If no load fires (common on blocked history moves), restore visible iframe.
        loader.style.display = 'none';
        iframe.style.display = 'block';
      }, 1200);
      currentFailureTimer = setTimeout(() => {
        // Show a fallback if the frame never reports load.
        showFallback();
      }, 6500);
    }

    function getFrameUrl() {
      try {
        const maybeUrl = iframe.contentWindow && iframe.contentWindow.location && iframe.contentWindow.location.href;
        if (maybeUrl) {
          const parsed = new URL(maybeUrl);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
        }
      } catch (_) {}
      try {
        const fallback = new URL(iframe.src);
        if (fallback.protocol === 'http:' || fallback.protocol === 'https:') return fallback.href;
      } catch (_) {}
      return currentDisplayUrl;
    }

    function detectBackAvailability() {
      return navIndex > 0;
    }

    function startUrlCheck() {
      if (urlCheckInterval) clearInterval(urlCheckInterval);
      lastCheckedUrl = navHistory[navIndex] || null;
      urlCheckInterval = setInterval(() => {
        if (!currentPeekHost || currentPeekSessionId !== sessionId) {
          clearInterval(urlCheckInterval);
          urlCheckInterval = null;
          return;
        }
        try {
          const cw = iframe.contentWindow;
          if (!cw || !cw.location) return;
          const href = cw.location.href;
          if (href && href !== lastCheckedUrl) {
            if (isProgrammaticNav) {
              // Programmatic back/forward/refresh in flight — the
              // load handler will take care of state when it completes.
              return;
            }
            const parsed = new URL(href);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              navHistory = navHistory.slice(0, navIndex + 1);
              navHistory.push(parsed.href);
              navIndex = navHistory.length - 1;
              lastCheckedUrl = parsed.href;
              currentDisplayUrl = parsed.href;
              urlEl.title = currentDisplayUrl;
              urlEl.textContent = currentDisplayUrl;
              canGoForward = navIndex < navHistory.length - 1 && navHistory[navIndex + 1] !== navHistory[navIndex];
              updateNavButtons(navIndex > 0);
            }
          }
        } catch (_) {
          // Cross-origin or inaccessible; can't poll
        }
      }, 500);
    }

    function trapFocus(event) {
      if (event.key !== 'Tab' || currentPeekSessionId !== sessionId) return;
      const focusables = [backBtn, forwardBtn, refreshBtn, copyBtn, readerBtn, openTabBtn, closeBtn]
        .filter((el) => el && !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = shadow.activeElement || document.activeElement;
      const insideShadow = active && focusables.includes(active);
      if (!insideShadow) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const backBtn = document.createElement('button');
    backBtn.className = 'diablo-peek-btn';
    backBtn.innerHTML = ICONS.back;
    backBtn.title = 'Back';
    backBtn.setAttribute('aria-label', 'Go back in preview');
    backBtn.disabled = true;

    const forwardBtn = document.createElement('button');
    forwardBtn.className = 'diablo-peek-btn';
    forwardBtn.innerHTML = ICONS.forward;
    forwardBtn.title = 'Forward';
    forwardBtn.setAttribute('aria-label', 'Go forward in preview');
    forwardBtn.disabled = true;

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'diablo-peek-btn';
    refreshBtn.innerHTML = ICONS.refresh;
    refreshBtn.title = 'Refresh';
    refreshBtn.setAttribute('aria-label', 'Refresh preview');

    const readerBtn = document.createElement('button');
    readerBtn.className = 'diablo-peek-btn diablo-peek-btn-reader';
    readerBtn.innerHTML = ICONS.reader;
    readerBtn.title = 'Reader';
    readerBtn.setAttribute('aria-label', 'Toggle reader mode');
    readerBtn.setAttribute('aria-pressed', 'false');
    readerBtn.disabled = true;

    const openTabBtn = document.createElement('button');
    openTabBtn.className = 'diablo-peek-btn';
    openTabBtn.innerHTML = ICONS.openTab;
    openTabBtn.title = 'Open in new tab';
    openTabBtn.setAttribute('aria-label', 'Open in new tab');
    openTabBtn.addEventListener('click', () => openInNewTab(currentDisplayUrl));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'diablo-peek-btn diablo-peek-btn-close';
    closeBtn.innerHTML = ICONS.close;
    closeBtn.title = 'Close (Escape)';
    closeBtn.setAttribute('aria-label', 'Close peek panel. Press Escape to close.');
    closeBtn.addEventListener('click', closePeek);

    const leftActions = document.createElement('div');
    leftActions.className = 'diablo-peek-actions';
    leftActions.append(backBtn, forwardBtn, refreshBtn);

    const rightActions = document.createElement('div');
    rightActions.className = 'diablo-peek-actions';
    rightActions.append(readerBtn, openTabBtn, closeBtn);

    topbar.append(leftActions, urlWrap, rightActions);

    // -- Iframe --
    const frameWrap = document.createElement('div');
    frameWrap.className = 'diablo-peek-frame-wrap';

    const loader = document.createElement('div');
    loader.className = 'diablo-peek-loader';
    loader.innerHTML = '<div class="diablo-peek-spinner"></div><p>Loading preview\u2026</p>';

    const fallback = document.createElement('div');
    fallback.className = 'diablo-peek-fallback';
    fallback.style.display = 'none';
    fallback.innerHTML = '<p>This site can\'t be previewed safely here.</p>';
    const fallbackOpenBtn = document.createElement('button');
    fallbackOpenBtn.className = 'diablo-peek-btn';
    fallbackOpenBtn.textContent = 'Open in new tab';
    fallbackOpenBtn.addEventListener('click', () => openInNewTab(currentDisplayUrl));
    fallback.appendChild(fallbackOpenBtn);

    const readerView = document.createElement('div');
    readerView.className = 'diablo-reader-view';
    readerView.style.display = 'none';

    const readerToolbar = document.createElement('div');
    readerToolbar.className = 'diablo-reader-toolbar';

    const themes = [
      { value: 'paper', label: 'Paper' },
      { value: 'dusk', label: 'Dusk' },
      { value: 'ink', label: 'Ink' },
    ];
    const themeButtons = {};
    themes.forEach(({ value, label }) => {
      const btn = document.createElement('button');
      btn.className = 'diablo-reader-theme-btn';
      btn.textContent = label;
      btn.setAttribute('aria-pressed', cachedSettings.readerTheme === value ? 'true' : 'false');
      btn.addEventListener('click', () => setReaderTheme(value));
      themeButtons[value] = btn;
      readerToolbar.appendChild(btn);
    });

    const readerContent = document.createElement('div');
    readerContent.className = 'diablo-reader-content';

    readerView.append(readerToolbar, readerContent);
    frameWrap.appendChild(readerView);

    const iframe = document.createElement('iframe');
    iframe.className = 'diablo-peek-frame';
    iframe.style.display = 'none';
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

    // Show iframe once loaded, hide spinner
    iframe.addEventListener('load', () => {
      clearNavigationTimers();
      hideFallback();
      loader.style.display = 'none';
      iframe.style.display = 'block';

      // Try to read the actual URL directly from the iframe
      let loadedUrl = null;
      try {
        loadedUrl = iframe.contentWindow.location.href;
      } catch (_) {
        // Cross-origin or other error, fall back to getFrameUrl()
        loadedUrl = getFrameUrl();
      }
      if (isProgrammaticNav) {
        isProgrammaticNav = false;
      } else if (!initialLoadProcessed) {
        initialLoadProcessed = true;
      } else if (loadedUrl !== navHistory[navIndex]) {
        navHistory = navHistory.slice(0, navIndex + 1);
        navHistory.push(loadedUrl);
        navIndex = navHistory.length - 1;
      } else {
        // loadedUrl === navHistory[navIndex]
        // This can happen when:
        // 1. Cross-origin navigation: getFrameUrl() fell back to iframe.src
        // 2. Polling already pushed the same URL
        // 3. User navigated to the same page
        // Only push for cross-origin (case 1) to enable back button.
        let isCrossOrigin = false;
        try {
          const cw = iframe.contentWindow;
          if (!cw || !cw.location || !cw.location.href) {
            isCrossOrigin = true;
          }
        } catch (_) {
          isCrossOrigin = true;
        }

        if (isCrossOrigin) {
          navHistory = navHistory.slice(0, navIndex + 1);
          navHistory.push(loadedUrl);
          navIndex = navHistory.length - 1;
        }
      }
      currentDisplayUrl = loadedUrl;
      urlEl.title = currentDisplayUrl;
      urlEl.textContent = currentDisplayUrl;
      lastCheckedUrl = loadedUrl;
      canGoForward = navIndex < navHistory.length - 1 && navHistory[navIndex + 1] !== navHistory[navIndex];
      updateNavButtons(navIndex > 0);
    });
    iframe.addEventListener('error', showFallback);

    backBtn.addEventListener('click', () => {
      if (navIndex > 0) {
        setLoadingState();
        navIndex--;
        isProgrammaticNav = true;
        iframe.src = navHistory[navIndex];
        canGoForward = true;
        updateNavButtons(navIndex > 0);
      }
    });

    forwardBtn.addEventListener('click', () => {
      const nextIdx = navIndex + 1;
      if (nextIdx < navHistory.length && navHistory[nextIdx] !== navHistory[navIndex]) {
        setLoadingState();
        navIndex = nextIdx;
        isProgrammaticNav = true;
        iframe.src = navHistory[navIndex];
        canGoForward = navIndex < navHistory.length - 1 && navHistory[navIndex + 1] !== navHistory[navIndex];
        updateNavButtons(navIndex > 0);
      }
    });

    refreshBtn.addEventListener('click', () => {
      setLoadingState();
      isProgrammaticNav = true;
      try {
        if (iframe.contentWindow && iframe.contentWindow.location) {
          iframe.contentWindow.location.reload();
          return;
        }
      } catch (_) {}
      iframe.src = currentDisplayUrl;
      canGoForward = false;
      updateNavButtons(false);
    });
    copyBtn.addEventListener('click', async () => {
      const value = currentDisplayUrl;
      let copied = false;
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch (_) {}
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          copied = document.execCommand('copy');
          ta.remove();
        } catch (_) {}
      }
      const original = copyBtn.innerHTML;
      copyBtn.innerHTML = copied ? 'Copied' : 'Copy failed';
      setTimeout(() => {
        if (copyBtn.isConnected) copyBtn.innerHTML = original;
      }, 900);
    });
    frameWrap.append(loader, fallback, iframe);
    panel.append(topbar, frameWrap);
    backdrop.appendChild(panel);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePeek();
    });

    shadow.appendChild(backdrop);
    document.body.appendChild(host);
    lockBackgroundScroll();
    currentPeekHost = host;
    currentShadow = shadow;

    escapeHandler = (e) => {
      if (e.key === 'Escape') closePeek();
    };
    document.addEventListener('keydown', escapeHandler);
    focusTrapHandler = trapFocus;
    document.addEventListener('keydown', focusTrapHandler, true);
    closeBtn.focus();

    function setReaderTheme(value) {
      cachedSettings.readerTheme = value;
      panel.dataset.readerTheme = value;
      Object.entries(themeButtons).forEach(([v, btn]) => {
        btn.setAttribute('aria-pressed', v === value ? 'true' : 'false');
      });
      if (chrome.runtime?.id) {
        chrome.storage.sync.set({ readerTheme: value });
      }
    }

    function toggleReader() {
      if (!readerAvailable || !readerHtml) return;
      readerActive = !readerActive;

      readerBtn.setAttribute('aria-pressed', readerActive ? 'true' : 'false');
      readerBtn.classList.toggle('diablo-peek-btn-reader-active', readerActive);

      if (readerActive) {
        iframe.style.display = 'none';
        loader.style.display = 'none';
        fallback.style.display = 'none';
        readerView.style.display = 'block';
      } else {
        readerView.style.display = 'none';
        iframe.style.display = 'block';
      }
    }

    readerBtn.addEventListener('click', toggleReader);

    async function fetchAndParseReader(url, forSessionId) {
    readerBtn.innerHTML = '...';
    readerBtn.disabled = true;

      let response;
      try {
        response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'fetchForReader', url }, resolve);
        });
      } catch {
        readerBtn.style.display = 'none';
        return;
      }

      if (currentPeekSessionId !== forSessionId) return;

      if (!response || !response.ok) {
        readerBtn.style.display = 'none';
        return;
      }

      let article;
      try {
        const doc = new DOMParser().parseFromString(response.html, 'text/html');
        const base = doc.createElement('base');
        base.href = response.finalUrl;
        doc.head.prepend(base);
        const reader = new Readability(doc);
        article = reader.parse();
      } catch {
        readerBtn.style.display = 'none';
        return;
      }

      if (!article || !article.content) {
        readerBtn.style.display = 'none';
        return;
      }

      readerHtml = article;
      readerAvailable = true;
      readerBtn.innerHTML = ICONS.reader;
      readerBtn.disabled = false;

      const titleEl = document.createElement('h1');
      titleEl.textContent = article.title || '';

      const bylineEl = document.createElement('p');
      bylineEl.className = 'diablo-reader-byline';
      bylineEl.textContent = article.byline || '';
      bylineEl.style.display = article.byline ? '' : 'none';

      const bodyEl = document.createElement('div');
      bodyEl.className = 'diablo-reader-body';
      bodyEl.innerHTML = article.content;

      readerContent.append(titleEl, bylineEl, bodyEl);
    }

    setReaderTheme(cachedSettings.readerTheme);

    // Step 2: resolve URL first, then scope frame header stripping to that domain.
    const resolvedUrl = await resolveFinalPreviewUrl(url, aggressiveXUnshortenEnabled === true);
    await new Promise((resolve) => {
      if (!chrome.runtime?.id) {
        resolve();
        return;
      }
      chrome.runtime.sendMessage({ type: 'peekStart', sessionId, url: resolvedUrl }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
    if (currentPeekSessionId !== sessionId) {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: 'peekEnd', sessionId }, () => {
          void chrome.runtime.lastError;
        });
      }
      return;
    }

    navHistory = [resolvedUrl];
    navIndex = 0;
    isProgrammaticNav = false;

    currentDisplayUrl = resolvedUrl;
    urlEl.title = currentDisplayUrl;
    urlEl.textContent = currentDisplayUrl;
    canGoForward = false;
    updateNavButtons(false);
    setLoadingState();

    // Step 3: set iframe src -- X-Frame-Options already stripped by background rule.
    iframe.src = resolvedUrl;

    // Poll the iframe URL so back/forward buttons can track navigation —
    // catches SPA / hash nav that doesn't fire a load event, and recovers
    // when getFrameUrl() falls back to stale iframe.src.  The polling code
    // already handles cross-origin errors gracefully, so we poll for all
    // previews regardless of same-origin status.
    startUrlCheck();

    // Fire and forget — populates reader mode when ready
    fetchAndParseReader(resolvedUrl, sessionId);
  }

  // ---------------------------------------------------------------------------
  // Event handlers & bootstrap
  // ---------------------------------------------------------------------------

  function tryOpenPeek(e, fromMouseDown) {
    if (!e.shiftKey || (typeof e.button === 'number' && e.button !== 0)) return;
    const a = findAnchor(e);
    if (!a) return;
    const url = getLinkUrl(a);
    if (!url) return;
    const previewUrl = getExpandedXUrl(a, url);

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (fromMouseDown) {
      suppressNextClick = true;
      suppressedClickUrl = previewUrl;
    }
    if (!cachedSettings.peekEnabled) return;
    if (isExcluded()) return;
    showPeekPanel(previewUrl, cachedSettings.peekSizePreset, cachedSettings.aggressiveXUnshortenEnabled);
  }

  function handleMouseDown(e) {
    tryOpenPeek(e, true);
  }

  function handleClick(e) {
    if (suppressNextClick) {
      suppressNextClick = false;
      const clickAnchor = findAnchor(e);
      const clickUrl = getLinkUrl(clickAnchor);
      const shouldSuppress = Boolean(suppressedClickUrl && clickUrl && clickUrl === suppressedClickUrl);
      suppressedClickUrl = null;
      if (shouldSuppress) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    tryOpenPeek(e, false);
  }

  document.addEventListener('mousedown', handleMouseDown, true);
  document.addEventListener('click', handleClick, true);
  syncSettingsCache();
  ensureCssLoaded();

  // Clean up any orphaned peek host if the extension reloads or page navigates.
  window.addEventListener('beforeunload', () => {
    if (currentPeekHost) {
      try { currentPeekHost.remove(); } catch (_) {}
    }
  });
  // Safety sweep for stale hosts left behind by unexpected termination.
  setInterval(removeStalePeekHost, 30000);
})();
