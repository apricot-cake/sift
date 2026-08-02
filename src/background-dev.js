import {
  collectUndrainedEntries,
  ERROR_LOG_KEY,
  startUncaughtReporting
} from "./error-log.js";

export const RUNTIME_SESSION_KEY = "siftDevRuntimeInitialized";
export const ERROR_LOG_DRAINED_SEQ_KEY = "siftErrorLogDrainedSeq";
const DEV_SERVER_PROBE_INTERVAL_MS = 750;
const ERROR_LOG_ENDPOINT = "/__sift_error_log";

export function getContentScriptPlans(manifest) {
  return (manifest.content_scripts ?? [])
    .filter(
      (entry) =>
        Array.isArray(entry.matches) &&
        entry.matches.length > 0 &&
        Array.isArray(entry.js) &&
        entry.js.length > 0
    )
    .map((entry) => ({
      matches: entry.matches,
      files: entry.js
    }));
}

export async function reinjectExistingTabs({
  manifest,
  scripting,
  tabs
}) {
  let injectedTabCount = 0;

  for (const plan of getContentScriptPlans(manifest)) {
    const matchingTabs = await tabs.query({ url: plan.matches });

    for (const tab of matchingTabs) {
      if (!Number.isInteger(tab.id)) {
        continue;
      }

      try {
        await scripting.executeScript({
          target: { tabId: tab.id },
          files: plan.files
        });
        injectedTabCount += 1;
      } catch (error) {
        console.warn(
          `[sift] Could not restore the content runtime in tab ${tab.id}:`,
          error
        );
      }
    }
  }

  return injectedTabCount;
}

export async function initializeDevRuntime(api) {
  const initialized = await api.storage.session.get(
    RUNTIME_SESSION_KEY
  );
  if (initialized[RUNTIME_SESSION_KEY]) {
    return { initialized: false, injectedTabCount: 0 };
  }

  const injectedTabCount = await reinjectExistingTabs({
    manifest: api.runtime.getManifest(),
    scripting: api.scripting,
    tabs: api.tabs
  });
  await api.storage.session.set({ [RUNTIME_SESSION_KEY]: true });

  return { initialized: true, injectedTabCount };
}

// Carries the error ring buffer out of chrome.storage.local and into a file the
// resident Vite server owns, which is the only form of it a diagnosis running
// outside Chrome can read. The mark of what has already been forwarded lives in
// session storage: it survives the worker being torn down and restarted, and is
// gone by the time a new browser session starts over.
//
// A failed post leaves the mark untouched on purpose — the entries stay in the
// buffer and go out on the next attempt.
export async function drainErrorLog({ storage, post }) {
  const [stored, drained] = await Promise.all([
    storage.local.get(ERROR_LOG_KEY),
    storage.session.get(ERROR_LOG_DRAINED_SEQ_KEY)
  ]);

  const pending = collectUndrainedEntries(
    stored?.[ERROR_LOG_KEY],
    drained?.[ERROR_LOG_DRAINED_SEQ_KEY]
  );
  if (pending.length === 0) {
    return { forwarded: 0 };
  }

  await post(pending);
  await storage.session.set({
    [ERROR_LOG_DRAINED_SEQ_KEY]: pending.at(-1).seq
  });

  return { forwarded: pending.length };
}

export function createDevServerMonitor({ probe, reload }) {
  let disconnected = false;

  return {
    async check() {
      try {
        await probe();
      } catch {
        disconnected = true;
        return "disconnected";
      }

      if (!disconnected) {
        return "connected";
      }

      disconnected = false;
      reload();
      return "reloaded";
    }
  };
}

if (
  globalThis.chrome?.runtime?.getManifest &&
  globalThis.chrome?.storage?.session
) {
  startUncaughtReporting({
    target: globalThis,
    source: "background",
    filterToOwnCode: false
  });

  void initializeDevRuntime(globalThis.chrome).catch((error) => {
    console.error(
      "[sift] Could not initialize the development runtime:",
      error
    );
  });

  const errorLogUrl = new URL(ERROR_LOG_ENDPOINT, import.meta.url);
  const requestErrorLogDrain = () => {
    void drainErrorLog({
      storage: globalThis.chrome.storage,
      post: async (entries) => {
        const response = await fetch(errorLogUrl, {
          method: "POST",
          // text/plain keeps this a simple request, so the post never depends
          // on a preflight being answered.
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

  globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && ERROR_LOG_KEY in changes) {
      requestErrorLogDrain();
    }
  });
  requestErrorLogDrain();

  const probeUrl = new URL("/__vite_ping", import.meta.url);
  const monitor = createDevServerMonitor({
    probe: async () => {
      const response = await fetch(probeUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Vite readiness returned HTTP ${response.status}.`);
      }
    },
    reload: () => globalThis.chrome.runtime.reload()
  });
  setInterval(() => {
    void monitor.check();
  }, DEV_SERVER_PROBE_INTERVAL_MS);
}
