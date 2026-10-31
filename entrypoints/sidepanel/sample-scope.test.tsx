import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../../utils/filter-context.ts";
import { t } from "../../utils/i18n.ts";
import { defaults } from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { SidepanelApp } from "./sidepanel-app.tsx";

beforeEach(() => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  history.replaceState(null, "", "/sidepanel.html?tabId=1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("収集上限の表示", () => {
  it("候補集計を表示せず収集上限を案内する", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const response: FilterContextResponse = {
      site: "x",
      pageTitle: "x",
      pageKey: "x",
      timelineAvailable: true,
      posts: [],
      collectedCount: 1_000,
      collectionTruncated: true,
    };
    vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([
      { id: 1, url: "https://x.com/example" },
    ] as never);
    vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(
      async (_id, message) =>
        (message as { type: string }).type === FILTER_CONTEXT_REQUEST
          ? response
          : undefined,
    );
    vi.spyOn(settingsItem, "getValue").mockResolvedValue(defaults);
    vi.spyOn(settingsItem, "setValue").mockResolvedValue();
    vi.spyOn(settingsItem, "watch").mockReturnValue(() => {});
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () => {
        root.render(<SidepanelApp />);
        for (let i = 0; i < 40; i++) await Promise.resolve();
      });
      expect(element.querySelector("[data-threshold-suggestions]")).toBeNull();
      expect(element.textContent).toContain(
        t("sidepanelCollectionLimit", { count: "1,000" }),
      );
    } finally {
      await act(async () => root.unmount());
      element.remove();
    }
  });
});
