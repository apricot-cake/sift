import { describe, expect, it } from "vitest";
import {
  shouldDisablePreviousFiltering,
  shouldEnableFiltering,
} from "./filter-activation.ts";

const samePage = {
  hasNextPage: true,
  hasPreviousPage: true,
  pageChanged: false,
  panelInitialized: true,
};

describe("shouldEnableFiltering", () => {
  it("サイドパネルを開いたままページを再読み込みしたら有効化し直す", () => {
    expect(
      shouldEnableFiltering({
        ...samePage,
        contentFilteringEnabled: false,
        panelExpectedFiltering: true,
      }),
    ).toBe(true);
  });

  it("サイドパネルから明示的に停止した状態は有効化し直さない", () => {
    expect(
      shouldEnableFiltering({
        ...samePage,
        contentFilteringEnabled: false,
        panelExpectedFiltering: false,
      }),
    ).toBe(false);
  });

  it("同じページですでに有効なら重ねて送らない", () => {
    expect(
      shouldEnableFiltering({
        ...samePage,
        contentFilteringEnabled: true,
        panelExpectedFiltering: true,
      }),
    ).toBe(false);
  });

  it("初回表示と別ページへの移動では有効化する", () => {
    expect(
      shouldEnableFiltering({
        ...samePage,
        contentFilteringEnabled: false,
        panelExpectedFiltering: false,
        panelInitialized: false,
      }),
    ).toBe(true);
    expect(
      shouldEnableFiltering({
        ...samePage,
        contentFilteringEnabled: false,
        panelExpectedFiltering: false,
        pageChanged: true,
      }),
    ).toBe(true);
  });
});

describe("shouldDisablePreviousFiltering", () => {
  it("同じタブ内の対応ページ間を移動しても停止しない", () => {
    expect(
      shouldDisablePreviousFiltering({
        pageChanged: true,
        previousTabId: 1,
        nextTabId: 1,
      }),
    ).toBe(false);
  });

  it("別のタブへ移動したら前のタブを停止する", () => {
    expect(
      shouldDisablePreviousFiltering({
        pageChanged: true,
        previousTabId: 1,
        nextTabId: 2,
      }),
    ).toBe(true);
  });

  it("未対応ページへ移動したら前のタブを停止する", () => {
    expect(
      shouldDisablePreviousFiltering({
        pageChanged: true,
        previousTabId: 1,
        nextTabId: null,
      }),
    ).toBe(true);
  });

  it("ページが変わっていなければ停止しない", () => {
    expect(
      shouldDisablePreviousFiltering({
        pageChanged: false,
        previousTabId: 1,
        nextTabId: null,
      }),
    ).toBe(false);
  });
});
