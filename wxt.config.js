import { defineConfig } from "wxt";
import { devErrorLog } from "./scripts/dev-error-log.js";
import { DEV_SERVER_PORT } from "./utils/dev-server.js";

export default defineConfig({
  // Firefox too. WXT would default Firefox to MV2, and one manifest version
  // keeps one set of release checks.
  manifestVersion: 3,
  // Two outputs that must never be confused for each other:
  //   dev     → a fixed path outside the tree, set by scripts/dev.js, read only
  //             by the development Chrome profile
  //   release → .output/<browser>-mv3-release, which scripts/deploy-extension.js
  //             promotes into .output/chrome-mv3 — the folder the daily Chrome
  //             has loaded. `wxt build` therefore CANNOT write to the daily
  //             folder: only a promoted build gets there.
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}-release{{modeSuffix}}",
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
      // its error buffer to this same address.
      port: DEV_SERVER_PORT
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
    description: "Xの投稿画面を、メディア・いいね数・投稿後の時間で絞り込みます。",
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
