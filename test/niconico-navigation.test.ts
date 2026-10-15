import { afterEach, describe, expect, it } from "vitest";
import { readNiconicoUserListState } from "../e2e/niconico-navigation.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ニコニコ投稿一覧の準備完了", () => {
  it("選択ラベルだけ先に更新されても動画の描画前は未完了にする", () => {
    document.body.innerHTML =
      '<span class="Selectbox-button">再生数が少ない順</span>';
    expect(readNiconicoUserListState()).toMatchObject({
      label: "再生数が少ない順",
      ready: false,
      videoLinks: 0,
    });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a href="/watch/sm1">動画</a>',
    );
    expect(readNiconicoUserListState()).toMatchObject({
      label: "再生数が少ない順",
      ready: true,
      videoLinks: 1,
    });
  });
  it("古い一覧のリンクが残っていても操作欄がなければ未完了にする", () => {
    document.body.innerHTML = '<a href="/watch/sm1">動画</a>';
    expect(readNiconicoUserListState().ready).toBe(false);
  });
  it("非表示の操作欄・動画や、重複した操作欄を準備完了に数えない", () => {
    document.body.innerHTML =
      '<span class="Selectbox-button" style="display:none">再生数が少ない順</span><a href="/watch/sm1">動画</a>';
    expect(readNiconicoUserListState().ready).toBe(false);
    document.body.innerHTML =
      '<span class="Selectbox-button">再生数が少ない順</span><a href="/watch/sm1" style="display:none">動画</a>';
    expect(readNiconicoUserListState().ready).toBe(false);
    document.body.innerHTML =
      '<span class="Selectbox-button">再生数が少ない順</span><span class="Selectbox-button">古い順</span><a href="/watch/sm1">動画</a>';
    expect(readNiconicoUserListState().ready).toBe(false);
  });
});
