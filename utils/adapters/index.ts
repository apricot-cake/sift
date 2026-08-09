// Sift が読み方を知っているサービス。1サービスにつき1アダプターで、content
// script は起動したページに対してそのうち1つだけを選び、あとはどれを選んだかに
// 関わらず同じループを回す。
import { blueskyAdapter } from "./bluesky.ts";
import { isMisskeyPage, misskeyAdapter } from "./misskey.ts";
import type { ServiceAdapter } from "./types.ts";
import { xAdapter } from "./x.ts";

export const ADAPTERS: readonly ServiceAdapter[] = Object.freeze([
  xAdapter,
  blueskyAdapter,
  misskeyAdapter,
]);

// Chrome の match パターンのホスト部＝"*" なら任意、"*.example.com" ならその
// ドメインとサブドメイン、それ以外はホスト名そのもの。
export function hostMatchesPattern(pattern: string, hostname: string): boolean {
  const afterScheme = pattern.slice(pattern.indexOf("://") + 3);
  const host = afterScheme.slice(0, afterScheme.indexOf("/"));

  if (host === "*") {
    return true;
  }
  if (host.startsWith("*.")) {
    const domain = host.slice(2);
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }
  return hostname === host;
}

// どのアダプターも名乗り出ないページでは null。content script 自身の登録が
// 既にそういうページから遠ざけているので、これは同じことを二度目に成り立たせる
// ためのもの＝manifest を通らない注入経路のために要る。
//
// ホストがビルド時に分かっているサービスは、ホストだけで決まる。Misskey は
// そうではなく、利用者が1つずつ追加し、そもそも Sift がそのページで動いている
// 理由がそのホスト向けに行った登録そのもの（utils/instances.ts）。それでも
// ページ側が Misskey だと名乗るまで Misskey として読まない＝間違って追加された
// ホストは、そのために書かれたのではないセレクタで読まれるのではなく、何も
// 起きないで済む。
export function selectAdapter(
  hostname: string,
  page: ParentNode,
): ServiceAdapter | null {
  const declared = ADAPTERS.find((adapter) =>
    adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
  );
  if (declared) {
    return declared;
  }

  return isMisskeyPage(page) ? misskeyAdapter : null;
}
