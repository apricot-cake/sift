import { describe, expect, it } from "vitest";
import { SITE_MATCHES } from "./site-matches.ts";

describe("SITE_MATCHES", () => {
  it("ビルド時に決まるサービスのホストを持つ", () => {
    expect(SITE_MATCHES).toEqual(
      expect.arrayContaining([
        "https://x.com/*",
        "https://twitter.com/*",
        "https://bsky.app/*",
      ]),
    );
  });

  // misskey.io だけは、他の Misskey ホストと違ってここに載る（#41）。
  // misskeyAdapter.matches 自身は空のまま＝他のホストは利用者が実行時に追加する
  // ので、その静的な一覧には現れない。
  it("misskey.io を既定の静的ホストとして持つ", () => {
    expect(SITE_MATCHES).toContain("https://misskey.io/*");
  });
});
