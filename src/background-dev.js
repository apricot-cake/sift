export const RUNTIME_SESSION_KEY = "siftDevRuntimeInitialized";
const DEV_SERVER_PROBE_INTERVAL_MS = 750;

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
  void initializeDevRuntime(globalThis.chrome).catch((error) => {
    console.error(
      "[sift] Could not initialize the development runtime:",
      error
    );
  });

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
