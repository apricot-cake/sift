import { describe, expect, it } from "vitest";
import {
  isSidePanelConfigureRequest,
  isSidePanelTabId,
  isSidePanelTabRequest,
  SIDE_PANEL_CONTROL,
  sidePanelTabIdFromUrl,
} from "./sidepanel-controls.ts";

describe("サイドパネルの初期化要求", () => {
  it("対応ページが送る要求だけを受け入れる", () => {
    expect(
      isSidePanelConfigureRequest({
        type: SIDE_PANEL_CONTROL.configureForTab,
        available: true,
      }),
    ).toBe(true);
    expect(isSidePanelConfigureRequest({ type: "unknown" })).toBe(false);
    expect(
      isSidePanelConfigureRequest({
        type: SIDE_PANEL_CONTROL.configureForTab,
      }),
    ).toBe(false);
    expect(isSidePanelConfigureRequest(null)).toBe(false);
  });
});

describe("サイドパネルを開くタブの通知", () => {
  it("所有タブは正確なパネルURLの単一tabIdから取得する", () => {
    expect(sidePanelTabIdFromUrl("sidepanel.html?tabId=7")).toBe(7);
    expect(
      sidePanelTabIdFromUrl("chrome-extension://test/sidepanel.html?tabId=0"),
    ).toBe(0);
    for (const url of [
      "sidepanel.html",
      "sidepanel.html?tabId=-1",
      "sidepanel.html?tabId=1&tabId=2",
      "other.html?tabId=7",
      "sidepanel.html?tabId=1.5",
    ])
      expect(sidePanelTabIdFromUrl(url)).toBeNull();
  });
  it("session storage から読むタブ IDも検証する", () => {
    expect(isSidePanelTabId(0)).toBe(true);
    expect(isSidePanelTabId(123)).toBe(true);
    expect(isSidePanelTabId(-1)).toBe(false);
    expect(isSidePanelTabId("123")).toBe(false);
  });

  it("タブIDを含む通知だけを受け入れる", () => {
    expect(
      isSidePanelTabRequest({
        type: SIDE_PANEL_CONTROL.setPanelTab,
        tabId: 123,
      }),
    ).toBe(true);
    expect(
      isSidePanelTabRequest({ type: SIDE_PANEL_CONTROL.setPanelTab }),
    ).toBe(false);
    expect(
      isSidePanelTabRequest({
        type: SIDE_PANEL_CONTROL.setPanelTab,
        tabId: "123",
      }),
    ).toBe(false);
  });
});
