import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import { xAdapter } from "../../utils/adapters/x.ts";
import { startContentRuntime } from "./index.ts";

// X の投稿1つ＝アダプターがフィルタする対象を見つけられるだけの最小限。
const timelineMarkup = `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="tweetPhoto"></div>
      <button data-testid="like" aria-label="900 件のいいね"></button>
      <time datetime="2026-08-01T12:00:00.000Z"></time>
    </article>
  </div>
`;

function toolbarHost(): Element | null {
  return document.querySelector("sift-toolbar");
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = "";
});

describe("ツールバー", () => {
  it("フィルタする投稿があればページに出る", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(toolbarHost()).not.toBeNull();
    });

    runtime.dispose();
  });

  it("操作を shadow root の中、ページから離した所に持つ", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(toolbarHost()?.shadowRoot).toBeTruthy();
    });
    const shadow = toolbarHost()?.shadowRoot;

    expect(
      shadow?.querySelector('[data-action="toggle-enabled"]'),
    ).not.toBeNull();
    expect(shadow?.querySelector('[data-role="panel"]')).not.toBeNull();
    // ツールバーが描くものは、ページ自身の文書からは1つも届かない。
    expect(document.querySelector('[data-action="toggle-enabled"]')).toBeNull();

    runtime.dispose();
  });

  it("投稿の無いページには出ない", async () => {
    document.body.innerHTML = '<div data-testid="primaryColumn">settings</div>';
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    // 待つ対象が無いので、まず実行環境自身の起動が落ち着くのを待つ。
    await vi.waitFor(() => {
      expect(document.body.querySelector("article")).toBeNull();
    });
    expect(toolbarHost()).toBeNull();

    runtime.dispose();
  });

  // ツールバーがどこに座るかは、それが壊れても他のどのテストも気付かない唯一の
  // 点＝描かれるし、クリックにも答える。ただそれを隅ではなくタイムラインの途中で
  // やる。置き場所が entrypoints/content/style.css のホストへの規則から WXT の
  // shadow root へ移ったときに起きたのがこれで、WXT は言われない限り
  // `:host{all:initial !important}` を先頭へ足す＝!important が置き場所を決める
  // 規則に勝ち、何も落ちなかった。
  //
  // 計算後のスタイルではなく、WXT が実際に入れたスタイルシートから読む。
  // happy-dom は `all: initial !important` を !important が無いものとして解決
  // するから＝どちらでも `position: fixed` と報告するので、計算後のスタイルでは
  // 壊れた版でもテストが通る（2026-08-08 に確認）。
  it("その上のどれにも勝てない規則で置かれている", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await vi.waitFor(() => {
      expect(toolbarHost()?.shadowRoot).toBeTruthy();
    });

    const installedCss = [
      ...(toolbarHost()?.shadowRoot?.querySelectorAll("style") ?? []),
    ]
      .map((style) => style.textContent ?? "")
      .join("\n");

    expect(installedCss).not.toMatch(/all\s*:\s*initial\s*!important/);
    const host = installedCss.match(/:host\s*\{[^}]*\}/)?.[0] ?? "";
    for (const declaration of [
      "position: fixed",
      "bottom: 18px",
      "right: 18px",
      "z-index: 2147483647",
    ]) {
      expect(
        host.includes(declaration),
        `ツールバーの :host 規則に ${declaration} が無い`,
      ).toBe(true);
    }

    runtime.dispose();
  });

  // このスクリプトを差し替える注入は前の実行環境を片付ける＝そこで置き去りに
  // されるものは、同じ投稿の上に載る2つ目のツールバーになる。
  it("それを作った実行環境と一緒に消える", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await vi.waitFor(() => {
      expect(toolbarHost()).not.toBeNull();
    });

    runtime.dispose();

    expect(toolbarHost()).toBeNull();
  });
});
