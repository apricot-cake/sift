<p align="center"><strong>English</strong> · <a href="README.ja.md">日本語</a></p>

# Sift

A Chrome extension that filters the posts loaded into the X and Bluesky timelines, right in the browser.

> [!WARNING]
> **Not released yet.** Sift is not on the Chrome Web Store — to use it, build this repository yourself and load it as an unpacked extension. Breaking changes land without notice, and saved settings can reset to their defaults. When a supported service changes its page structure, filtering stops working until Sift is updated.

The defaults are below. Every value can be changed from the extension icon, or from the "Settings" button at the bottom right of the timeline.

- Normal: has an image or video, 500+ likes
- Rising: has an image or video, posted within the last 6 hours, 100+ likes
- Reposts excluded

## Install

```powershell
npm install
npm run deploy
```

Load `.output\chrome-mv3` as an unpacked extension from `chrome://extensions`, then open any screen on X or Bluesky where posts are listed. The extraction status appears at the bottom right (blue line = normal, orange line = rising).

`.output\chrome-mv3` holds verified release builds only. Development builds never land there.

## How it works, and limits

- Only the posts loaded into the screen you currently have open are evaluated. No auto-scrolling, no background collection, no unofficial API calls.
- Post data is never stored or sent anywhere. Only your settings are saved, in Chrome sync storage.
- Posts that never reach the open screen — private accounts, blocks, region locks — cannot be shown.

### Supported services

Filter conditions and settings are shared across services. Bluesky likes use the same thresholds as X likes.

| | X | Bluesky |
| --- | --- | --- |
| Hosts | `x.com` / `twitter.com` | `bsky.app` |
| Reaction count | Likes | Likes |
| Share exclusion | Reposts | Reposts |

Bluesky limitations:

- Covered: home, profiles, feeds, lists, and post detail pages. On the notifications screen only post rows are evaluated.
- Search results are not covered — they alone are rendered differently from every other screen.
- Post times are read from the post URL. When that fails, only the "rising" check is skipped; normal filtering still runs.
- Reposts are detected by structure, not by the on-screen label. If Bluesky changes that structure, repost exclusion may stop working.

### Adding Misskey instances

Because every Misskey user is on a different instance, Sift only accesses the instances you add. In the settings page opened from the extension icon, enter a host name (e.g. `misskey.io`); Chrome shows a permission dialog for that host only, and the content script is loaded only if you grant it. Removing an instance drops both the content-script registration and the host permission.

There is no Misskey adapter yet, so filtering and the toolbar do not appear on added instances.

## Development

Dev environment, builds, and tests are documented in [docs/development.md](docs/development.md) (Japanese).
