import { describe, expect, it } from "vitest";
import {
  addInstance,
  handlePermissionsAdded,
  handlePermissionsRemoved,
  MISSKEY_CONTENT_SCRIPT_FILES,
  normalizeInstanceHost,
  originForHost,
  type RegisteredContentScript,
  reconcileInstances,
  registrationIdForHost,
  removeInstance,
} from "./instances.ts";

// browser.permissions を、許可されたオリジンの集合として表したもの。
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
    },
  };
}

// この偽物が保つ形での、登録済みのスクリプト。本物の RegisteredContentScript
// より緩い＝下のテストが getRegisteredContentScripts() に与える種は、`id` と、
// 時々 `matches` しか持たない。
interface FakeRegisteredScript {
  id: string;
  matches?: string[];
  js?: string[];
  css?: string[];
  runAt?: string;
  persistAcrossSessions?: boolean;
}

// browser.scripting。重複した id も、一度も登録していないものの登録解除も
// 拒む＝どちらもコード側が踏み込まずに避けなければならないもの。
function createFakeScripting(initialScripts: FakeRegisteredScript[] = []) {
  const scripts = new Map<string, FakeRegisteredScript>(
    initialScripts.map((script) => [script.id, script]),
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
    },
  };
}

// utils/settings.ts が渡してくる形でのホストの一覧。触られていない一覧と、
// 変わらないまま書き戻された一覧を見分けるのが `writes`＝「何も保管しない」と
// いう主張は書き込みについてのもので、値についてのものではない。
function createFakeInstanceStorage(initialHosts: string[] = []) {
  let hosts = [...initialHosts];
  let writes = 0;
  return {
    get hosts() {
      return hosts;
    },
    get writes() {
      return writes;
    },
    async getInstances() {
      return [...hosts];
    },
    async setInstances(next: string[]) {
      hosts = [...next];
      writes += 1;
    },
  };
}

const registration = {
  id: "misskey-misskey.io",
  matches: ["https://misskey.io/*"],
  js: [...MISSKEY_CONTENT_SCRIPT_FILES.js],
  css: [...MISSKEY_CONTENT_SCRIPT_FILES.css],
  runAt: "document_idle",
  persistAcrossSessions: true,
};

describe("normalizeInstanceHost", () => {
  it("読み手がどう打ち込んでもホストとして受け取る", () => {
    expect(normalizeInstanceHost("misskey.io")).toBe("misskey.io");
    expect(normalizeInstanceHost("https://misskey.io")).toBe("misskey.io");
    expect(normalizeInstanceHost("https://misskey.io/")).toBe("misskey.io");
    expect(normalizeInstanceHost("  misskey.io  ")).toBe("misskey.io");
  });

  it("ホストでないものは拒む", () => {
    expect(normalizeInstanceHost("not a host")).toBeNull();
    expect(normalizeInstanceHost("")).toBeNull();
    expect(normalizeInstanceHost(null)).toBeNull();
  });

  it("ホスト1つより狭いものも広いものも拒む", () => {
    expect(normalizeInstanceHost("https://misskey.io/notes/1")).toBeNull();
    expect(normalizeInstanceHost("misskey.io/notes/1")).toBeNull();
    expect(normalizeInstanceHost("https://misskey.io/?q=1")).toBeNull();
    // https ではなく http。
    expect(normalizeInstanceHost("http://misskey.io")).toBeNull();
    // ポート＝match パターンはこれを表せない。
    expect(normalizeInstanceHost("misskey.io:8080")).toBeNull();
  });
});

describe("インスタンス1つの形", () => {
  it("オリジン1つと登録 id 1つ", () => {
    expect(originForHost("misskey.io")).toBe("https://misskey.io/*");
    expect(registrationIdForHost("misskey.io")).toBe("misskey-misskey.io");
  });
});

describe("addInstance", () => {
  it("読み手が権限を拒んだら、登録も保管もしない", async () => {
    const permissions = createFakePermissions();
    permissions.request = async () => false;
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage();

    const result = await addInstance("misskey.io", {
      permissions,
      scripting,
      storage,
    });

    expect(result).toEqual({ added: false, reason: "permission-denied" });
    expect(scripting.scripts.size).toBe(0);
    expect(storage.writes).toBe(0);
  });

  it("正しくないホストは、何かを訊く前に拒む", async () => {
    const permissions = createFakePermissions();
    let requested = false;
    permissions.request = async () => {
      requested = true;
      return true;
    };
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage();

    const result = await addInstance("http://misskey.io", {
      permissions,
      scripting,
      storage,
    });

    expect(result).toEqual({ added: false, reason: "invalid-host" });
    expect(requested).toBe(false);
  });

  it("静的な content script と同じビルド済みファイルを登録する", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage();

    const result = await addInstance("misskey.io", {
      permissions,
      scripting,
      storage,
    });

    expect(result).toEqual({ added: true });
    expect(permissions.origins.has("https://misskey.io/*")).toBe(true);
    expect(scripting.scripts.get("misskey-misskey.io")).toEqual(registration);
    expect(storage.hosts).toEqual(["misskey.io"]);
  });

  it("追加済みのホストには何もしない", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage();
    await addInstance("misskey.io", { permissions, scripting, storage });

    // 権限を要求し直しもしないし、重複することになる script の id を登録
    // しようともしない＝どちらも例外になる。
    permissions.request = async () => {
      throw new Error("既に許可されたオリジンを要求し直してはならない");
    };
    const repeated = await addInstance("misskey.io", {
      permissions,
      scripting,
      storage,
    });

    expect(repeated).toEqual({ added: true });
    expect(storage.hosts).toEqual(["misskey.io"]);
  });

  // Chrome は権限のダイアログが出た瞬間に popup を壊すので、permissions.onAdded
  // に繋いである handlePermissionsAdded が競争に勝ち、この呼び出しが再開する前に
  // ホストを登録しうる。負けた側は、重複することになる script の id で例外に
  // なってはならないし、保管したホストを二重にしてもならない。
  it("自分の onAdded の受け皿に競争で負けても壊れない", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage(["misskey.io"]);

    const result = await addInstance("misskey.io", {
      permissions,
      scripting,
      storage,
    });

    expect(result).toEqual({ added: true });
    expect(storage.hosts).toEqual(["misskey.io"]);
  });
});

describe("removeInstance", () => {
  it("登録・権限・保管したホストをまとめて落とす", async () => {
    const permissions = createFakePermissions(["https://misskey.io/*"]);
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage(["misskey.io", "other.example"]);

    await removeInstance("misskey.io", { permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(false);
    expect(permissions.origins.has("https://misskey.io/*")).toBe(false);
    expect(storage.hosts).toEqual(["other.example"]);
  });

  // 途中で死んだ前回の削除は、落とすべき登録を残していない。
  it("それでも権限と保管庫は片付ける", async () => {
    const permissions = createFakePermissions(["https://misskey.io/*"]);
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage(["misskey.io"]);

    await removeInstance("misskey.io", { permissions, scripting, storage });

    expect(permissions.origins.has("https://misskey.io/*")).toBe(false);
    expect(storage.hosts).toEqual([]);
  });
});

describe("handlePermissionsRemoved", () => {
  it("読み手が chrome://extensions から取り消したものを落とす", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage(["misskey.io", "other.example"]);

    await handlePermissionsRemoved(
      { origins: ["https://misskey.io/*"] },
      { scripting, storage },
    );

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(false);
    expect(storage.hosts).toEqual(["other.example"]);
  });

  it("関係のない取り消しには手を出さない", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage(["misskey.io"]);

    await handlePermissionsRemoved(
      { origins: ["https://other.test/*"] },
      { scripting, storage },
    );

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(true);
    expect(storage.hosts).toEqual(["misskey.io"]);
    expect(storage.writes).toBe(0);
  });
});

// addInstance() が途中で popup を失った場合の受け皿。
describe("handlePermissionsAdded", () => {
  it("他の誰も捕まえなかった許可を登録して保管する", async () => {
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage();

    await handlePermissionsAdded(
      { origins: ["https://misskey.io/*"] },
      { scripting, storage },
    );

    expect(scripting.scripts.get("misskey-misskey.io")).toEqual(registration);
    expect(storage.hosts).toEqual(["misskey.io"]);
  });

  it("addInstance() が既に片付けたホストには手を出さない", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage(["misskey.io"]);

    await handlePermissionsAdded(
      { origins: ["https://misskey.io/*"] },
      { scripting, storage },
    );

    expect(storage.hosts).toEqual(["misskey.io"]);
    expect(storage.writes).toBe(0);
  });

  it("保管庫への書き込みがまだ届いていない登録を引き取る", async () => {
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage();

    await handlePermissionsAdded(
      { origins: ["https://misskey.io/*"] },
      { scripting, storage },
    );

    expect(storage.hosts).toEqual(["misskey.io"]);
  });

  it("https ホスト1つでない許可には何も登録しない", async () => {
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage(["kept.example"]);

    await handlePermissionsAdded(
      { origins: ["<all_urls>", "https://example.com/path/*"] },
      { scripting, storage },
    );

    expect(scripting.scripts.size).toBe(0);
    expect(storage.hosts).toEqual(["kept.example"]);
    expect(storage.writes).toBe(0);
  });

  // 空の onAdded が来ることは無いはずだが、守っておく分には何も要らない。
  it("オリジンが1つも無ければ何もしない", async () => {
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage();

    await handlePermissionsAdded({ origins: [] }, { scripting, storage });

    expect(scripting.scripts.size).toBe(0);
    expect(storage.writes).toBe(0);
  });
});

// browser.permissions は拡張機能の外から取り消されうるので、保管しているものと
// 登録しているものを、起動のたびに実際の許可へ合わせ直す。
describe("reconcileInstances", () => {
  it("登録が失われた保管済みのホストを登録し直す", async () => {
    const permissions = createFakePermissions(["https://misskey.io/*"]);
    const scripting = createFakeScripting();
    const storage = createFakeInstanceStorage(["misskey.io"]);

    await reconcileInstances({ permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(true);
    expect(storage.hosts).toEqual(["misskey.io"]);
  });

  it("Sift が止まっている間に権限を取り消されたホストを落とす", async () => {
    const permissions = createFakePermissions();
    const scripting = createFakeScripting([
      { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] },
    ]);
    const storage = createFakeInstanceStorage(["misskey.io"]);

    await reconcileInstances({ permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-misskey.io")).toBe(false);
    expect(storage.hosts).toEqual([]);
  });

  // 保管庫は書けたのに、登録を外す前に死んだ removeInstance()。
  it("後ろに保管されたホストが無い登録を片付ける", async () => {
    const permissions = createFakePermissions(["https://kept.example/*"]);
    const scripting = createFakeScripting([
      { id: "misskey-kept.example", matches: ["https://kept.example/*"] },
      { id: "misskey-orphan.example", matches: ["https://orphan.example/*"] },
    ]);
    const storage = createFakeInstanceStorage(["kept.example"]);

    await reconcileInstances({ permissions, scripting, storage });

    expect(scripting.scripts.has("misskey-kept.example")).toBe(true);
    expect(scripting.scripts.has("misskey-orphan.example")).toBe(false);
    expect(storage.hosts).toEqual(["kept.example"]);
  });
});
