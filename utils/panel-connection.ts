import { isSupportedSiteUrl } from "./site-matches.ts";

// URL を読めない場合は activeTab 未許可の可能性がある。対象外とは断定しない。
export function isKnownUnsupportedSite(url: string | undefined): boolean {
  return Boolean(url) && !isSupportedSiteUrl(url);
}
