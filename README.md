<p align="center"><strong>English</strong> · <a href="README.ja.md">日本語</a></p>

# Sift

A Chrome extension that filters the posts loaded into the X, Bluesky and Misskey timelines, right in the browser.

> [!WARNING]
> **Not released yet.** Sift is not on the Chrome Web Store — to use it, build this repository yourself and load it as an unpacked extension. Breaking changes land without notice, and saved settings can reset to their defaults. When a supported service changes its page structure, filtering stops working until Sift is updated.

The defaults are below. Every value can be changed from the extension icon, or from the "Settings" button at the bottom right of the timeline — which shows only the thresholds the service on that screen uses.

- Normal: has an image or video, 500+ likes (Misskey: 20+ reactions)
- Rising: has an image or video, posted within the last 6 hours, 100+ likes (Misskey: 5+ reactions)
- Reposts excluded

## Install

```powershell
npm install
npm run deploy
```

Load `.output\chrome-mv3` as an unpacked extension from `chrome://extensions`, then open any screen on X or Bluesky where posts are listed. For Misskey, add your instance in the settings page first. The extraction status appears at the bottom right (blue line = normal, orange line = rising).

`.output\chrome-mv3` holds verified release builds only. Development builds never land there.

## How it works, and limits

- Only the posts loaded into the screen you currently have open are evaluated. No auto-scrolling, no background collection, no unofficial API calls.
- Post data is never stored or sent anywhere. Only your settings are saved, in Chrome sync storage.
- Posts that never reach the open screen — private accounts, blocks, region locks — cannot be shown.
- The interface is in English and Japanese, picked from the browser's own language setting. There is no language switch inside the extension; a browser set to anything else gets English.

### Supported services

Filter conditions are shared across services. Bluesky likes use the same thresholds as X likes. **Misskey reactions have thresholds of their own**: a reaction is one per reader just as a like is, but instance sizes differ from X's by orders of magnitude, and one shared number would leave either service permanently empty or permanently unfiltered.

| | X | Bluesky | Misskey |
| --- | --- | --- | --- |
| Hosts | `x.com` / `twitter.com` | `bsky.app` | the instances you add |
| Reaction count | Likes | Likes | Reactions (summed per emoji) |
| Thresholds | Likes | Likes (shared with X) | Reactions (separate) |
| Share exclusion | Reposts | Reposts | Renotes |

Bluesky limitations:

- Covered: home, profiles, feeds, lists, and post detail pages. On the notifications screen only post rows are evaluated.
- Search results are not covered — they alone are rendered differently from every other screen.
- Post times are read from the post URL. When that fails, only the "rising" check is skipped; normal filtering still runs.
- Reposts are detected by structure, not by the on-screen label. If Bluesky changes that structure, repost exclusion may stop working.

### Adding Misskey instances

Because every Misskey user is on a different instance, Sift only accesses the instances you add. In the settings page opened from the extension icon, enter a host name (e.g. `misskey.io`); Chrome shows a permission dialog for that host only, and the content script is loaded only if you grant it. Removing an instance drops both the content-script registration and the host permission. A host that turns out not to be Misskey is left alone — the page has to say it is Misskey before Sift reads it as one.

Misskey limitations. **A Misskey page carries almost nothing to hold on to:** its class names are generated afresh in every build, so Sift reads notes by their shape. A fork or a version whose shape differs is a page Sift can misread.

- **Reaction counts are the sum of the per-emoji chips**, because no total is drawn (the total is a Misskey setting, off by default). **The chips stop at 16 emoji**, so a note reacted to with more kinds than that reads lower than it is — 1-3% of media-bearing notes, measured.
- **Post times are read from the localized text on screen**, since Misskey writes no machine-readable time. Japanese and English pages read; for a language that does not, only the "rising" check is skipped and normal filtering still runs.
- **Renotes are excluded, quote renotes are not** — a quote carries its author's own text and counts as their post.
- **Media means images and videos**, once avatars, custom emoji and role badges are excluded. An attachment held behind a click (sensitive media, the data saver) counts as media.

## Development

Dev environment, builds, and tests are documented in [docs/development.md](docs/development.md).
