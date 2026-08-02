// The services Sift knows how to read. One adapter per service; the content
// script picks exactly one of them from the host name and then runs the same
// loop regardless of which it got.
import { xAdapter } from "./x.js";

export const ADAPTERS = Object.freeze([xAdapter]);

// Chrome's match-pattern host: "*" for any, "*.example.com" for a domain and
// its subdomains, or a literal host.
export function hostMatchesPattern(pattern, hostname) {
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
export function selectAdapter(hostname) {
  return (
    ADAPTERS.find((adapter) =>
      adapter.matches.some((pattern) => hostMatchesPattern(pattern, hostname))
    ) ?? null
  );
}
