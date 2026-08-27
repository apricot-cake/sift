import { describe, expect, it } from "vitest";
import { SITE_MATCHES } from "./site-matches.ts";

describe("SITE_MATCHES", () => {
  it("ビルド時に決まるサービスのホストを持つ", () => {
    expect(SITE_MATCHES).toEqual(
      expect.arrayContaining([
        "https://x.com/*",
        "https://twitter.com/*",
        "https://bsky.app/*",
        "https://www.youtube.com/*",
        "https://www.nicovideo.jp/*",
        "https://soundcloud.com/*",
      ]),
    );
  });

  it("Weibo を配布先に含めない", () => {
    expect(SITE_MATCHES).not.toContain("https://weibo.com/*");
  });
});
