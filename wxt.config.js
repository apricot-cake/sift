import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { defineConfig } from "wxt";
import { devErrorLog } from "./scripts/dev-error-log.js";
import { DEV_SERVER_HOST, DEV_SERVER_PORT } from "./utils/dev-server.js";

// Where a DEVELOPMENT build lands. Deliberately outside the working tree and
// identical for every tree: the dedicated development Chrome profile loads one
// unpacked folder once, and re-pointing it every time work moves to another
// worktree would be a click nobody remembers to make.
//
// SIFT_DEV_OUTPUT is set by `npm run dev`, and by nothing else — a bare `wxt`
// leaves it unset and writes into .output like a release does, which is the
// right answer for a build nobody's profile has loaded.
const developmentOutput =
  process.env.SIFT_DEV_OUTPUT || resolve(homedir(), ".sift-dev", "chrome-mv3-dev");

export default defineConfig({
  // Firefox too. WXT would default Firefox to MV2, and one manifest version
  // keeps one set of release checks.
  manifestVersion: 3,
  // Two outputs that must never be confused for each other:
  //   dev     → the fixed path above, read only by the development profile
  //   release → .output/<browser>-mv3-release, which scripts/deploy-extension.js
  //             promotes into .output/chrome-mv3 — the folder the daily Chrome
  //             has loaded. `wxt build` therefore CANNOT write to the daily
  //             folder: only a promoted build gets there.
  //
  // Keyed on the env var rather than on dev-vs-build, because the config is read
  // before either is known. `npm run dev` sets it; `wxt build` does not.
  outDir: process.env.SIFT_DEV_OUTPUT
    ? dirname(developmentOutput)
    : resolve(import.meta.dirname, ".output"),
  outDirTemplate: process.env.SIFT_DEV_OUTPUT
    ? basename(developmentOutput)
    : "{{browser}}-mv{{manifestVersion}}-release{{modeSuffix}}",
  // WXT must NOT launch a browser. Two independent reasons:
  //   - anything opened through an automation stack carries the automation-flag
  //     fingerprint, and X reads it as a bot and refuses sign-in. The development
  //     profile is signed in to X; losing that is losing its reason to exist.
  //   - `--load-extension` is ignored by Chrome 137+ (measured on Chrome 151), so
  //     a managed launch would not even load the extension.
  // The extension is loaded once, by hand, into the dedicated profile. Keeping
  // the runner off also means `web-ext` — an optional peer dependency since WXT
  // 0.21.2 — is never installed.
  webExt: {
    disabled: true
  },
  dev: {
    server: {
      // utils/dev-server.js is the single source: the development worker posts
      // its error buffer and its liveness probe to this same address.
      //
      // The HOST is pinned for the same reason as the port. WXT's default is
      // `localhost`, which resolved to ::1 here and bound there only, so the
      // worker's posts to 127.0.0.1 were refused and every diagnostic the
      // extension produced was lost in silence (#31). Naming the address makes
      // the HMR socket, the CSP, the host permission and the worker's fetches
      // agree on one host.
      //
      // `origin` is a SEPARATE option in WXT, and defaults to localhost on its
      // own — setting only `host` moves what the server binds without moving
      // what the extension is built to call, which is the same mismatch again.
      host: DEV_SERVER_HOST,
      origin: DEV_SERVER_HOST,
      port: DEV_SERVER_PORT,
      // Without this WXT quietly takes the next free port when 51732 is busy.
      // The extension is built against one address it cannot renegotiate, so a
      // server on another port is a server nothing will ever talk to — a failure
      // that looks exactly like the extension being broken. Refusing to start is
      // how the second dev server finds out it is the second one.
      strictPort: true
    }
  },
  manifest: {
    // The fixed signing key, and therefore the fixed extension id
    // (bohbpocokkfioejlabmeaimpkpmablkm). Without it the id is derived from the
    // folder path, so moving the daily build to another folder would silently
    // mint a new extension — and a new chrome.storage.sync with it. Identical in
    // development and release: the two live in separate Chrome profiles, so the
    // same id cannot collide with itself.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7HRMGxpsFxVmyHkVNzHAtaSVuu6vJVFCC0gSSYBT9t31XfT68U7NYyn15N3rLuvZRhRAXYBgZiouzH619jVc2lbHGRzRUPYjm8o0XW70TW6NB+g7P510902pHXw1TmcrN9wqFfFsFhV50DObPKfY+GYfgNzWo+A4raQ4+sCQaCv9TNR78CU2HAi81oGJthhxPYRfdZdqLiZ7FWSnz+Nv9Ie0Q0RAn6W21ekSRpN6wfJf4AjgBe5sj3zRRTGH6CcUSvfUehjKjSbsS5KX5OhL4KWsio4GYRmUZa3SJxWexZN3kLSo4ugA+0AaT0rFjLTZhxOl/ULBeMvBvnnZ+xEqyQIDAQAB",
    name: "Sift",
    description:
      "XとBlueskyの投稿画面を、メディア・いいね数・投稿後の時間で絞り込みます。",
    // Only what the release needs. WXT adds `scripting` in development on its
    // own, because that is how its dev mode registers content scripts.
    permissions: ["storage"],
    action: {
      default_title: "Sift"
    }
  },
  vite: (env) => ({
    // Answers the endpoint the development worker posts its error buffer to.
    // The plugin applies to `serve` only, so a release build never carries it.
    plugins: [devErrorLog()],
    define: {
      // Which build this bundle IS. Keyed on the COMMAND, deliberately:
      // `import.meta.env.DEV` follows NODE_ENV, so a release built from a test
      // runner would come out believing it was a development build.
      __SIFT_DEV__: JSON.stringify(env.command === "serve")
    }
  })
});
