import { expect, it } from "vitest";
import { isKnownUnsupportedSite } from "./panel-connection.ts";

it.each([
  undefined,
  "",
  "https://x.com/uowata94",
  "https://www.youtube.com/@Google/videos",
  "https://bsky.app/",
  "https://www.nicovideo.jp/user/123/video",
])("未接続の %s を対象外と断定しない", (url) => {
  expect(isKnownUnsupportedSite(url)).toBe(false);
});
it.each(["https://example.com/", "chrome://newtab/"])(
  "取得できた対象外URL %s は区別する",
  (url) => {
    expect(isKnownUnsupportedSite(url)).toBe(true);
  },
);
