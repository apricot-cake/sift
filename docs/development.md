<p align="center"><strong>English</strong> · <a href="development.ja.md">日本語</a></p>

# Developing Sift

Development runs in a Chrome profile separate from your everyday one. Your everyday Chrome only ever gets verified release builds.

## Node

Node 24.12 or newer. `.node-version` and `engines` in `package.json` both say so, and CI installs whatever `.node-version` names. The scripts under `scripts\` are run by node directly, with no build step of their own, so they depend on node's own type stripping — 24.12 is the release where that stopped being experimental.

## Dependencies

Every version in `package.json` is exact, and `.npmrc` sets `save-exact=true` so the next `npm install` does not quietly reintroduce a range. Updates arrive as Dependabot pull requests — weekly, minor and patch grouped — which is the same arrangement the workflow's `uses:` entries have, pinned to commit SHAs and moved by Dependabot. A range would move a dependency with no commit saying so.

## Dev server

```powershell
npm run dev
```

The output directory is fixed at `~\.sift-dev\chrome-mv3-dev`, so it lands in the same place whichever worktree you start it from. It listens on `127.0.0.1:51732` and nowhere else — if the port is taken it fails instead of moving to another one, because the extension is built against that address. Only one dev server can run at a time.

## How the dev build and the dev server connect

The content script of a dev build is not in the manifest. The service worker registers it with `browser.scripting.registerContentScripts()` after it connects to the dev server, so a worker that is not connected runs no content script.

WXT opens its socket once, when the worker starts. If the browser was already up before the dev server, or if the server was restarted, the connection stays broken — but the dev build detects that itself. The worker polls the server every 5 seconds, and when it finds a different server than the one it started against (or no registration at all), it recovers with `browser.runtime.reload()`. It waits until the build has finished writing to the output folder, because reloading against an empty folder unloads the extension.

The state is readable from the `"kind":"dev-link"` lines in `~\.sift\extension-errors.log`. The dev server is what writes them, so nothing appears while the server is down. Only development builds write them.

- `development link: linked` — connected, with the registration in place
- `development link: building` — the server is there, but the build is not done yet
- `development link: adopt` — connected to a new server
- `development link: reload` — restarted itself to recover
- `content script started on <URL>` — the content script entered that page
- `filter pass: <n> hit, <n> rising, <n> hidden, toolbar mounted` — the first pass went through and the toolbar appeared

## Dev profile

```powershell
npm run dev:browser
```

Opens Chrome with a dedicated `--user-data-dir`. It is a separate process from your everyday Chrome, so the two can sit side by side. Only the first time, load `~\.sift-dev\chrome-mv3-dev` from `chrome://extensions` and sign in to X. The profile remembers it from then on.

Only when you change the service worker itself do you need one reload from `chrome://extensions` (or `Alt+R` in a dev profile window).

Development and release builds share the same extension ID, so they cannot live in the same profile. Do not load a dev build into your everyday profile.

To check the paths alone, `node scripts/dev-browser.ts --print` prints what they resolve to without opening a window.

## Getting a build into your everyday Chrome

Merging into main runs `npm run deploy` from the `post-merge` hook, which replaces `.output\chrome-mv3` with a verified release build (the hook is installed by `scripts/setup.ts` during `npm install`). You can also run it by hand.

```powershell
npm run deploy
```

If verification does not pass, nothing is replaced and your everyday Chrome keeps running the previous version. Linked worktrees never replace it.

## Recording uncaught exceptions

Exceptions the code fails to catch are caught by the extension itself and written to a ring buffer (the newest 50) in `browser.storage.local`. That part ships in release builds too. In development builds, the service worker sends the buffer to the dev server, which appends it to `~\.sift\extension-errors.log` as one JSON object per line.

There is no way to read the everyday profile's buffer yet. Content scripts record only the exceptions they can attribute to the extension; the popup, the settings page and the service worker record everything.

## Strings

Every string a reader sees lives in `public\_locales\<language>\messages.json` and is reached through `utils\i18n.ts`. `en` is the default locale, so a browser set to anything Sift has no messages for reads English. There is no language switch in the extension — `browser.i18n` has no way to offer one, and WXT's own i18n guide recommends the bare API over a bundled library anyway.

Three shapes reach a message:

- `t("name")` in code, with the message names typed from the English file (`i18n.d.ts` merges them into WXT's own `browser.i18n` types, so a typo does not compile)
- `data-i18n`, `data-i18n-placeholder` and `data-i18n-aria-label` in the two static pages (`entrypoints\options\index.html` and `entrypoints\popup\index.html`), filled in by `localizeDocument()` — static HTML cannot carry `__MSG_name__` the way the manifest can
- `__MSG_name__` in `wxt.config.ts`, which only the manifest's own fields take

Both pages' markup also carries the English text itself, for the moment before `main.ts` runs. `utils\i18n.test.ts` holds it to the same words as the messages file, checks the two locales name the same messages, and fails on a name that exists in neither. `verify-manifest.ts` does the same for the manifest's description.

Tests read `public\_locales\en` through `test\i18n.ts`, which is what stands in for `browser.i18n.getMessage` — WXT's fake browser leaves it unimplemented.

## Lint

```powershell
npm run lint
```

Biome over the whole tree: formatting, lint rules and import order in one pass, nothing rewritten. `npm run lint:fix` is the same pass with the fixes applied.

Indentation, line endings and the final newline are read from `.editorconfig` rather than declared in `biome.jsonc`, so an editor that knows nothing about Biome still agrees with it. What is left in `biome.jsonc` is what `.editorconfig` cannot say — and one exception for `entrypoints/content/style.css`, where `!important` is the design rather than a mistake.

## Build and test

```powershell
npm run build
```

Outputs to `.output\chrome-mv3-release`, then checks that the generated manifest carries what the sources declare: the permissions, the signing key and the name from `wxt.config.ts`, the sites from `utils/site-matches.ts`, the version from `package.json`, and a content script that actually reached the manifest. `.output\chrome-mv3` is left alone.

```powershell
npm run build:firefox
```

The same build and the same check for Firefox, into `.output\firefox-mv3-release`. This is not a claim that Sift runs on Firefox — nothing has ever been tested against it. `wxt.config.ts` pins `manifestVersion` to 3 so Firefox does not fall back to MV2, and this build is the only thing that exercises that decision; CI runs it for the same reason.

```powershell
npm test
```

Typechecks the whole tree (`tsc --noEmit`), then runs the unit tests with Vitest. Each test file sits next to the code it covers (`utils/filter-core.test.ts` and so on), and the adapters are tested by running their selectors against a real DOM — happy-dom parses the markup a test writes, so what passes is a selector that would find the element on the page. There is no separate typecheck command — this is it, and CI runs the same one.

## Commits

The subject line is a Conventional Commits type, then a summary in Japanese: `feat: 設定を options ページへ移し、popup は入口だけにする`. The types in use are `feat`, `fix`, `refactor`, `chore`, `docs`, `test` and `perf`, with a scope where one narrows it usefully (`chore(ci):`).

The body says why. What changed is in the diff, and a message that repeats it is a second copy that goes stale; what the diff cannot show is the reason the old shape was wrong. Long is fine.

Pull requests are squash-merged, so the PR title becomes the subject line on `main` and the PR body is what a reader lands on from `git log`. Write both as if they were the commit — because one of them is.

## Releases

The version lives in `package.json` and nowhere else. WXT copies it into the generated manifest, and `verify-manifest.ts` checks that it arrived.

Every merge into `main` reaches the everyday Chrome through the `post-merge` hook, so there is no release event to speak of. What the version is for is being able to say which build a profile is running: `chrome://extensions` shows it, and a tag makes it something you can check out.

Raise it when the extension a reader sees has changed — a feature, a UI that moved, a fix worth pointing at. Not for every merge.

```powershell
npm version minor --no-git-tag-version
```

`--no-git-tag-version` because `main` takes pull requests only: the bump goes in as one, and the tag is placed afterwards, on the merge commit.

```powershell
git tag v0.2.0
git push origin v0.2.0
```

There is no `CHANGELOG.md`. The commit messages already carry the reasons in prose, so `git log v0.1.0..v0.2.0` is the change list — a second copy would only be the one that goes stale.
