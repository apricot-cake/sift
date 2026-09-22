import { describe, expect, it } from "vitest";
import {
  isSidePanelConfigureRequest,
  isSidePanelTabId,
  isSidePanelTabRequest,
  SIDE_PANEL_CONTROL,
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
