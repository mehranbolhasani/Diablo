/**
 * Diablo Hover Preview - Link metadata tooltip after ~400ms hover
 *
 * Uses mouseover/mouseout (which bubble, unlike mouseenter/mouseleave)
 * for event delegation on all links.
 * Fetches metadata via background script, caches in memory.
 * Positions tooltip near cursor, clamped to viewport.
 */

(function () {
  const HOVER_DELAY_MS = 400;
  const PREVIEW_HOST_ID = 'diablo-preview-host';
  const CACHE_MAX = 100;

  const localCache = new Map();

  let hoverTimer = null;
  let currentHost = null;
  let currentLink = null;
  let escapeHandler = null;
  let scrollHandler = null;

  function loadExtensionCSS(path) {
    const url = chrome.runtime.getURL(path);
    return fetch(url).then((r) => r.text());
  }

  /**
   * Walk from event target up to find an anchor. Handles text nodes and
   * elements that may not support closest().
   */
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

  function hidePreview() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    currentLink = null;
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
    if (scrollHandler) {
      document.removeEventListener('scroll', scrollHandler, true);
      scrollHandler = null;
    }
    if (currentHost) {
      currentHost.remove();
      currentHost = null;
    }
  }

  function clampPosition(x, y, cardWidth, cardHeight) {
    const pad = 12;
    let left = x + pad;
    let top = y + pad;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (left + cardWidth > w - pad) left = w - cardWidth - pad;
    if (left < pad) left = pad;
    if (top + cardHeight > h - pad) top = h - cardHeight - pad;
    if (top < pad) top = pad;
    return { left, top };
  }

  function fetchMeta(url) {
    if (localCache.has(url)) {
      return Promise.resolve(localCache.get(url));
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'fetchMetadata', url }, (meta) => {
        if (chrome.runtime.lastError || !chrome.runtime?.id) {
          resolve({ title: '', description: '', domain: '' });
          return;
        }
        if (meta && (meta.title || meta.domain)) {
          if (localCache.size >= CACHE_MAX) {
            const first = localCache.keys().next().value;
            localCache.delete(first);
          }
          localCache.set(url, meta);
          resolve(meta);
        } else {
          try {
            const domain = new URL(url).hostname;
            resolve({ title: domain, description: '', domain });
          } catch {
            resolve({ title: url, description: '', domain: url });
          }
        }
      });
    });
  }

  async function showPreview(url, clientX, clientY) {
    hidePreview();

    let themeCss = '';
    let previewCss = '';
    try {
      [themeCss, previewCss] = await Promise.all([
        loadExtensionCSS('styles/theme.css'),
        loadExtensionCSS('styles/preview.css'),
      ]);
    } catch (_) {}
    const fallback =
      '.diablo-preview-card{max-width:320px;padding:12px 14px;background:#1a1a1a;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.4);border:1px solid #333}.diablo-preview-title{font-size:14px;font-weight:600;color:#e0e0e0;margin:0 0 4px}.diablo-preview-domain{font-size:12px;color:#888;margin:0 0 4px}.diablo-preview-url{font-size:11px;color:#666;margin:0;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    const cssText = (themeCss ? themeCss + '\n' : '') + (previewCss || fallback);

    const host = document.createElement('div');
    host.id = PREVIEW_HOST_ID;
    // Position fixed so it doesn't shift with scroll, pointer-events none so it doesn't steal focus
    host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = cssText;
    shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'diablo-preview-card diablo-preview-skeleton';

    const titleEl = document.createElement('p');
    titleEl.className = 'diablo-preview-title';
    titleEl.textContent = 'Loading\u2026';

    const domainEl = document.createElement('p');
    domainEl.className = 'diablo-preview-domain';
    domainEl.textContent = '\u00A0';

    const urlEl = document.createElement('p');
    urlEl.className = 'diablo-preview-url';
    urlEl.textContent = url;

    card.append(titleEl, domainEl, urlEl);
    shadow.appendChild(card);
    document.body.appendChild(host);
    currentHost = host;

    const { left, top } = clampPosition(clientX, clientY, 320, 100);
    host.style.left = left + 'px';
    host.style.top = top + 'px';

    escapeHandler = (e) => {
      if (e.key === 'Escape') hidePreview();
    };
    document.addEventListener('keydown', escapeHandler);

    scrollHandler = () => hidePreview();
    document.addEventListener('scroll', scrollHandler, { passive: true, capture: true });

    fetchMeta(url).then((meta) => {
      if (!currentHost || currentHost !== host) return;
      card.classList.remove('diablo-preview-skeleton');
      try {
        titleEl.textContent = meta.title || new URL(url).hostname;
        domainEl.textContent = meta.domain || new URL(url).hostname;
      } catch {
        titleEl.textContent = meta.title || url;
        domainEl.textContent = meta.domain || url;
      }
      urlEl.textContent = url;
    });
  }

  // --- Event handlers using mouseover/mouseout (these bubble, unlike mouseenter/mouseleave) ---

  function handleMouseOver(e) {
    const a = findAnchor(e);
    if (!a) return;

    // If we're already tracking this link, don't restart
    if (a === currentLink) return;

    const url = getLinkUrl(a);
    if (!url) return;

    // Clear any pending timer from a previous link
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hidePreview();

    chrome.storage.sync.get({ hoverPreviewEnabled: true }, (stored) => {
      if (chrome.runtime.lastError || !chrome.runtime?.id) return;
      if (!stored.hoverPreviewEnabled) return;
      currentLink = a;
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        showPreview(url, e.clientX, e.clientY);
      }, HOVER_DELAY_MS);
    });
  }

  function handleMouseOut(e) {
    if (!currentLink) return;
    const a = findAnchor(e);

    // relatedTarget is where the mouse went TO. If it's still inside the same link, ignore.
    let rt = e.relatedTarget;
    if (rt && rt.nodeType === Node.TEXT_NODE) rt = rt.parentElement;
    if (rt && typeof rt.closest === 'function') {
      const stillInLink = rt.closest('a[href]');
      if (stillInLink === currentLink) return;
    }

    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    currentLink = null;
    hidePreview();
  }

  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
})();
