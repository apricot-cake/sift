import { DEV_SERVER_ORIGIN, ERROR_LOG_ENDPOINT } from "../utils/dev-server.js";
import { drainErrorLog } from "../utils/error-drain.js";
import { ERROR_LOG_KEY, startUncaughtReporting } from "../utils/error-log.js";

// The development worker, and nothing else.
//
// WHY IT EXISTS AT ALL: uncaught exceptions reach only the error box of
// chrome://extensions, which nothing outside Chrome can read. Every surface
// writes them to a ring buffer in chrome.storage.local (utils/error-log.js);
// this worker is what carries that buffer out to ~/.sift/extension-errors.log
// through the development server's endpoint.
//
// WHY THE RELEASE STILL CARRIES IT: `__SIFT_DEV__` is folded to a constant at
// build time (wxt.config.js, keyed on Vite's command), so in a release build
// everything below the guard is dead code and drops out — what ships is an empty
// worker with no listeners, which Chrome never has a reason to start. The
// capture half stays in every build: the buffer keeps filling in the daily
// browser, it simply has nobody to forward it until a development build reads
// it.
//
// Re-injecting content scripts into open tabs, which this file used to do, is
// now WXT's dev mode doing it.
export default defineBackground(() => {
  if (!__SIFT_DEV__) {
    return;
  }

  startUncaughtReporting({
    target: globalThis,
    source: "background",
    filterToOwnCode: false
  });

  const errorLogUrl = `${DEV_SERVER_ORIGIN}${ERROR_LOG_ENDPOINT}`;
  const requestErrorLogDrain = () => {
    void drainErrorLog({
      storage: chrome.storage,
      post: async (entries) => {
        const response = await fetch(errorLogUrl, {
          method: "POST",
          // text/plain keeps this a simple request, so the post never depends on
          // a preflight being answered.
          headers: { "content-type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(entries)
        });
        if (!response.ok) {
          throw new Error(
            `The development error log returned HTTP ${response.status}.`
          );
        }
      }
    }).catch(() => {
      // The development server may be down. The entries stay in the buffer.
    });
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && ERROR_LOG_KEY in changes) {
      requestErrorLogDrain();
    }
  });
  requestErrorLogDrain();
});
