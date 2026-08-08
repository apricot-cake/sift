import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { SITE_MATCHES } from "../site-matches.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { ADAPTERS, hostMatchesPattern, selectAdapter } from "./index.ts";
import { isMisskeyPage, misskeyAdapter } from "./misskey.ts";
import { xAdapter } from "./x.ts";

// What a Misskey instance writes into the page the server sends, before any of
// the client runs — and a page that says nothing about itself.
const misskeyPage = render('<meta name="application-name" content="Misskey">');
const otherPage = render("<div>a page like any other</div>");

describe("picking the adapter for a page", () => {
  it("answers for each adapter's own patterns and for no other's", () => {
    for (const adapter of ADAPTERS) {
      for (const pattern of adapter.matches) {
        const host = pattern
          .slice(pattern.indexOf("://") + 3)
          .replace(/\/.*$/, "")
          .replace(/^\*\./, "");

        expect(selectAdapter(host, otherPage), `${pattern} selects ${adapter.id}`).toBe(
          adapter
        );
      }
    }
  });

  it("routes the hosts Sift is registered for", () => {
    expect(selectAdapter("x.com", otherPage)).toBe(xAdapter);
    expect(selectAdapter("twitter.com", otherPage)).toBe(xAdapter);
    expect(selectAdapter("bsky.app", otherPage)).toBe(blueskyAdapter);
  });

  it("claims nothing on a host no adapter declares", () => {
    expect(selectAdapter("notx.com", otherPage)).toBeNull();
    // A match pattern without the "*." prefix does not cover subdomains.
    expect(selectAdapter("mobile.x.com", otherPage)).toBeNull();
  });

  // Misskey has no declared host: a page is read as Misskey when the page itself
  // says so, which is the only claim available for a host the reader added.
  it("reads a page as Misskey only when the page says it is one", () => {
    expect(selectAdapter("misskey.example", misskeyPage)).toBe(misskeyAdapter);
    expect(selectAdapter("misskey.example", otherPage)).toBeNull();
  });

  it("never re-reads a declared service as Misskey, whatever the page claims", () => {
    expect(selectAdapter("x.com", misskeyPage)).toBe(xAdapter);
  });
});

describe("isMisskeyPage", () => {
  it("reads the tag the server writes, and nothing else", () => {
    expect(isMisskeyPage(misskeyPage)).toBe(true);
    expect(isMisskeyPage(otherPage)).toBe(false);
  });

  it("is not fooled by a page naming another application", () => {
    expect(isMisskeyPage(render('<meta name="application-name" content="Mastodon">'))).toBe(
      false
    );
  });

  // Nothing for the manifest to declare at build time: the hosts are the
  // reader's, added one at a time and registered at runtime.
  it("is the only route to the Misskey adapter, which declares no host", () => {
    expect(misskeyAdapter.matches).toEqual([]);
  });
});

describe("hostMatchesPattern", () => {
  it("covers a domain and its subdomains behind the wildcard", () => {
    expect(hostMatchesPattern("https://*.example.com/*", "example.com")).toBe(true);
    expect(hostMatchesPattern("https://*.example.com/*", "a.example.com")).toBe(true);
    expect(hostMatchesPattern("https://*.example.com/*", "notexample.com")).toBe(false);
  });

  it("covers everything behind the bare wildcard", () => {
    expect(hostMatchesPattern("https://*/*", "anything.test")).toBe(true);
  });
});

describe("the sites the manifest registers", () => {
  // A service Sift cannot read must not be a page it loads into, and an adapter
  // with no matching registration would never run.
  it("is derived from the adapters rather than declared a second time", () => {
    expect(SITE_MATCHES).toEqual(ADAPTERS.flatMap((adapter) => [...adapter.matches]));
  });
});
