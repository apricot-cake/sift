// The services Sift knows how to read. One adapter per service; the content
// script picks exactly one of them for the page it woke up on and then runs the
// same loop regardless of which it got.
import { blueskyAdapter } from "./bluesky.ts";
import { isMisskeyPage, misskeyAdapter } from "./misskey.ts";
import type { ServiceAdapter } from "./types.ts";
import { xAdapter } from "./x.ts";

export const ADAPTERS: readonly ServiceAdapter[] = Object.freeze([
  xAdapter,
  blueskyAdapter,
  misskeyAdapter
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

// null on a page no adapter claims. The content script's own registration keeps
// it off those pages already; this is what makes that true a second time, for
// the injection paths that do not go through the manifest.
//
// The host alone decides for a service whose hosts are known at build time.
// Misskey's are not — the reader adds them one at a time, and the only reason
// Sift is running on such a page at all is a registration it made for that host
// (utils/instances.ts). The page still has to say it is Misskey before it is
// read as one, so a host added by mistake does nothing rather than being read
// through selectors that were never meant for it.
export function selectAdapter(
  hostname: string,
  page: ParentNode
): ServiceAdapter | null {
  const declared = ADAPTERS.find((adapter) =>
    adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname))
  );
  if (declared) {
    return declared;
  }

  return isMisskeyPage(page) ? misskeyAdapter : null;
}
