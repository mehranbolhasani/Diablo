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
 */

(function () {
  const PEEK_HOST_ID = 'diablo-peek-host';
  const PEEK_SIZE_CLASS = {
    small: 'diablo-peek-size-small',
    medium: 'diablo-peek-size-medium',
    large: 'diablo-peek-size-large',
  };

  const EXCLUDED_HOSTS = [
    'docs.google.com',
    'mail.google.com',
    'drive.google.com',
    'accounts.google.com',
  ];

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

  function loadExtensionCSS(path) {
    return fetch(chrome.runtime.getURL(path)).then((r) => r.text());
  }

  let currentPeekHost = null;
  let currentShadow = null;
  let escapeHandler = null;
  let currentPeekSessionId = 0;
  let nextPeekSessionId = 1;
  let suppressNextClick = false;
  let scrollLockState = null;

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

  function closePeek() {
    if (!currentPeekHost) return;

    // Tell background to remove the header-stripping rule
    const sessionId = currentPeekSessionId;
    chrome.runtime.sendMessage({ type: 'peekEnd', sessionId });
    currentPeekSessionId = 0;

    const backdrop = currentShadow && currentShadow.querySelector('.diablo-peek-backdrop');
    const panel = currentShadow && currentShadow.querySelector('.diablo-peek-panel');
    if (backdrop) backdrop.classList.add('diablo-peek-closing');
    if (panel) panel.classList.add('diablo-peek-closing');

    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    unlockBackgroundScroll();

    const hostToRemove = currentPeekHost;
    currentPeekHost = null;
    currentShadow = null;

    setTimeout(() => {
      try { hostToRemove.remove(); } catch (_) {}
    }, 160);
  }

  function openInNewTab(url) {
    chrome.runtime.sendMessage({ type: 'openTab', url });
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
    const resolvedUrl = await resolveFinalPreviewUrl(url, aggressiveXUnshortenEnabled === true);
    if (currentPeekSessionId !== sessionId) return;

    // Step 1: tell background to strip X-Frame-Options / CSP for this tab
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'peekStart', sessionId }, resolve);
    });
    if (currentPeekSessionId !== sessionId) {
      chrome.runtime.sendMessage({ type: 'peekEnd', sessionId });
      return;
    }

    // Step 2: load theme + peek CSS
    let themeCss = '';
    let peekCss = '';
    try {
      [themeCss, peekCss] = await Promise.all([
        loadExtensionCSS('styles/theme.css'),
        loadExtensionCSS('styles/peek.css'),
      ]);
    } catch (_) {}
    if (currentPeekSessionId !== sessionId) {
      chrome.runtime.sendMessage({ type: 'peekEnd', sessionId });
      return;
    }
    const cssText = (themeCss ? themeCss + '\n' : '') + (peekCss || FALLBACK_CSS);

    // Step 3: build shadow DOM panel
    const host = document.createElement('div');
    host.id = PEEK_HOST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = cssText;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'diablo-peek-backdrop';

    const panel = document.createElement('div');
    const panelSizeClass = PEEK_SIZE_CLASS[sizePreset] || PEEK_SIZE_CLASS.medium;
    panel.className = `diablo-peek-panel ${panelSizeClass}`;

    // -- Top bar --
    const topbar = document.createElement('div');
    topbar.className = 'diablo-peek-topbar';

    const urlEl = document.createElement('div');
    urlEl.className = 'diablo-peek-url';
    urlEl.title = resolvedUrl;
    urlEl.textContent = resolvedUrl;

    let currentDisplayUrl = resolvedUrl;
    let navigationTimer = null;

    function setLoadingState() {
      loader.style.display = 'flex';
      iframe.style.display = 'none';
      if (navigationTimer) clearTimeout(navigationTimer);
      navigationTimer = setTimeout(() => {
        // If no load fires (common on blocked history moves), restore visible iframe.
        loader.style.display = 'none';
        iframe.style.display = 'block';
      }, 1200);
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

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'diablo-peek-btn';
    refreshBtn.textContent = '\u21bb';
    refreshBtn.title = 'Refresh';
    refreshBtn.setAttribute('aria-label', 'Refresh preview');

    const copyBtn = document.createElement('button');
    copyBtn.className = 'diablo-peek-btn';
    copyBtn.textContent = 'Copy link';
    copyBtn.setAttribute('aria-label', 'Copy preview link');

    const openTabBtn = document.createElement('button');
    openTabBtn.className = 'diablo-peek-btn';
    openTabBtn.textContent = 'Open in new tab';
    openTabBtn.addEventListener('click', () => openInNewTab(currentDisplayUrl));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'diablo-peek-btn diablo-peek-btn-close';
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close peek panel');
    closeBtn.addEventListener('click', closePeek);

    const actionGroup = document.createElement('div');
    actionGroup.className = 'diablo-peek-actions';
    actionGroup.append(refreshBtn, copyBtn, openTabBtn, closeBtn);

    topbar.append(urlEl, actionGroup);

    // -- Iframe --
    const frameWrap = document.createElement('div');
    frameWrap.className = 'diablo-peek-frame-wrap';

    const loader = document.createElement('div');
    loader.className = 'diablo-peek-loader';
    loader.innerHTML = '<div class="diablo-peek-spinner"></div><p>Loading preview\u2026</p>';

    const iframe = document.createElement('iframe');
    iframe.className = 'diablo-peek-frame';
    iframe.style.display = 'none';

    // Show iframe once loaded, hide spinner
    iframe.addEventListener('load', () => {
      if (navigationTimer) {
        clearTimeout(navigationTimer);
        navigationTimer = null;
      }
      loader.style.display = 'none';
      iframe.style.display = 'block';
      const loadedUrl = getFrameUrl();
      currentDisplayUrl = loadedUrl;
      urlEl.title = currentDisplayUrl;
      urlEl.textContent = currentDisplayUrl;
    });

    refreshBtn.addEventListener('click', () => {
      setLoadingState();
      try {
        if (iframe.contentWindow && iframe.contentWindow.location) {
          iframe.contentWindow.location.reload();
          return;
        }
      } catch (_) {}
      iframe.src = currentDisplayUrl;
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
      const original = copyBtn.textContent;
      copyBtn.textContent = copied ? 'Copied' : 'Copy failed';
      setTimeout(() => {
        if (copyBtn.isConnected) copyBtn.textContent = original;
      }, 900);
    });

    frameWrap.append(loader, iframe);
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

    // Step 4: set iframe src -- X-Frame-Options already stripped by background rule
    iframe.src = resolvedUrl;
  }

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

    if (fromMouseDown) suppressNextClick = true;

    chrome.storage.sync.get({ peekEnabled: true, peekSizePreset: 'medium', aggressiveXUnshortenEnabled: false }, (stored) => {
      if (chrome.runtime.lastError || !chrome.runtime?.id) return;
      if (!stored.peekEnabled) return;
      if (isExcluded()) return;
      showPeekPanel(previewUrl, stored.peekSizePreset, stored.aggressiveXUnshortenEnabled);
    });
  }

  function handleMouseDown(e) {
    tryOpenPeek(e, true);
  }

  function handleClick(e) {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    tryOpenPeek(e, false);
  }

  document.addEventListener('mousedown', handleMouseDown, true);
  document.addEventListener('click', handleClick, true);

  const FALLBACK_CSS = `
    .diablo-peek-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647}
    .diablo-peek-panel{width:80vw;height:80vh;max-width:1200px;max-height:800px;background:#1a1a1a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
    .diablo-peek-topbar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#252525}
    .diablo-peek-actions{display:flex;align-items:center;gap:6px}
    .diablo-peek-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a0a0a0;font-size:13px}
    .diablo-peek-btn{padding:6px 10px;border:none;border-radius:6px;cursor:pointer;background:#333;color:#e0e0e0;white-space:nowrap}
    .diablo-peek-btn-close{padding:6px 10px;background:transparent;color:#888;font-size:16px}
    .diablo-peek-frame-wrap{flex:1;min-height:0;position:relative}
    .diablo-peek-frame{width:100%;height:100%;border:none;background:#fff}
    .diablo-peek-loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#888;background:#1a1a1a}
    .diablo-peek-spinner{width:32px;height:32px;border:3px solid #333;border-top-color:#888;border-radius:50%;animation:s .7s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
  `;
})();
