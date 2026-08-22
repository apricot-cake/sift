import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { MISSKEY_HOSTS, originForHost } from "../misskey-hosts.ts";
import { SITE_MATCHES } from "../site-matches.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { ADAPTERS, hostMatchesPattern, selectAdapter } from "./index.ts";
import { isMisskeyPage, misskeyAdapter } from "./misskey.ts";
import { xAdapter } from "./x.ts";

// Misskey のインスタンスが、クライアントが動く前のサーバー応答の時点でページへ
// 書き込むもの。それと、自分について何も名乗らないページ。
const misskeyPage = render('<meta name="application-name" content="Misskey">');
const otherPage = render("<div>どこにでもあるページ</div>");

describe("ページに対してアダプターを選ぶ", () => {
  it("各アダプターは自分のパターンにだけ答え、他のパターンには答えない", () => {
    for (const adapter of ADAPTERS) {
      for (const pattern of adapter.matches) {
        const host = pattern
          .slice(pattern.indexOf("://") + 3)
          .replace(/\/.*$/, "")
          .replace(/^\*\./, "");

        expect(
          selectAdapter(host, otherPage),
          `${pattern} が ${adapter.id} を選ぶ`,
        ).toBe(adapter);
      }
    }
  });

  it("Sift が登録されているホストを振り分ける", () => {
    expect(selectAdapter("x.com", otherPage)).toBe(xAdapter);
    expect(selectAdapter("twitter.com", otherPage)).toBe(xAdapter);
    expect(selectAdapter("bsky.app", otherPage)).toBe(blueskyAdapter);
  });

  it("どのアダプターも宣言していないホストでは何も名乗り出ない", () => {
    expect(selectAdapter("notx.com", otherPage)).toBeNull();
    // "*." の付かない match パターンはサブドメインを含まない。
    expect(selectAdapter("mobile.x.com", otherPage)).toBeNull();
  });

  it("対応ホストが自分で名乗ったときだけ Misskey として読む", () => {
    expect(selectAdapter("misskey.io", misskeyPage)).toBe(misskeyAdapter);
    expect(selectAdapter("misskey.io", otherPage)).toBeNull();
    expect(selectAdapter("misskey.example", misskeyPage)).toBeNull();
  });

  it("宣言済みのサービスは、ページが何と名乗っても Misskey として読み直さない", () => {
    expect(selectAdapter("x.com", misskeyPage)).toBe(xAdapter);
  });
});

describe("isMisskeyPage", () => {
  it("サーバーが書き出すタグだけを読む", () => {
    expect(isMisskeyPage(misskeyPage)).toBe(true);
    expect(isMisskeyPage(otherPage)).toBe(false);
  });

  it("別のアプリケーション名を名乗るページに騙されない", () => {
    expect(
      isMisskeyPage(
        render('<meta name="application-name" content="Mastodon">'),
      ),
    ).toBe(false);
  });

  it("固定ホストを外から受け取る Misskey アダプターへの判定経路になっている", () => {
    expect(misskeyAdapter.matches).toEqual([]);
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
  // Sift が読めないサービスは読み込み先にしない。Misskey は固定ホストを別に足す。
  it("二度目の宣言ではなくアダプターと既定ホストから導出されている", () => {
    expect(SITE_MATCHES).toEqual([
      ...ADAPTERS.flatMap((adapter) => [...adapter.matches]),
      ...MISSKEY_HOSTS.map((host) => originForHost(host)),
    ]);
  });
});
