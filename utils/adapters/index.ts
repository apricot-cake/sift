// Sift が読み方を知っているサービス。1サービスにつき1アダプターで、content
// script は起動したページに対してそのうち1つだけを選び、あとはどれを選んだかに
// 関わらず同じループを回す。

import { blueskyAdapter } from "./bluesky.ts";
import { niconicoAdapter } from "./niconico.ts";
import { soundcloudAdapter } from "./soundcloud.ts";
import type { ServiceAdapter } from "./types.ts";
import { xAdapter } from "./x.ts";
import { youtubeAdapter } from "./youtube.ts";

export const ADAPTERS: readonly ServiceAdapter[] = Object.freeze([
  xAdapter,
  blueskyAdapter,
  youtubeAdapter,
  niconicoAdapter,
  soundcloudAdapter,
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
export function selectAdapter(hostname: string): ServiceAdapter | null {
  return (
    ADAPTERS.find((adapter) =>
      adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
    ) ?? null
  );
}
