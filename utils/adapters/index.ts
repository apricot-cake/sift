// The services Sift knows how to read. One adapter per service; the content
// script picks exactly one of them from the host name and then runs the same
// loop regardless of which it got.
import { blueskyAdapter } from "./bluesky.ts";
import type { ServiceAdapter } from "./types.ts";
import { xAdapter } from "./x.ts";

export const ADAPTERS: readonly ServiceAdapter[] = Object.freeze([
  xAdapter,
  blueskyAdapter
]);

// Chrome's match-pattern host: "*" for any, "*.example.com" for a domain and
// its subdomains, or a literal host.
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

// null on a host no adapter claims. The content script's own registration keeps
// it off those pages already; this is what makes that true a second time, for
// the injection paths that do not go through the manifest.
export function selectAdapter(hostname: string): ServiceAdapter | null {
  return (
    ADAPTERS.find((adapter) =>
      adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname))
    ) ?? null
  );
}
