# Diablo

Diablo is an Arc-inspired Chrome extension that lets you preview links in a floating panel without leaving the current page. Hold `Shift` and click a link to open a full-page iframe preview with quick actions like refresh, copy link, back/forward, and open in a new tab.

## Features

- Shift+Click link preview on any site
- Three peek sizes: small, medium, large
- Optional aggressive `t.co` URL unshortening for X/Twitter links
- In-panel actions: back, forward, refresh, copy link, open in new tab
- Keyboard support: `Escape` to close and focus trapped inside the panel
- Light/dark theming using `prefers-color-scheme`

## Installation (Development)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repository.

## How It Works

1. The content script listens for `Shift+Click` on `http/https` links.
2. Diablo opens a floating Shadow DOM panel with an iframe preview.
3. Background service worker adds a temporary `declarativeNetRequest` session rule for that tab and target domain, removing frame-blocking headers for `sub_frame`.
4. When the panel closes, the rule is removed.

### Security Notes

- Header modification is session-scoped and removed when the peek session ends.
- Rules are constrained to the active tab and target domain to reduce blast radius.
- Aggressive `t.co` resolution opens a temporary background tab for stubborn redirects. This path is optional and disabled by default.

## Permissions Justification

| Permission | Why it is required |
| --- | --- |
| `tabs` | Open links in a new tab from the peek panel and create/remove a temporary tab for optional aggressive `t.co` resolution. |
| `storage` | Persist user settings (`peekEnabled`, size preset, aggressive unshorten toggle) across sessions and devices. |
| `declarativeNetRequest` | Temporarily remove `X-Frame-Options` and CSP response headers for preview iframes so pages can render in peek mode. |
| `host_permissions: <all_urls>` | Diablo works on any page and previews any clicked link domain, so broad host access is necessary for the user-triggered Shift+Click behavior. |

## Privacy

See [`PRIVACY.md`](./PRIVACY.md).

Diablo does not include analytics, does not send browsing data to remote servers, and stores only extension settings in `chrome.storage.sync`.

## Chrome Web Store Listing Checklist

### Required metadata

- Single purpose: "Preview links in a floating panel without leaving the current page."
- Category: Productivity
- Detailed description that clearly explains Shift+Click behavior and permissions
- Privacy policy URL (point to `PRIVACY.md` in your hosted repository)

### Recommended listing assets

- `128x128` extension icon
- 3-5 screenshots (`1280x800` or `640x400`) showing:
  - peek panel on a real page
  - popup settings
  - different peek window sizes
- Promotional tile (`440x280`) for better discoverability

### Pre-submission checks

- Manifest V3 only, no remote executable code, no `eval()`
- All declared permissions are actively used
- Pack and test the exact submitted bundle before upload
- Ensure all manifest-referenced files exist and path casing matches exactly

## License

MIT. See [`LICENSE`](./LICENSE).