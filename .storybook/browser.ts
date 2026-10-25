import { fakeBrowser } from "@webext-core/fake-browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../utils/filter-context.ts";
import { POST_COLLECTION_LIMIT } from "../utils/panel-post.ts";
import { defaults } from "../utils/settings.ts";

declare const __STORYBOOK_MESSAGES__: Record<string, { message: string }>;

export const browser = fakeBrowser;

export async function preparePanel(
  site: "x" | "bluesky" | "disconnected" = "x",
  collectionTruncated = false,
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
  const metricCounts = [0, 5, 10, 40, 100, 500, 1000, 5000];
  const context: FilterContextResponse = {
    site: site === "bluesky" ? "bluesky" : "x",
    pageTitle: site === "bluesky" ? "Bluesky" : "X",
    pageKey: url,
    timelineAvailable: true,
    posts: metricCounts.map((metricCount, index) => ({
      id: site === "bluesky" ? `example.test:demo${index}` : String(index + 1),
      url:
        site === "bluesky"
          ? `https://bsky.app/profile/example.test/post/demo${index}`
          : `https://x.com/example_demo/status/${index + 1}`,
      author: `サンプル投稿者 ${index + 1}`,
      handle: site === "bluesky" ? "@example.test" : "@example_demo",
      text: `Storybook用の架空の投稿です。${index + 1}件目の本文を表示しています。`,
      images: [],
      metricCount,
    })),
    collectedCount: collectionTruncated
      ? POST_COLLECTION_LIMIT
      : metricCounts.length,
    collectionTruncated,
    metricSampleCount: 8,
    metricCounts,
  };
  browser.tabs.sendMessage = (async (
    _tabId: number,
    message: { type: string; reset?: boolean },
  ) => {
    if (message.type === FILTER_CONTEXT_REQUEST)
      return site === "disconnected" ? null : context;
  }) as typeof browser.tabs.sendMessage;
  browser.runtime.sendMessage = async () => false;
  await browser.storage.sync.set({ settings: structuredClone(defaults) });
}
