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

Development happens in a Chrome profile separate from the daily one. The daily Chrome only ever runs verified release builds.

### Dev server

```powershell
npm run dev
```

Output goes to `~\.sift-dev\chrome-mv3-dev`, fixed outside the tree, so every worktree builds to the same place. The server listens on `127.0.0.1:51732` only and fails rather than move to another port, because the extension is built against this address. Only one dev server can run at a time.

### How the dev build connects to the dev server

The dev build's content scripts are not in the manifest. The service worker registers them with `chrome.scripting.registerContentScripts()` after connecting to the dev server, so a disconnected worker runs no content scripts at all.

WXT opens its socket once, at worker startup. If the browser started before the dev server, or the server was restarted, the link stays broken — but the dev build detects this itself. The worker polls the server every 5 seconds and calls `chrome.runtime.reload()` when it sees a different server (or missing registrations). It waits until the build has been fully written, because reloading from an empty output folder unloads the extension.

The state can be read from the `"kind":"dev-link"` lines in `~\.sift\extension-errors.log`. The log is written via the dev server, so nothing appears while the server is down. Only development builds write it.

- `development link: linked` — connected, registrations present
- `development link: building` — server up, build not yet written
- `development link: adopt` — connected to a new server
- `development link: reload` — restarted itself to recover
- `content script started on <URL>` — the content script actually ran on that page
- `filter pass: <n> hit, <n> rising, <n> hidden, toolbar mounted` — first filter pass done, toolbar mounted

### Dev profile

```powershell
npm run dev:browser
```

Opens Chrome with a dedicated `--user-data-dir`, as a separate process next to the daily Chrome. On the first run only, load `~\.sift-dev\chrome-mv3-dev` from `chrome://extensions` and sign in to X. The profile remembers both.

Only when the service worker itself has changed, press reload once in `chrome://extensions` (or `Alt+R` in the dev-profile window).

Development and release builds share the same extension ID, so they cannot coexist in one profile. Never load the dev build into the daily profile.

To check the resolved paths only, `node scripts/dev-browser.ts --print` prints them without opening a window.

### Deploying to the daily Chrome

Merging into main runs the `post-merge` hook, which runs `npm run deploy` and swaps the verified release into `.output\chrome-mv3` (the hook is set up by `scripts/setup.ts` during `npm install`). It can also be run by hand:

```powershell
npm run deploy
```

If verification fails, nothing is swapped and the daily Chrome keeps running the previous build. Linked worktrees never deploy.

### Uncaught exception log

Exceptions the code fails to catch are captured by the extension itself and written to a ring buffer (latest 50) in `chrome.storage.local`. The capturing side is present in release builds too. In development builds, the service worker forwards the buffer to the dev server, which appends one JSON line per entry to `~\.sift\extension-errors.log`.

There is no way to read the daily-side buffer yet. Content scripts record only exceptions identifiable as the extension's own; the popup and service worker record everything.

### Build and test

```powershell
npm run build
```

Outputs to `.output\chrome-mv3-release` and checks the generated manifest against the permissions, host list, and content-script config in `manifest.legacy.json`. `.output\chrome-mv3` is left untouched.

```powershell
npm test
```

Runs the unit tests for the filter logic and the error log.
