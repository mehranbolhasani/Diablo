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

  function loadExtensionCSS(path) {
    return fetch(chrome.runtime.getURL(path)).then((r) => r.text());
  }

  let currentPeekHost = null;
  let currentShadow = null;
  let escapeHandler = null;

  function closePeek() {
    if (!currentPeekHost) return;

    // Tell background to remove the header-stripping rule
    chrome.runtime.sendMessage({ type: 'peekEnd' });

    const backdrop = currentShadow && currentShadow.querySelector('.diablo-peek-backdrop');
    const panel = currentShadow && currentShadow.querySelector('.diablo-peek-panel');
    if (backdrop) backdrop.classList.add('diablo-peek-closing');
    if (panel) panel.classList.add('diablo-peek-closing');

    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }

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

  async function showPeekPanel(url) {
    if (currentPeekHost) closePeek();

    // Step 1: tell background to strip X-Frame-Options / CSP for this tab
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'peekStart' }, resolve);
    });

    // Step 2: load theme + peek CSS
    let themeCss = '';
    let peekCss = '';
    try {
      [themeCss, peekCss] = await Promise.all([
        loadExtensionCSS('styles/theme.css'),
        loadExtensionCSS('styles/peek.css'),
      ]);
    } catch (_) {}
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
    panel.className = 'diablo-peek-panel';

    // -- Top bar --
    const topbar = document.createElement('div');
    topbar.className = 'diablo-peek-topbar';

    const urlEl = document.createElement('div');
    urlEl.className = 'diablo-peek-url';
    urlEl.title = url;
    urlEl.textContent = url;

    const openTabBtn = document.createElement('button');
    openTabBtn.className = 'diablo-peek-btn';
    openTabBtn.textContent = 'Open in new tab';
    openTabBtn.addEventListener('click', () => openInNewTab(url));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'diablo-peek-btn diablo-peek-btn-close';
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close peek panel');
    closeBtn.addEventListener('click', closePeek);

    topbar.append(urlEl, openTabBtn, closeBtn);

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
      loader.style.display = 'none';
      iframe.style.display = 'block';
    });

    frameWrap.append(loader, iframe);
    panel.append(topbar, frameWrap);
    backdrop.appendChild(panel);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePeek();
    });

    shadow.appendChild(backdrop);
    document.body.appendChild(host);
    currentPeekHost = host;
    currentShadow = shadow;

    escapeHandler = (e) => {
      if (e.key === 'Escape') closePeek();
    };
    document.addEventListener('keydown', escapeHandler);

    // Step 4: set iframe src -- X-Frame-Options already stripped by background rule
    iframe.src = url;
  }

  function handleClick(e) {
    if (!e.shiftKey) return;
    const a = findAnchor(e);
    if (!a) return;
    const url = getLinkUrl(a);
    if (!url) return;

    e.preventDefault();
    e.stopPropagation();

    chrome.storage.sync.get({ peekEnabled: true }, (stored) => {
      if (chrome.runtime.lastError || !chrome.runtime?.id) return;
      if (!stored.peekEnabled) return;
      if (isExcluded()) return;
      showPeekPanel(url);
    });
  }

  document.addEventListener('click', handleClick, true);

  const FALLBACK_CSS = `
    .diablo-peek-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647}
    .diablo-peek-panel{width:80vw;height:80vh;max-width:1200px;max-height:800px;background:#1a1a1a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
    .diablo-peek-topbar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#252525}
    .diablo-peek-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a0a0a0;font-size:13px}
    .diablo-peek-btn{padding:6px 12px;border:none;border-radius:6px;cursor:pointer;background:#333;color:#e0e0e0}
    .diablo-peek-btn-close{padding:6px 10px;background:transparent;color:#888;font-size:16px}
    .diablo-peek-frame-wrap{flex:1;min-height:0;position:relative}
    .diablo-peek-frame{width:100%;height:100%;border:none;background:#fff}
    .diablo-peek-loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#888;background:#1a1a1a}
    .diablo-peek-spinner{width:32px;height:32px;border:3px solid #333;border-top-color:#888;border-radius:50%;animation:s .7s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
  `;
})();
