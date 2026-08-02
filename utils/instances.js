// Misskey instance permission and dynamic content-script registration.
//
// Misskey is decided per-user rather than per-page: Sift never injects into a
// Misskey host until the reader adds it, and the only host permission
// requested is the one they typed (see #2's issue comment, section 5, for
// why host_permissions and a hard-coded instance were both rejected).
//
// Adding a host requests exactly its origin — chrome.permissions.request()
// against the wildcard declared in optional_host_permissions (wxt.config.js)
// — and, once granted, registers a content script through
// chrome.scripting.registerContentScripts() pointing at the same built files
// WXT already produces for the static X/Bluesky entry (entrypoints/content).
// There is no separate Misskey content script: #29 is what makes an adapter
// exist for it to select.
//
// Every function here takes the chrome.permissions/scripting/storage
// surfaces as parameters, so tests can supply fakes instead of a real
// browser — the same shape utils/error-drain.js uses for chrome.storage.

export const MISSKEY_INSTANCES_KEY = "misskeyInstances";

export const MISSKEY_CONTENT_SCRIPT_FILES = Object.freeze({
  js: Object.freeze(["content-scripts/content.js"]),
  css: Object.freeze(["content-scripts/content.css"])
});

const RUN_AT = "document_idle";
const REGISTRATION_ID_PREFIX = "misskey-";

export function originForHost(host) {
  return `https://${host}/*`;
}

export function registrationIdForHost(host) {
  return `${REGISTRATION_ID_PREFIX}${host}`;
}

// Accepts a bare hostname ("misskey.io") or a full https URL with nothing
// past the host — no path, query, fragment, credentials, or port. Anything
// else is what the acceptance criteria calls "not a URL, or one with a path
// or query, or http": a non-URL string fails the URL parse; http fails the
// protocol check; a path or query fails the pathname/search check. A port is
// rejected too, even though nothing above asked for it — Chrome match
// patterns cannot represent one, so keeping it would silently grant the
// whole host on every port while the UI still shows just the host typed in.
export function normalizeInstanceHost(input) {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  let url;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }

  return url.hostname;
}

function contentScriptDefinition(host) {
  return {
    id: registrationIdForHost(host),
    matches: [originForHost(host)],
    js: [...MISSKEY_CONTENT_SCRIPT_FILES.js],
    css: [...MISSKEY_CONTENT_SCRIPT_FILES.css],
    runAt: RUN_AT,
    // Chrome's default, named explicitly: the registration must survive a
    // browser restart without this module re-registering it (reconcileInstances
    // is the backstop for when that default is not enough on its own).
    persistAcrossSessions: true
  };
}

async function readInstances(storage) {
  const stored = await storage.sync.get(MISSKEY_INSTANCES_KEY);
  const value = stored?.[MISSKEY_INSTANCES_KEY];
  return Array.isArray(value) ? value : [];
}

// Requests the one origin the host needs and, only if the user grants it,
// registers the content script and adds the host to storage. Must be called
// from within a user gesture (a click handler) — chrome.permissions.request()
// rejects otherwise — so this cannot be relayed through a background message
// without losing that gesture; the popup calls it directly.
export async function addInstance(host, { permissions, scripting, storage }) {
  const normalizedHost = normalizeInstanceHost(host);
  if (normalizedHost === null) {
    return { added: false, reason: "invalid-host" };
  }

  const instances = await readInstances(storage);
  if (instances.includes(normalizedHost)) {
    // Already added. Re-requesting would silently re-grant (Chrome does not
    // re-prompt for an origin already held) and re-registering would throw on
    // the now-duplicate id, so there is nothing left to do.
    return { added: true };
  }

  const granted = await permissions.request({
    origins: [originForHost(normalizedHost)]
  });
  if (!granted) {
    return { added: false, reason: "permission-denied" };
  }

  await scripting.registerContentScripts([contentScriptDefinition(normalizedHost)]);
  await storage.sync.set({
    [MISSKEY_INSTANCES_KEY]: [...instances, normalizedHost]
  });

  return { added: true };
}

// Drops the registration and the permission before dropping the host from
// storage, so a failure partway through leaves the host still listed rather
// than silently keeping access the UI no longer shows.
export async function removeInstance(host, { permissions, scripting, storage }) {
  await scripting
    .unregisterContentScripts({ ids: [registrationIdForHost(host)] })
    .catch(() => {
      // Not registered — e.g. a previous removal died between these steps.
    });
  await permissions.remove({ origins: [originForHost(host)] });

  const instances = await readInstances(storage);
  await storage.sync.set({
    [MISSKEY_INSTANCES_KEY]: instances.filter((existing) => existing !== host)
  });
}

// Wired to chrome.permissions.onRemoved in the background entrypoint: a
// reader can revoke a host from chrome://extensions directly, without going
// through removeInstance, and the registration and stored host must not
// outlive that. Only fires while the service worker is alive to hear it —
// reconcileInstances() below covers the gap left when it was not.
export async function handlePermissionsRemoved(
  removedPermissions,
  { scripting, storage }
) {
  const removedOrigins = new Set(removedPermissions?.origins ?? []);
  if (removedOrigins.size === 0) {
    return;
  }

  const instances = await readInstances(storage);
  const removedHosts = instances.filter((host) =>
    removedOrigins.has(originForHost(host))
  );
  if (removedHosts.length === 0) {
    return;
  }

  await scripting
    .unregisterContentScripts({ ids: removedHosts.map(registrationIdForHost) })
    .catch(() => {
      // Already unregistered.
    });

  await storage.sync.set({
    [MISSKEY_INSTANCES_KEY]: instances.filter(
      (host) => !removedHosts.includes(host)
    )
  });
}

// Brings the registration set back in line with both storage and the
// permissions Chrome actually still holds. Called once at startup to cover
// three ways they can drift: a permission revoked from chrome://extensions
// while Sift was not running to hear permissions.onRemoved, a registration
// lost across an extension update, and a previous addInstance() that
// granted the permission but died before it registered.
export async function reconcileInstances({ permissions, scripting, storage }) {
  const instances = await readInstances(storage);
  const registered = await scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((script) => script.id));

  const kept = [];
  const idsToUnregister = [];

  for (const host of instances) {
    const hasPermission = await permissions.contains({
      origins: [originForHost(host)]
    });
    const registrationId = registrationIdForHost(host);

    if (!hasPermission) {
      if (registeredIds.has(registrationId)) {
        idsToUnregister.push(registrationId);
      }
      continue;
    }

    kept.push(host);
    if (!registeredIds.has(registrationId)) {
      await scripting.registerContentScripts([contentScriptDefinition(host)]);
    }
  }

  // A registration whose host is no longer in storage at all (e.g. a
  // removeInstance() that saved storage but died before unregistering).
  const keptIds = new Set(kept.map(registrationIdForHost));
  for (const id of registeredIds) {
    if (
      id.startsWith(REGISTRATION_ID_PREFIX) &&
      !keptIds.has(id) &&
      !idsToUnregister.includes(id)
    ) {
      idsToUnregister.push(id);
    }
  }

  if (idsToUnregister.length > 0) {
    await scripting.unregisterContentScripts({ ids: idsToUnregister });
  }
  if (kept.length !== instances.length) {
    await storage.sync.set({ [MISSKEY_INSTANCES_KEY]: kept });
  }
}
