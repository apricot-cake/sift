import { describe, expect, it } from "vitest";
import { SITE_MATCHES } from "../site-matches.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { ADAPTERS, hostMatchesPattern, selectAdapter } from "./index.ts";
import { niconicoAdapter } from "./niconico.ts";
import { soundcloudAdapter } from "./soundcloud.ts";
import { xAdapter } from "./x.ts";
import { youtubeAdapter } from "./youtube.ts";

describe("ページに対してアダプターを選ぶ", () => {
  it("各アダプターは自分のパターンにだけ答え、他のパターンには答えない", () => {
    for (const adapter of ADAPTERS) {
      for (const pattern of adapter.matches) {
        const host = pattern
          .slice(pattern.indexOf("://") + 3)
          .replace(/\/.*$/, "")
          .replace(/^\*\./, "");

        expect(selectAdapter(host), `${pattern} が ${adapter.id} を選ぶ`).toBe(
          adapter,
        );
      }
    }
  });

  it("Sift が登録されているホストを振り分ける", () => {
    expect(selectAdapter("x.com")).toBe(xAdapter);
    expect(selectAdapter("twitter.com")).toBe(xAdapter);
    expect(selectAdapter("bsky.app")).toBe(blueskyAdapter);
    expect(selectAdapter("www.youtube.com")).toBe(youtubeAdapter);
    expect(selectAdapter("www.nicovideo.jp")).toBe(niconicoAdapter);
    expect(selectAdapter("soundcloud.com")).toBe(soundcloudAdapter);
    expect(selectAdapter("weibo.com")).toBeNull();
  });

  it("どのアダプターも宣言していないホストでは何も名乗り出ない", () => {
    expect(selectAdapter("notx.com")).toBeNull();
    // "*." の付かない match パターンはサブドメインを含まない。
    expect(selectAdapter("mobile.x.com")).toBeNull();
  });
});

describe("hostMatchesPattern", () => {
  it("ワイルドカードの下でドメインとそのサブドメインを含む", () => {
    expect(hostMatchesPattern("https://*.example.com/*", "example.com")).toBe(
      true,
    );
    expect(hostMatchesPattern("https://*.example.com/*", "a.example.com")).toBe(
      true,
    );
    expect(
      hostMatchesPattern("https://*.example.com/*", "notexample.com"),
    ).toBe(false);
  });

  it("裸のワイルドカードの下では全部を含む", () => {
    expect(hostMatchesPattern("https://*/*", "anything.test")).toBe(true);
  });
});

describe("manifest が登録するサイト", () => {
  it("二度目の宣言ではなくアダプターから導出されている", () => {
    expect(SITE_MATCHES).toEqual(
      ADAPTERS.flatMap((adapter) => [...adapter.matches]),
    );
  });
});
