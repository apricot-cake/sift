import { browser } from "wxt/browser";
import {
  DEV_CONTENT_STARTED,
  DEV_FILTER_PASS,
  DEV_LINK_RELOAD_KEY,
  decideDevLinkAction,
  type DevLinkAction,
  type DevLinkMessage
} from "../utils/dev-link.ts";
import {
  DEV_PING_ENDPOINT,
  DEV_SERVER_ORIGIN,
  ERROR_LOG_ENDPOINT
} from "../utils/dev-server.ts";
import { drainErrorLog } from "../utils/error-drain.ts";
import {
  ERROR_LOG_KEY,
  startUncaughtReporting,
  type ErrorLogEntry
} from "../utils/error-log.ts";
import {
  handlePermissionsAdded,
  handlePermissionsRemoved,
  reconcileInstances,
  type InstanceDeps
} from "../utils/instances.ts";
import { instanceStorage } from "../utils/settings-storage.ts";

// Three jobs share this file. Keeping Misskey instance registrations correct
// runs in every build; forwarding the development error log and tracking the
// dev-link both run only in development builds, because Chrome shows that
// information to a person looking at a screen and to nobody else:
//
//   - browser.permissions can be revoked outside the extension (a reader
//     clearing it from chrome://extensions, or Chrome revoking it itself), so
//     every build reconciles Misskey instance registrations against granted
//     permissions at startup and keeps listening for permissions.onRemoved
//     while running (see the code below, outside the __SIFT_DEV__ guard).
//     It also listens for permissions.onAdded, which is not the mirror image
//     it looks like: it is the backstop for addInstance() losing its own
//     popup mid-flight (see utils/instances.ts).
//   - uncaught exceptions reach only the error box of chrome://extensions, which
//     nothing outside Chrome can read. Every surface writes them to a ring
//     buffer in browser.storage.local (utils/error-log.ts); this worker carries
//     that buffer out to ~/.sift/extension-errors.log through the development
//     server's endpoint.
//   - in dev mode the content script only exists while this worker is attached
//     to the development server (utils/dev-link.ts). Whether it is attached, and
//     whether a page actually got the script, go to the same file.
//
// WHY THE RELEASE BUILD STILL CARRIES THIS FILE: `__SIFT_DEV__` is folded to a
// constant at build time (wxt.config.ts, keyed on Vite's command), so in a
// release build everything below the guard is dead code and drops out. What
// ships is the Misskey instance reconciliation and its permissions.onRemoved
// listener — real listeners Chrome has a reason to start the worker for —
// plus an otherwise empty worker for the dev-only half. The capture half of
// error reporting stays active in every build regardless: the buffer keeps
// filling in the daily browser, it simply has nobody to forward it until a
// development build reads it.
//
// Re-injecting content scripts into open tabs, which this file used to do, is
// now WXT's dev mode doing it.

// How often to ask the development server whether it is up and which generation
// it is. Matches the interval WXT already uses to keep this worker alive, so it
// adds no wake-ups of its own.
const DEV_LINK_INTERVAL_MS = 5000;

export default defineBackground(() => {
  const instanceDeps: InstanceDeps = {
    permissions: browser.permissions,
    scripting: browser.scripting,
    storage: instanceStorage
  };

  // Repairs drift between settings and what Chrome actually still grants —
  // see utils/instances.ts for the three ways that happens. Best-effort: a
  // failure here gets another chance at the next startup.
  reconcileInstances(instanceDeps).catch(() => {});

  // A reader can revoke a Misskey origin from chrome://extensions directly,
  // bypassing removeInstance() entirely. This is the one build-independent
  // way Sift hears about it while running; reconcileInstances() above covers
  // the case where it was not running to hear it.
  browser.permissions.onRemoved.addListener((removed) => {
    handlePermissionsRemoved(removed, instanceDeps).catch(() => {});
  });

  // The backstop for addInstance(): Chrome tears the popup down the instant
  // its permission dialog appears, which can silently abort addInstance()
  // before it registers the content script or saves the host (measured
  // 2026-08-04, #28) even though the grant itself already went through. This
  // listener reacts to the grant Chrome actually made, not to the popup
  // call surviving long enough to hear its own answer.
  browser.permissions.onAdded.addListener((added) => {
    handlePermissionsAdded(added, instanceDeps).catch(() => {});
  });

  if (!__SIFT_DEV__) {
    return;
  }

  startUncaughtReporting({
    target: globalThis,
    source: "background",
    filterToOwnCode: false
  });

  const errorLogUrl = `${DEV_SERVER_ORIGIN}${ERROR_LOG_ENDPOINT}`;
  const postEntries = async (entries: unknown) => {
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
    void drainErrorLog({ storage: browser.storage, post: postEntries }).catch(
      () => {
        // The development server may be down. The entries stay in the buffer.
      }
    );
  };

  // Development notes go to the same file as the exceptions, so one `tail` shows
  // both what the extension is doing and what went wrong doing it. They are not
  // buffered: a note nobody was listening for is a note about a server that was
  // down, and the next note will say so anyway.
  const note = (message: string) => {
    void postEntries([
      {
        at: new Date().toISOString(),
        kind: "dev-link",
        source: "background",
        message
      }
    ]).catch(() => {});
  };

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && ERROR_LOG_KEY in changes) {
      requestErrorLogDrain();
    }
  });
  requestErrorLogDrain();

  // A content script announcing itself. Worth a line in the log — it is the only
  // evidence from outside the browser that the runtime registration took effect
  // — and worth a listener: Chrome starts a sleeping worker to deliver this, so
  // opening a matching page is one of the things that can bring the link back.
  browser.runtime.onMessage.addListener((message: DevLinkMessage | undefined) => {
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
  browser.runtime.onStartup.addListener(() => {});

  let bootAtStart: string | undefined;
  let isFirstProbe = true;
  let lastAction: DevLinkAction | undefined;

  const probeDevServer = async () => {
    try {
      const response = await fetch(`${DEV_SERVER_ORIGIN}${DEV_PING_ENDPOINT}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        return null;
      }
      const { boot, ready } = await response.json();
      return typeof boot === "string" ? { boot, ready: ready === true } : null;
    } catch {
      // Down, or not answering. Either way there is nothing to attach to.
      return null;
    }
  };

  const checkDevLink = async () => {
    const probe = await probeDevServer();
    const [registered, stored] = await Promise.all([
      probe == null
        ? Promise.resolve([])
        : browser.scripting.getRegisteredContentScripts(),
      browser.storage.session.get(DEV_LINK_RELOAD_KEY)
    ]);

    const boot = probe?.boot ?? null;
    const reloadedForBootRaw = stored[DEV_LINK_RELOAD_KEY];
    const action = decideDevLinkAction({
      boot,
      ready: probe?.ready === true,
      isFirstProbe,
      bootAtStart,
      registeredCount: registered.length,
      reloadedForBoot:
        typeof reloadedForBootRaw === "string" ? reloadedForBootRaw : undefined
    });
    // A server that has not written its build yet tells us nothing about
    // whether this worker is attached, so the first probe stays unspent.
    if (action !== "building") {
      isFirstProbe = false;
    }

    if (action === "adopt") {
      // decideDevLinkAction() only returns "adopt" once boot is confirmed
      // non-null (it returns "server-down" first otherwise) — the fallback
      // here only satisfies the type.
      bootAtStart = boot ?? undefined;
    }
    if (action !== lastAction) {
      lastAction = action;
      note(`development link: ${action} (${registered.length} registered)`);
    }
    if (action === "reload") {
      await browser.storage.session.set({ [DEV_LINK_RELOAD_KEY]: boot });
      browser.runtime.reload();
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
