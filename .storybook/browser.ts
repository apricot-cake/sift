import { fakeBrowser } from "@webext-core/fake-browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../utils/filter-context.ts";
import { defaults } from "../utils/settings.ts";
import { TIMELINE_CONTROL } from "../utils/timeline-controls.ts";

declare const __STORYBOOK_MESSAGES__: Record<string, { message: string }>;

export const browser = fakeBrowser;

export async function preparePanel(
  site: "x" | "bluesky" | "disconnected" = "x",
  warning = false,
) {
  fakeBrowser.reset();
  browser.i18n.getUILanguage = () => "ja";
  browser.i18n.getMessage = (key, substitutions) => {
    const message = __STORYBOOK_MESSAGES__[key]?.message;
    if (message === undefined) throw new Error(`翻訳がありません: ${key}`);
    const args =
      typeof substitutions === "string"
        ? [substitutions]
        : (substitutions ?? []);
    return message.replace(/\$(\$|[1-9])/g, (_match, token: string) =>
      token === "$" ? "$" : String(args[Number(token) - 1] ?? ""),
    );
  };
  const url = site === "bluesky" ? "https://bsky.app/" : "https://x.com/home";
  browser.tabs.query = async () => [
    {
      id: 1,
      url,
      active: true,
      index: 0,
      highlighted: true,
      pinned: false,
      incognito: false,
      selected: true,
      windowId: 1,
      frozen: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      splitViewId: -1,
      lastAccessed: 0,
    },
  ];
  let context: FilterContextResponse = {
    site: site === "bluesky" ? "bluesky" : "x",
    pageTitle: site === "bluesky" ? "Bluesky" : "X",
    pageKey: url,
    timelineAvailable: true,
    filteringEnabled: true,
    continuousLoadingWarning: warning,
    metricSampleCount: 8,
    metricCounts: [0, 5, 10, 40, 100, 500, 1000, 5000],
  };
  browser.tabs.sendMessage = (async (
    _tabId: number,
    message: { type: string; enabled: boolean },
  ) => {
    if (message.type === FILTER_CONTEXT_REQUEST)
      return site === "disconnected" ? null : context;
    if (message.type === TIMELINE_CONTROL.setFiltering)
      context = { ...context, filteringEnabled: message.enabled };
  }) as typeof browser.tabs.sendMessage;
  browser.runtime.sendMessage = async () => false;
  await browser.storage.sync.set({ settings: structuredClone(defaults) });
}
