import { ADAPTERS, selectAdapter } from "./adapters/index.ts";

// Sift が動くサイト。2度目の宣言をせずアダプターから導いてある＝Sift が読めない
// サービスは読み込み先にしてはならないし、対応する登録の無いアダプターは一度も
// 走らない。
export const SITE_MATCHES = ADAPTERS.flatMap((adapter) => [...adapter.matches]);

// サイドパネルなど、content script が届かない場所でも同じ対応範囲を判定する。
// アダプターの match は HTTPS のみなので、同名ホストを別スキームで通さない。
export function isSupportedSiteUrl(url: string | undefined): boolean {
  if (url === undefined) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && selectAdapter(parsed.hostname) !== null
    );
  } catch {
    return false;
  }
}
