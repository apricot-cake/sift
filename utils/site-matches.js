import { ADAPTERS } from "./adapters/index.js";

// The sites Sift runs on. Derived from the adapters rather than declared a
// second time: a service Sift cannot read must not be a page it loads into, and
// an adapter with no matching registration would never run.
export const SITE_MATCHES = ADAPTERS.flatMap((adapter) => [...adapter.matches]);
