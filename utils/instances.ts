// Misskey インスタンスの権限と、content script の動的な登録。
//
// Misskey はページ単位ではなく利用者単位で決まる＝読み手が追加するまで Sift は
// Misskey のホストへ一切注入しないし、要求するホスト権限も読み手が打ち込んだ
// ものだけ（host_permissions と決め打ちのインスタンスをどちらも退けた理由は
// #2 の Issue コメント第5節）。
//
// ホストを追加すると、そのオリジンちょうどを要求する＝optional_host_permissions
// （wxt.config.ts）で宣言したワイルドカードに対する
// browser.permissions.request()。許可されたら
// browser.scripting.registerContentScripts() で content script を登録し、指す先は
// WXT が静的な X / Bluesky 用のエントリ（entrypoints/content）に対して既に
// 作っているのと同じビルド済みファイル。Misskey 専用の content script は無い＝
// そこで選ばれるアダプターを存在させたのが #29。
//
// ここの関数はどれも permissions / scripting / storage を引数で受け取るので、
// テストは本物のブラウザではなく偽物を渡せる。

import type { Browser } from "wxt/browser";

export const MISSKEY_CONTENT_SCRIPT_FILES = Object.freeze({
  js: Object.freeze(["content-scripts/content.js"]),
  css: Object.freeze(["content-scripts/content.css"]),
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

// reconcileInstances() と権限のリスナーが登録から実際に読み戻すもの＝id より
// 先は一度も読まない。
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

// ホストの一覧を、このモジュールがそれに対して行う2つの操作として表したもの。
// 保管領域より狭くしてあるのは意図的＝一覧が実際にどこに置かれるかは
// utils/settings.ts の担当（保管された設定の1フィールド）で、ここはそれを
// 知る必要が無い。
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

// originForHost() の逆で、permissions.onAdded のためのもの＝Chrome がリスナーに
// 渡すのはホストではなくオリジンの文字列。そのまま信じず
// normalizeInstanceHost() を通し直すので、このモジュールが作ったのではない
// オリジン（将来の機能が許可させたものや、Chrome が静的な host_permissions を
// 足し直したもの）は、ゴミを登録する代わりに無視される。
function hostForOrigin(origin: string): string | null {
  const match = /^https:\/\/([^/]+)\/\*$/.exec(origin);
  return match ? normalizeInstanceHost(match[1]) : null;
}

export function registrationIdForHost(host: string): string {
  return `${REGISTRATION_ID_PREFIX}${host}`;
}

// 受け取るのは、裸のホスト名（"misskey.io"）か、ホストから先に何も付かない
// 完全な https の URL＝経路もクエリも断片も資格情報もポートも無いもの。それ
// 以外が、受け入れ条件の言う「URL でない・経路やクエリを持つ・http」に当たる＝
// URL でない文字列は URL の解析で落ち、http はプロトコルの検査で落ち、経路と
// クエリは pathname / search の検査で落ちる。ポートも拒む。上のどこもそれを
// 求めていないが、Chrome の match パターンはポートを表せないので、残すと
// 画面には打ち込まれたホストだけが出たまま、そのホストの全ポートを黙って
// 許可することになる。
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
    // Chrome の既定値を明示的に書いたもの＝登録は、このモジュールが登録し直さ
    // なくてもブラウザの再起動を越えて残らなければならない（その既定値だけでは
    // 足りない場合の受け皿が reconcileInstances）。
    persistAcrossSessions: true,
  };
}

// そのホストが要るオリジン1つを要求し、利用者が許可した場合に限って content
// script を登録し、ホストを保管庫へ足す。利用者の操作の中（クリックのハンドラ）
// から呼ばなければならない＝そうでないと browser.permissions.request() が拒む。
// だから background へメッセージで中継するとその操作が失われる＝サイドパネルが
// 直接呼んでいる。
export async function addInstance(
  host: string,
  { permissions, scripting, storage }: InstanceDeps,
): Promise<AddInstanceResult> {
  const normalizedHost = normalizeInstanceHost(host);
  if (normalizedHost === null) {
    return { added: false, reason: "invalid-host" };
  }

  const instances = await storage.getInstances();
  if (instances.includes(normalizedHost)) {
    // 既に追加済み。要求し直しても黙って再許可されるだけだし（Chrome は既に
    // 持っているオリジンを訊き直さない）、登録し直せば重複した id で例外に
    // なるので、ここですることは何も残っていない。
    return { added: true };
  }

  const granted = await permissions.request({
    origins: [originForHost(normalizedHost)],
  });
  if (!granted) {
    return { added: false, reason: "permission-denied" };
  }

  // 権限を許可した後に画面が終了しても、background の
  // browser.permissions.onAdded に繋いだ handlePermissionsAdded が登録を
  // 引き受ける。その受け皿がこの行より先にこのホストを登録しうるので、下の
  // 検査は最適化ではない＝これが無いと、重複した script の id でこの呼び出しが
  // 例外になる。
  const registrationId = registrationIdForHost(normalizedHost);
  const alreadyRegistered = (
    await scripting.getRegisteredContentScripts()
  ).some((script) => script.id === registrationId);
  if (!alreadyRegistered) {
    await scripting.registerContentScripts([
      contentScriptDefinition(normalizedHost),
    ]);
  }

  const current = await storage.getInstances();
  if (!current.includes(normalizedHost)) {
    await storage.setInstances([...current, normalizedHost]);
  }

  return { added: true };
}

// 保管庫からホストを落とす前に、登録と権限を先に落とす＝途中で失敗しても、
// 画面がもう見せていない権限を黙って持ち続けるのではなく、ホストが一覧に
// 残っている状態になる。
export async function removeInstance(
  host: string,
  { permissions, scripting, storage }: InstanceDeps,
): Promise<void> {
  await scripting
    .unregisterContentScripts({ ids: [registrationIdForHost(host)] })
    .catch(() => {
      // 登録されていない＝例えば前回の削除がこの手順の途中で死んだ場合。
    });
  await permissions.remove({ origins: [originForHost(host)] });

  const instances = await storage.getInstances();
  await storage.setInstances(instances.filter((existing) => existing !== host));
}

// background のエントリポイントで browser.permissions.onAdded に繋いである。
// これは下の handlePermissionsRemoved の鏡というより、addInstance() 自身の
// 受け皿＝Chrome は許可が下りた瞬間にこれを発火させる。permissions.request()
// を呼んだサイドパネルが自分の答えに反応できるまで生きているかどうかとは無関係に
// （addInstance() の中のコメントを参照）。発火するのは service worker が
// それを聞けるだけ生きている間だけだが、Sift が動いていない間に許可が下りる
// ことは起きない＝これらのオリジンを要求するのは addInstance() だけで、
// その呼び出しはサイドパネルのメッセージポートを保つ service worker が既に立って
// いなければ走れないから。
export async function handlePermissionsAdded(
  addedPermissions: { origins?: string[] } | undefined,
  { scripting, storage }: Pick<InstanceDeps, "scripting" | "storage">,
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

// background のエントリポイントで browser.permissions.onRemoved に繋いである＝
// 読み手は removeInstance を通らずに chrome://extensions から直接ホストの権限を
// 取り消せるので、登録と保管したホストがそれより長生きしてはならない。発火する
// のは service worker がそれを聞けるだけ生きている間だけで、そうでなかった間に
// 空いた穴は下の reconcileInstances() が埋める。
export async function handlePermissionsRemoved(
  removedPermissions: { origins?: string[] } | undefined,
  { scripting, storage }: Pick<InstanceDeps, "scripting" | "storage">,
): Promise<void> {
  const removedOrigins = new Set(removedPermissions?.origins ?? []);
  if (removedOrigins.size === 0) {
    return;
  }

  const instances = await storage.getInstances();
  const removedHosts = instances.filter((host) =>
    removedOrigins.has(originForHost(host)),
  );
  if (removedHosts.length === 0) {
    return;
  }

  await scripting
    .unregisterContentScripts({ ids: removedHosts.map(registrationIdForHost) })
    .catch(() => {
      // 既に登録が外れている。
    });

  await storage.setInstances(
    instances.filter((host) => !removedHosts.includes(host)),
  );
}

// 登録の集合を、保管庫と、Chrome が実際にまだ持っている権限の両方へ合わせ直す。
// 起動時に一度呼ばれ、ずれが生じる3つの経路を埋める＝Sift が
// permissions.onRemoved を聞けるだけ動いていない間に chrome://extensions から
// 取り消された権限、拡張機能の更新をまたいで失われた登録、そして権限は取れた
// のに登録する前に死んだ前回の addInstance()。
export async function reconcileInstances({
  permissions,
  scripting,
  storage,
}: InstanceDeps): Promise<void> {
  const instances = await storage.getInstances();
  const registered = await scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((script) => script.id));

  const kept: string[] = [];
  const idsToUnregister: string[] = [];

  for (const host of instances) {
    const hasPermission = await permissions.contains({
      origins: [originForHost(host)],
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

  // ホストが保管庫にもう無い登録（例えば、保管庫は書けたのに登録を外す前に
  // 死んだ removeInstance()）。
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
