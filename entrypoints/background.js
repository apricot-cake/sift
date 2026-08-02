import {
  DEV_CONTENT_STARTED,
  DEV_FILTER_PASS,
  DEV_LINK_RELOAD_KEY,
  decideDevLinkAction
} from "../utils/dev-link.js";
import {
  DEV_PING_ENDPOINT,
  DEV_SERVER_ORIGIN,
  ERROR_LOG_ENDPOINT
} from "../utils/dev-server.js";
import { drainErrorLog } from "../utils/error-drain.js";
import { ERROR_LOG_KEY, startUncaughtReporting } from "../utils/error-log.js";

// The development worker, and nothing else. It does two jobs, both of which
// exist because Chrome shows this information to a person looking at a screen
// and to nobody else:
//
//   - uncaught exceptions reach only the error box of chrome://extensions, which
//     nothing outside Chrome can read. Every surface writes them to a ring
//     buffer in chrome.storage.local (utils/error-log.js); this worker carries
//     that buffer out to ~/.sift/extension-errors.log through the development
//     server's endpoint.
//   - in dev mode the content script only exists while this worker is attached
//     to the development server (utils/dev-link.js). Whether it is attached, and
//     whether a page actually got the script, go to the same file.
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

// How often to ask the development server whether it is up and which generation
// it is. Matches the interval WXT already uses to keep this worker alive, so it
// adds no wake-ups of its own.
const DEV_LINK_INTERVAL_MS = 5000;

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
  const postEntries = async (entries) => {
    const response = await fetch(errorLogUrl, {
      method: "POST",
      // text/plain keeps this a simple request, so the post never depends on a
      // preflight being answered.
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(entries)
    });
    if (!response.ok) {
      throw new Error(
        `The development error log returned HTTP ${response.status}.`
      );
    }
  };

  const requestErrorLogDrain = () => {
    void drainErrorLog({ storage: chrome.storage, post: postEntries }).catch(
      () => {
        // The development server may be down. The entries stay in the buffer.
      }
    );
  };

  // Development notes go to the same file as the exceptions, so one `tail` shows
  // both what the extension is doing and what went wrong doing it. They are not
  // buffered: a note nobody was listening for is a note about a server that was
  // down, and the next note will say so anyway.
  const note = (message) => {
    void postEntries([
      {
        at: new Date().toISOString(),
        kind: "dev-link",
        source: "background",
        message
      }
    ]).catch(() => {});
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && ERROR_LOG_KEY in changes) {
      requestErrorLogDrain();
    }
  });
  requestErrorLogDrain();

  // A content script announcing itself. Worth a line in the log — it is the only
  // evidence from outside the browser that the runtime registration took effect
  // — and worth a listener: Chrome starts a sleeping worker to deliver this, so
  // opening a matching page is one of the things that can bring the link back.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === DEV_CONTENT_STARTED) {
      note(`content script started on ${message.page}`);
    }
    if (message?.type === DEV_FILTER_PASS) {
      const { hit, rising, hidden } = message.counts;
      note(
        `filter pass: ${hit} hit, ${rising} rising, ${hidden} hidden, toolbar ${
          message.toolbar ? "mounted" : "absent"
        }`
      );
    }
  });

  // Chrome only starts a worker to deliver an event it is listening for. Without
  // this one, a development build has nothing to wake it at browser start, and a
  // worker that never runs never attaches — which is how a whole profile ends up
  // with no content script on any page (#31).
  chrome.runtime.onStartup.addListener(() => {});

  let bootAtStart;
  let isFirstProbe = true;
  let lastAction;

  const probeDevServer = async () => {
    try {
      const response = await fetch(`${DEV_SERVER_ORIGIN}${DEV_PING_ENDPOINT}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        return null;
      }
      const { boot } = await response.json();
      return typeof boot === "string" ? boot : null;
    } catch {
      // Down, or not answering. Either way there is nothing to attach to.
      return null;
    }
  };

  const checkDevLink = async () => {
    const boot = await probeDevServer();
    const [registered, stored] = await Promise.all([
      boot == null
        ? Promise.resolve([])
        : chrome.scripting.getRegisteredContentScripts(),
      chrome.storage.session.get(DEV_LINK_RELOAD_KEY)
    ]);

    const action = decideDevLinkAction({
      boot,
      isFirstProbe,
      bootAtStart,
      registeredCount: registered.length,
      reloadedForBoot: stored?.[DEV_LINK_RELOAD_KEY]
    });
    isFirstProbe = false;

    if (action === "adopt") {
      bootAtStart = boot;
    }
    if (action !== lastAction) {
      lastAction = action;
      note(`development link: ${action} (${registered.length} registered)`);
    }
    if (action === "reload") {
      await chrome.storage.session.set({ [DEV_LINK_RELOAD_KEY]: boot });
      chrome.runtime.reload();
    }
  };

  const runDevLinkCheck = () => {
    void checkDevLink().catch(() => {
      // Reloading the extension rejects everything in flight. Nothing to do.
    });
  };

  runDevLinkCheck();
  setInterval(runDevLinkCheck, DEV_LINK_INTERVAL_MS);
});
