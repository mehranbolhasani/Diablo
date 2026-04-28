# Diablo Privacy Policy

Last updated: 2026-04-28

## Overview

Diablo is a Chrome extension that previews links in a floating panel when you use `Shift+Click`.

We designed Diablo to minimize data collection. Diablo does not run analytics, does not sell data, and does not send personal data to a backend service.

## Data We Access

Diablo can access:

- The current page context where you use `Shift+Click` (to detect link clicks and show the peek panel)
- The target link URL you choose to preview
- Extension settings stored by you:
  - `peekEnabled`
  - `peekSizePreset`
  - `aggressiveXUnshortenEnabled`

## Data We Store

Diablo stores only extension preferences in `chrome.storage.sync` so your settings persist across browser sessions/devices.

No account information or personal profile is created by Diablo.

## Data We Do Not Collect

Diablo does **not**:

- Collect browsing history as analytics
- Transmit personal data to an external backend
- Use tracking pixels or third-party analytics SDKs
- Sell or share user data for advertising

## Network and Header Handling

To render previews in iframes, Diablo temporarily applies a `declarativeNetRequest` session rule that removes `X-Frame-Options` and `Content-Security-Policy` response headers for preview `sub_frame` requests.

Safeguards:

- Session-scoped rule (not permanent)
- Scoped to the current tab and preview target domain
- Rule removed when the peek session closes

If you enable "Aggressive X Unshorten", Diablo may briefly open a background tab to resolve stubborn `t.co` redirects.

## Third-Party Services

Diablo does not rely on third-party analytics or telemetry services.

When you preview a link, your browser makes normal network requests to the destination website, just like opening that page in a tab.

## Your Choices

You can:

- Disable peek entirely from the extension popup
- Change preview size
- Disable aggressive `t.co` unshortening
- Remove the extension at any time from `chrome://extensions`

## Changes to This Policy

We may update this policy as Diablo evolves. Any changes will be posted in this file with an updated "Last updated" date.

## Contact

Developer: Mehran Bolhasani  
Project: Diablo  
Repository: https://github.com/ (replace with your repository URL)

