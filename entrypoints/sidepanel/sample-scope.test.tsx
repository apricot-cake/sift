import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../../utils/filter-context.ts";
import { defaults } from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { SidepanelApp } from "./sidepanel-app.tsx";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("集計が一部の場合の表示", () => {
  it.each([
    ["x", "unknown", [10]],
    ["youtube", "newest", [10]],
    ["youtube", "popular", [10]],
    ["x", "unknown", []],
  ] as const)(
    "%s/%sでも件数を全体の合計と表示しない",
    async (site, sortOrder, metricCounts) => {
      vi.useFakeTimers();
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const response: FilterContextResponse = {
        site,
        sortOrder,
        pageTitle: site,
        pageKey: site,
        timelineAvailable: true,
        filteringEnabled: false,
        continuousLoadingWarning: false,
        metricCounts,
        metricCreatedAtMs: [],
        metricContextTruncated: true,
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
        expect(element.textContent).toContain(
          "Counts cover a sample of loaded posts",
        );
        expect(element.textContent).toContain("not the full total");
        expect(element.textContent).toContain(
          "Filters still apply to the entire list",
        );
      } finally {
        await act(async () => root.unmount());
        element.remove();
      }
    },
  );
});
