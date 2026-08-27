import { describe, expect, it } from "vitest";
import {
  isSiteControlAvailable,
  siteSettingsKeyForControl,
} from "./site-controls.ts";

describe("サイト操作", () => {
  it("対応サイトだけを操作可能にする", () => {
    expect(isSiteControlAvailable("x.com")).toBe(true);
    expect(isSiteControlAvailable("bsky.app")).toBe(true);
    expect(isSiteControlAvailable("social.example")).toBe(false);
  });

  it("XとBlueskyへ別の設定を割り当てる", () => {
    expect(siteSettingsKeyForControl("x.com")).toBe("x");
    expect(siteSettingsKeyForControl("bsky.app")).toBe("bluesky");
  });

  it("未対応サイトには設定を割り当てない", () => {
    expect(siteSettingsKeyForControl("example.com")).toBeNull();
  });
});
