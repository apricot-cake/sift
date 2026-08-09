import { describe, expect, it } from "vitest";
import { decideDevLinkAction } from "./dev-link.ts";

// 以下のどの場合も、ブラウザの中で worker に頼んで到達させられる状態ではない＝
// だからこの判断は、問い合わせの繰り返しの中に埋めた分岐ではなく関数になっている。
const linked = {
  boot: "server-1",
  ready: true,
  isFirstProbe: false,
  bootAtStart: "server-1",
  registeredCount: 1,
  reloadedForBoot: undefined,
};

describe("decideDevLinkAction", () => {
  it("起動したときのサーバーへ繋がっている間は動かない", () => {
    expect(decideDevLinkAction(linked)).toBe("linked");
  });

  it("サーバーが落ちていることを報告する", () => {
    expect(decideDevLinkAction({ ...linked, boot: null })).toBe("server-down");
  });

  // 空の出力先へ再読み込みすると拡張機能はそのまま降ろされるので、どの状態も
  // これの後ろで待つ。
  it("サーバーがまだビルドを書いていない間は待つ", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        ready: false,
        bootAtStart: undefined,
        registeredCount: 0,
      }),
    ).toBe("building");
    expect(
      decideDevLinkAction({ ...linked, ready: false, boot: "server-2" }),
    ).toBe("building");
  });

  // worker は起動したばかりで、サーバーは応答した＝そのソケットはこの同じ
  // サーバーへ向かっている。それ以前に何を見ていたかは関係ない。
  it("最初の問い合わせで見つけたサーバーを引き受ける", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        isFirstProbe: true,
        bootAtStart: undefined,
        registeredCount: 0,
      }),
    ).toBe("adopt");
  });

  // サーバーより先にブラウザが開いていた＝worker の最初の問い合わせは何も
  // 見つけず、だから世代を1つも引き受けていないし、開いたソケットは死んでいる。
  it("どこにも繋がらなかったときは起動し直す", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        bootAtStart: undefined,
        registeredCount: 0,
      }),
    ).toBe("reload");
  });

  it("足元でサーバーが起動し直されたら起動し直す", () => {
    expect(decideDevLinkAction({ ...linked, boot: "server-2" })).toBe("reload");
  });

  it("登録が一度も起きなかったら起動し直す", () => {
    expect(decideDevLinkAction({ ...linked, registeredCount: 0 })).toBe(
      "reload",
    );
  });

  // 世代ごとに起動し直しは1回。同じ状態に戻ってくるのは別の何かがおかしいと
  // いうことで、繰り返してもそれを隠すだけ。
  it("世代ごとに1回だけ起動し直し、あとは待つ", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        boot: "server-2",
        reloadedForBoot: "server-2",
      }),
    ).toBe("waiting");
  });

  it("前の世代のための起動し直しを、次の世代の言い訳にしない", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        boot: "server-3",
        reloadedForBoot: "server-2",
      }),
    ).toBe("reload");
  });
});
