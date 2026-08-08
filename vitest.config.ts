import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WXT's own Vitest plugin, which is what makes a test see the same project the
  // build does: it reads wxt.config.ts, so the Vite config, the aliases and the
  // build-time constants (`__SIFT_DEV__`) are the extension's own rather than a
  // second set maintained here.
  plugins: [WxtVitest()],
  define: {
    // wxt.config.ts keys this on Vite's command, and a test run is neither of
    // the two commands it knows about — so the constant would be missing and
    // the content script would throw on reaching it. Tests get the release
    // build's answer: the development-only halves talk to a server no test
    // starts.
    __SIFT_DEV__: "false",
  },
  test: {
    // Every adapter is a set of selectors run against a page, so the page has to
    // be a real one. happy-dom is what makes `querySelector`, `closest`,
    // `firstElementChild` and attribute matching mean what they mean in a
    // browser — a hand-written stub answers whatever the test told it to answer,
    // which is a test of the test.
    environment: "happy-dom",
  },
});
