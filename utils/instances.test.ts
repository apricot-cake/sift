import { describe, expect, it } from "vitest";
import { createFakeStorageArea } from "../test/storage.ts";
import {
  addInstance,
  handlePermissionsAdded,
  handlePermissionsRemoved,
  MISSKEY_CONTENT_SCRIPT_FILES,
  MISSKEY_INSTANCES_KEY,
  normalizeInstanceHost,
  originForHost,
  reconcileInstances,
  registrationIdForHost,
  removeInstance,
  type RegisteredContentScript
} from "./instances.ts";

// browser.permissions, as a set of granted origins.
function createFakePermissions(grantedOrigins: string[] = []) {
  const origins = new Set(grantedOrigins);
  return {
    origins,
    async request({ origins: requested }: { origins: string[] }) {
      for (const origin of requested) {
        origins.add(origin);
      }
      return true;
    },
    async remove({ origins: requested }: { origins: string[] }) {
      let removedAny = false;
      for (const origin of requested) {
        removedAny = origins.delete(origin) || removedAny;
      }
      return removedAny;
    },
    async contains({ origins: requested }: { origins: string[] }) {
      return requested.every((origin) => origins.has(origin));
    }
  };
}

// A registered script as this fake stores it. Looser than the real
// RegisteredContentScript: seed data for getRegisteredContentScripts() in the
// tests below only ever supplies `id` and sometimes `matches`.
interface FakeRegisteredScript {
  id: string;
  matches?: string[];
  js?: string[];
  css?: string[];
  runAt?: string;
  persistAcrossSessions?: boolean;
}

// browser.scripting, which refuses a duplicate id and an unregister of something
// it never registered — both of which the code has to work around rather than
// walk into.
function createFakeScripting(initialScripts: FakeRegisteredScript[] = []) {
  const scripts = new Map<string, FakeRegisteredScript>(
    initialScripts.map((script) => [script.id, script])
  );
  return {
    scripts,
    async registerContentScripts(registered: RegisteredContentScript[]) {
      for (const script of registered) {
        if (scripts.has(script.id)) {
          throw new Error(`duplicate script id ${script.id}`);
        }
        scripts.set(script.id, script);
      }
    },
    async unregisterContentScripts({ ids }: { ids?: string[] } = {}) {
      const targets = ids ?? [...scripts.keys()];
      for (const id of targets) {
        if (!scripts.has(id)) {
          throw new Error(`no registered content script with id ${id}`);
        }
        scripts.delete(id);
      }
    },
    async getRegisteredContentScripts() {
      return [...scripts.values()];
    }
  };
}

const registration = {
  id: "misskey-misskey.io",
  matches: ["https://misskey.io/*"],
  js: [...MISSKEY_CONTENT_SCRIPT_FILES.js],
  css: [...MISSKEY_CONTENT_SCRIPT_FILES.css],
  runAt: "document_idle",
  persistAcrossSessions: true
};

describe("normalizeInstanceHost", () => {
  it("takes a host however the reader typed it", () => {
    expect(normalizeInstanceHost("misskey.io")).toBe("misskey.io");
    expect(normalizeInstanceHost("https://misskey.io")).toBe("misskey.io");
    expect(normalizeInstanceHost("https://misskey.io/")).toBe("misskey.io");
    expect(normalizeInstanceHost("  misskey.io  ")).toBe("misskey.io");
  });

  it("refuses what is not a host", () => {
    expect(normalizeInstanceHost("not a host")).toBeNull();
    expect(normalizeInstanceHost("")).toBeNull();
    expect(normalizeInstanceHost(null)).toBeNull();
  });

  it("refuses anything narrower or wider than one host", () => {
    expect(normalizeInstanceHost("https://misskey.io/notes/1")).toBeNull();
    expect(normalizeInstanceHost("misskey.io/notes/1")).toBeNull();
    expect(normalizeInstanceHost("https://misskey.io/?q=1")).toBeNull();
    // http instead of https.
    expect(normalizeInstanceHost("http://misskey.io")).toBeNull();
    // A port: match patterns cannot represent one.
    expect(normalizeInstanceHost("misskey.io:8080")).toBeNull();
  });
});

describe("the shape of one instance", () => {
  it("is one origin and one registration id", () => {
    expect(originForHost("misskey.io")).toBe("https://misskey.io/*");
    expect(registrationIdForHost("misskey.io")).toBe("misskey-misskey.io");
  });
});

describe("addInstance", () => {
  it("registers and stores nothing when the reader denies the permission", async () => {
    const permissions = createFakePermissions();
    permissions.request = async () => false;
    const scripting = createFakeScripting();
    const storage = { sync: createFakeStorageArea() };

    const result = await addInstance("misskey.io", { permissions, scripting, storage });

    expect(result).toEqual({ added: false, reason: "permission-denied" });
    expect(scripting.scripts.size).toBe(0);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toBeUndefined();
  });

  it("rejects an invalid host before asking for anything", async () => {
    const permissions = createFakePermissions();
    let requested = false;
    permissions.request = async () => {
      requested = true;
      return true;
    };
    const scripting = createFakeScripting();
    const storage = { sync: createFakeStorageArea() };

    const result = await addInstance("http://misskey.io", { permissions, scripting, storage });

    expect(result).toEqual({ added: false, reason: "invalid-host" });
    expect(requested).toBe(false);
  });

  it("registers the same built files the static content script uses", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting();
    const storage = { sync: createFakeStorageArea() };

    const result = await addInstance("misskey.io", { permissions, scripting, storage });

    expect(result).toEqual({ added: true });
    expect(permissions.origins.has("https://misskey.io/*")).toBe(true);
    expect(scripting.scripts.get("misskey-misskey.io")).toEqual(registration);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });

  it("is a no-op for a host that is already added", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting();
    const storage = { sync: createFakeStorageArea() };
    await addInstance("misskey.io", { permissions, scripting, storage });

    // Neither re-requests the permission nor tries to register the now-duplicate
    // script id, which would throw.
    permissions.request = async () => {
      throw new Error("must not re-request an already-granted origin");
    };
    const repeated = await addInstance("misskey.io", { permissions, scripting, storage });

    expect(repeated).toEqual({ added: true });
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });

  // Chrome tears the popup down the instant its permission dialog appears, so
  // handlePermissionsAdded (wired to permissions.onAdded) can win the race and
  // register the host before this call resumes. Losing that race must not throw
  // on the now-duplicate script id, and must not double the stored host.
  it("survives losing the race to its own onAdded backstop", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
    };

    const result = await addInstance("misskey.io", { permissions, scripting, storage });

    expect(result).toEqual({ added: true });
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });
});

describe("removeInstance", () => {
  it("drops the registration, the permission and the stored host together", async () => {
    const permissions = createFakePermissions(["https://misskey.io/*"]);
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({
        [MISSKEY_INSTANCES_KEY]: ["misskey.io", "other.example"]
      })
    };

    await removeInstance("misskey.io", { permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(false);
    expect(permissions.origins.has("https://misskey.io/*")).toBe(false);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["other.example"]);
  });

  // A previous removal that died partway through leaves no registration to drop.
  it("cleans up the permission and the storage anyway", async () => {
    const permissions = createFakePermissions(["https://misskey.io/*"]);
    const scripting = createFakeScripting();
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
    };

    await removeInstance("misskey.io", { permissions, scripting, storage });

    expect(permissions.origins.has("https://misskey.io/*")).toBe(false);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual([]);
  });
});

describe("handlePermissionsRemoved", () => {
  it("drops what the reader revoked from chrome://extensions", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({
        [MISSKEY_INSTANCES_KEY]: ["misskey.io", "other.example"]
      })
    };

    await handlePermissionsRemoved({ origins: ["https://misskey.io/*"] }, { scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(false);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["other.example"]);
  });

  it("leaves an unrelated revocation alone", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
    };

    await handlePermissionsRemoved({ origins: ["https://other.test/*"] }, { scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(true);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });
});

// The backstop for addInstance() losing its popup mid-flight.
describe("handlePermissionsAdded", () => {
  it("registers and stores a grant nothing else caught", async () => {
    const scripting = createFakeScripting();
    const storage = { sync: createFakeStorageArea() };

    await handlePermissionsAdded({ origins: ["https://misskey.io/*"] }, { scripting, storage });

    expect(scripting.scripts.get("misskey-misskey.io")).toEqual(registration);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });

  it("leaves a host addInstance() already finished alone", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
    };

    await handlePermissionsAdded({ origins: ["https://misskey.io/*"] }, { scripting, storage });

    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });

  it("adopts a registration whose storage write has not landed yet", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = { sync: createFakeStorageArea() };

    await handlePermissionsAdded({ origins: ["https://misskey.io/*"] }, { scripting, storage });

    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });

  it("registers nothing for a grant that is not one https host", async () => {
    const scripting = createFakeScripting();
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["kept.example"] })
    };

    await handlePermissionsAdded(
      { origins: ["<all_urls>", "https://example.com/path/*"] },
      { scripting, storage }
    );

    expect(scripting.scripts.size).toBe(0);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["kept.example"]);
  });

  // An empty onAdded payload should not occur, but guarding it costs nothing.
  it("does nothing for no origins at all", async () => {
    const scripting = createFakeScripting();
    const storage = { sync: createFakeStorageArea() };

    await handlePermissionsAdded({ origins: [] }, { scripting, storage });

    expect(scripting.scripts.size).toBe(0);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toBeUndefined();
  });
});

// browser.permissions can be revoked outside the extension, so what is stored and
// what is registered are reconciled against the grants at every startup.
describe("reconcileInstances", () => {
  it("re-registers a stored host whose registration was lost", async () => {
    const permissions = createFakePermissions(["https://misskey.io/*"]);
    const scripting = createFakeScripting();
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
    };

    await reconcileInstances({ permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(true);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["misskey.io"]);
  });

  it("drops a stored host whose permission was revoked while Sift was down", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
    };

    await reconcileInstances({ permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(false);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual([]);
  });

  // A removeInstance() that saved storage but died before unregistering.
  it("cleans up a registration with no stored host behind it", async () => {
    const permissions = createFakePermissions(["https://kept.example/*"]);
    const scripting = createFakeScripting([
      { id: "misskey-kept.example", matches: ["https://kept.example/*"] },
      { id: "misskey-orphan.example", matches: ["https://orphan.example/*"] }
    ]);
    const storage = {
      sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["kept.example"] })
    };

    await reconcileInstances({ permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-kept.example")).toBe(true);
    expect(scripting.scripts.has("misskey-orphan.example")).toBe(false);
    expect(storage.sync.state[MISSKEY_INSTANCES_KEY]).toEqual(["kept.example"]);
  });
});
