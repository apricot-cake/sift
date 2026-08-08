// Misskey instance permission and dynamic content-script registration.
//
// Misskey is decided per-user rather than per-page: Sift never injects into a
// Misskey host until the reader adds it, and the only host permission
// requested is the one they typed (see #2's issue comment, section 5, for
// why host_permissions and a hard-coded instance were both rejected).
//
// Adding a host requests exactly its origin — browser.permissions.request()
// against the wildcard declared in optional_host_permissions (wxt.config.ts)
// — and, once granted, registers a content script through
// browser.scripting.registerContentScripts() pointing at the same built files
// WXT already produces for the static X/Bluesky entry (entrypoints/content).
// There is no separate Misskey content script: #29 is what makes an adapter
// exist for it to select.
//
// Every function here takes the permissions/scripting/storage surfaces as
// parameters, so tests can supply fakes instead of a real browser.

import type { Browser } from "wxt/browser";

export const MISSKEY_CONTENT_SCRIPT_FILES = Object.freeze({
  js: Object.freeze(["content-scripts/content.js"]),
  css: Object.freeze(["content-scripts/content.css"])
});

const RUN_AT: Browser.extensionTypes.RunAt = "document_idle";
const REGISTRATION_ID_PREFIX = "misskey-";

export interface RegisteredContentScript {
  id: string;
  matches: string[];
  js: string[];
  css: string[];
  runAt: Browser.extensionTypes.RunAt;
  persistAcrossSessions: boolean;
}

// What reconcileInstances() and the permission listeners actually read back
// off a registration — never more than its id.
export interface RegisteredContentScriptRef {
  id: string;
}

export interface InstancePermissions {
  request(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
  contains(permissions: { origins: string[] }): Promise<boolean>;
}

export interface InstanceScripting {
  registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
  unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  getRegisteredContentScripts(): Promise<RegisteredContentScriptRef[]>;
}

// The host list, as the two operations this module performs on it. Narrower
// than a storage area on purpose: where the list is actually kept is
// utils/settings.ts's business (it is one field of the stored settings), and
// nothing here needs to know.
export interface InstanceStorage {
  getInstances(): Promise<string[]>;
  setInstances(hosts: string[]): Promise<void>;
}

export interface InstanceDeps {
  permissions: InstancePermissions;
  scripting: InstanceScripting;
  storage: InstanceStorage;
}

export type AddInstanceResult =
  | { added: true }
  | { added: false; reason: "invalid-host" | "permission-denied" };

export function originForHost(host: string): string {
  return `https://${host}/*`;
}

// The inverse of originForHost(), for permissions.onAdded — Chrome hands the
// listener origin strings, not hosts. Re-validated through
// normalizeInstanceHost() rather than trusted as-is, so an origin this module
// did not mint (something a future feature grants, or Chrome re-adding a
// static host_permissions entry) is ignored instead of registering garbage.
function hostForOrigin(origin: string): string | null {
  const match = /^https:\/\/([^/]+)\/\*$/.exec(origin);
  return match ? normalizeInstanceHost(match[1]) : null;
}

export function registrationIdForHost(host: string): string {
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
export function normalizeInstanceHost(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  let url: URL;
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

function contentScriptDefinition(host: string): RegisteredContentScript {
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

// Requests the one origin the host needs and, only if the user grants it,
// registers the content script and adds the host to storage. Must be called
// from within a user gesture (a click handler) — browser.permissions.request()
// rejects otherwise — so this cannot be relayed through a background message
// without losing that gesture; the popup calls it directly.
export async function addInstance(
  host: string,
  { permissions, scripting, storage }: InstanceDeps
): Promise<AddInstanceResult> {
  const normalizedHost = normalizeInstanceHost(host);
  if (normalizedHost === null) {
    return { added: false, reason: "invalid-host" };
  }

  const instances = await storage.getInstances();
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

  // Chrome tears the popup down the instant the permission dialog appears
  // (measured 2026-08-04, sift #28) — the grant itself still goes through on
  // Chrome's side, but everything queued after this `await` can simply never
  // run, silently, with nothing left to catch or log the interruption.
  // handlePermissionsAdded, wired to browser.permissions.onAdded in the
  // background entrypoint, is the backstop: it reacts to the grant Chrome
  // actually made, independent of whether this popup survived to hear its
  // own answer. That backstop can win the race and register this host before
  // this line runs, so the check below is not an optimization — without it
  // this call throws on the now-duplicate script id.
  const registrationId = registrationIdForHost(normalizedHost);
  const alreadyRegistered = (await scripting.getRegisteredContentScripts()).some(
    (script) => script.id === registrationId
  );
  if (!alreadyRegistered) {
    await scripting.registerContentScripts([contentScriptDefinition(normalizedHost)]);
  }

  const current = await storage.getInstances();
  if (!current.includes(normalizedHost)) {
    await storage.setInstances([...current, normalizedHost]);
  }

  return { added: true };
}

// Drops the registration and the permission before dropping the host from
// storage, so a failure partway through leaves the host still listed rather
// than silently keeping access the UI no longer shows.
export async function removeInstance(
  host: string,
  { permissions, scripting, storage }: InstanceDeps
): Promise<void> {
  await scripting
    .unregisterContentScripts({ ids: [registrationIdForHost(host)] })
    .catch(() => {
      // Not registered — e.g. a previous removal died between these steps.
    });
  await permissions.remove({ origins: [originForHost(host)] });

  const instances = await storage.getInstances();
  await storage.setInstances(instances.filter((existing) => existing !== host));
}

// Wired to browser.permissions.onAdded in the background entrypoint. This is
// not the mirror of handlePermissionsRemoved below so much as the backstop
// for addInstance() itself: Chrome fires this the moment a grant lands,
// whether or not the popup that called permissions.request() is still alive
// to act on its own answer (see the comment in addInstance()). Only fires
// while the service worker is alive to hear it — a grant that lands while
// Sift is not running is not a case that arises, since nothing but
// addInstance() ever requests one of these origins, and that call cannot run
// without the service worker already up to hold the popup's message port.
export async function handlePermissionsAdded(
  addedPermissions: { origins?: string[] } | undefined,
  { scripting, storage }: Pick<InstanceDeps, "scripting" | "storage">
): Promise<void> {
  const addedOrigins = addedPermissions?.origins ?? [];
  if (addedOrigins.length === 0) {
    return;
  }

  const instances = await storage.getInstances();
  const registered = await scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((script) => script.id));

  const next = [...instances];
  for (const origin of addedOrigins) {
    const host = hostForOrigin(origin);
    if (host === null || next.includes(host)) {
      continue;
    }

    const registrationId = registrationIdForHost(host);
    if (!registeredIds.has(registrationId)) {
      await scripting.registerContentScripts([contentScriptDefinition(host)]);
    }
    next.push(host);
  }

  if (next.length !== instances.length) {
    await storage.setInstances(next);
  }
}

// Wired to browser.permissions.onRemoved in the background entrypoint: a
// reader can revoke a host from chrome://extensions directly, without going
// through removeInstance, and the registration and stored host must not
// outlive that. Only fires while the service worker is alive to hear it —
// reconcileInstances() below covers the gap left when it was not.
export async function handlePermissionsRemoved(
  removedPermissions: { origins?: string[] } | undefined,
  { scripting, storage }: Pick<InstanceDeps, "scripting" | "storage">
): Promise<void> {
  const removedOrigins = new Set(removedPermissions?.origins ?? []);
  if (removedOrigins.size === 0) {
    return;
  }

  const instances = await storage.getInstances();
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

  await storage.setInstances(
    instances.filter((host) => !removedHosts.includes(host))
  );
}

// Brings the registration set back in line with both storage and the
// permissions Chrome actually still holds. Called once at startup to cover
// three ways they can drift: a permission revoked from chrome://extensions
// while Sift was not running to hear permissions.onRemoved, a registration
// lost across an extension update, and a previous addInstance() that
// granted the permission but died before it registered.
export async function reconcileInstances({
  permissions,
  scripting,
  storage
}: InstanceDeps): Promise<void> {
  const instances = await storage.getInstances();
  const registered = await scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((script) => script.id));

  const kept: string[] = [];
  const idsToUnregister: string[] = [];

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
    await storage.setInstances(kept);
  }
}
