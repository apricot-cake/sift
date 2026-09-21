import { describe, expect, it } from "vitest";
import { isSupportedSiteUrl, SITE_MATCHES } from "./site-matches.ts";

describe("SITE_MATCHES", () => {
  it("ビルド時に決まるサービスのホストを持つ", () => {
    expect(SITE_MATCHES).toEqual(
      expect.arrayContaining([
        "https://x.com/*",
        "https://twitter.com/*",
        "https://bsky.app/*",
        "https://www.youtube.com/*",
        "https://www.nicovideo.jp/*",
      ]),
    );
  });

  it("廃止したSoundCloudを配布先に含めない", () => {
    expect(SITE_MATCHES).not.toContain("https://soundcloud.com/*");
  });

  it("Weibo を配布先に含めない", () => {
    expect(SITE_MATCHES).not.toContain("https://weibo.com/*");
  });

  it("対応サイトの HTTPS URL だけをサイドパネルの対象にする", () => {
    expect(isSupportedSiteUrl("https://x.com/home")).toBe(true);
    expect(isSupportedSiteUrl("https://www.youtube.com/watch?v=test")).toBe(
      true,
    );
    expect(isSupportedSiteUrl("http://x.com/home")).toBe(false);
    expect(isSupportedSiteUrl("https://example.com/")).toBe(false);
    expect(isSupportedSiteUrl(undefined)).toBe(false);
  });
});
