# AGENTS.md – Diablo

Chrome Extension (Manifest V3). Vanilla JS/CSS/HTML — no build system, no package manager, no tests.

## Developer workflow

- **Load unpacked in Chrome:** point to the `extension/` folder (not the repo root).
- **No build step:** edit source files and reload the extension in `chrome://extensions`.
- **No automated tests:** verify manually on real pages after changes.
- **Store bundle:** `diablo-cws-1.0.0.zip` is the Chrome Web Store submission artifact. Regenerate it from the `extension/` directory before upload (exclude `diablo-assets`).

## Architecture

- `extension/manifest.json` — Manifest V3. Declares service worker, content script, popup, and `web_accessible_resources`.
- `extension/background.js` — Service worker. Manages `chrome.declarativeNetRequest` session rules (strips `X-Frame-Options` and CSP for `sub_frame`), URL resolution (including aggressive `t.co` unshortening via temporary tabs), and message routing.
- `extension/content/peek.js` — Content script injected into all pages. Listens for `Shift+Click`, builds a **closed Shadow DOM** peek panel with an `<iframe>`, handles focus trapping, keyboard (Escape), and back/forward/refresh/copy/open-tab actions.
- `extension/ui/popup.{html,js,css}` — Extension popup for settings.
- `extension/shared/constants.js` — Shared default settings. Loaded via `<script>` in content/popup and `importScripts()` in the service worker.
- `extension/styles/{theme,peek}.css` — Styles injected into the shadow DOM at runtime.

## Critical conventions

- **`shared/constants.js` must stay compatible with both classic `<script>` and `importScripts()`** — no ES modules, no DOM APIs. It writes to `globalThis`.
- **Settings defaults live in multiple places.** `shared/constants.js` is the source of truth, but inline fallbacks exist in `background.js`, `peek.js`, and `popup.js`. When adding a new setting, update all four locations.
- **CSS is fetched at runtime** for the shadow DOM (`fetch(chrome.runtime.getURL(...))`). Both `styles/theme.css` and `styles/peek.css` must remain listed in `web_accessible_resources`. `peek.js` contains an inline `FALLBACK_CSS`; keep it roughly in sync with `styles/peek.css`.
- **Session rule lifecycle:** background creates a deterministic rule ID (`100000 + tabId`) scoped to the active tab and target domain. The rule is removed when the peek closes or the tab is removed. Do not leak rules across sessions.
- **Excluded hosts:** `docs.google.com`, `mail.google.com`, `drive.google.com`, `accounts.google.com` are hardcoded in `peek.js`.
- **Path casing matters** for manifest-referenced files. Mismatched casing will fail Chrome Web Store review.
