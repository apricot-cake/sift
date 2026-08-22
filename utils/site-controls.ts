// ポップアップが切り替えを出せるホスト。X と Bluesky は manifest に静的に含まれ、
// Misskey は既定ホストか、利用者が追加したホストにだけ届く。
import { ADAPTERS, hostMatchesPattern } from "./adapters/index.ts";
import { MISSKEY_HOSTS } from "./misskey-hosts.ts";
import type { SiteSettingsKey } from "./settings.ts";

export function isSiteControlAvailable(hostname: string): boolean {
  return (
    ADAPTERS.some((adapter) =>
      adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
    ) || MISSKEY_HOSTS.includes(hostname)
  );
}

export function siteSettingsKeyForControl(
  hostname: string,
): SiteSettingsKey | null {
  const declared = ADAPTERS.find((adapter) =>
    adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
  );
  if (declared) {
    return declared.settingsKey;
  }
  return MISSKEY_HOSTS.includes(hostname) ? "misskey" : null;
}
