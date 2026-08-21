import { describe, expect, it } from "vitest";
import { normalizeSettings } from "./settings.ts";
import {
  isSiteControlAvailable,
  siteSettingsKeyForControl,
} from "./site-controls.ts";

const settings = normalizeSettings({
  misskeyInstances: ["social.example"],
});

describe("サイト操作", () => {
  it("対応サイトだけを操作可能にする", () => {
    expect(isSiteControlAvailable("x.com", settings)).toBe(true);
    expect(isSiteControlAvailable("bsky.app", settings)).toBe(true);
    expect(isSiteControlAvailable("social.example", settings)).toBe(true);
    expect(isSiteControlAvailable("example.com", settings)).toBe(false);
  });

  it("XとBlueskyへ別の設定を割り当てる", () => {
    expect(siteSettingsKeyForControl("x.com", settings)).toBe("x");
    expect(siteSettingsKeyForControl("bsky.app", settings)).toBe("bluesky");
  });

  it("追加済みMisskeyへMisskey設定を割り当てる", () => {
    expect(siteSettingsKeyForControl("social.example", settings)).toBe(
      "misskey",
    );
  });

  it("未対応サイトには設定を割り当てない", () => {
    expect(siteSettingsKeyForControl("example.com", settings)).toBeNull();
  });
});
