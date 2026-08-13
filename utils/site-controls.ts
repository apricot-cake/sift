// ポップアップが切り替えを出せるホスト。X と Bluesky は manifest に静的に含まれ、
// Misskey は既定ホストか、利用者が追加したホストにだけ届く。
import { ADAPTERS, hostMatchesPattern } from "./adapters/index.ts";
import { DEFAULT_MISSKEY_HOSTS } from "./default-instances.ts";
import type { Settings } from "./settings.ts";

export function isSiteControlAvailable(
  hostname: string,
  settings: Pick<Settings, "misskeyInstances">,
): boolean {
  return (
    ADAPTERS.some((adapter) =>
      adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname)),
    ) ||
    DEFAULT_MISSKEY_HOSTS.includes(hostname) ||
    settings.misskeyInstances.includes(hostname)
  );
}
