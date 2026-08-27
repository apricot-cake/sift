// サイドパネルが切り替えを出せるホスト。
import { ADAPTERS, hostMatchesPattern } from "./adapters/index.ts";
import type { SiteSettingsKey } from "./settings.ts";

export function isSiteControlAvailable(hostname: string): boolean {
  return ADAPTERS.some((adapter) =>
    adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
  );
}

export function siteSettingsKeyForControl(
  hostname: string,
): SiteSettingsKey | null {
  const adapter = ADAPTERS.find((adapter) =>
    adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
  );
  return adapter?.settingsKey ?? null;
}
