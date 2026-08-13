import { describe, expect, it } from "vitest";
import { defaults, normalizeSettings } from "./settings.ts";
import { isSiteControlAvailable } from "./site-controls.ts";

describe("isSiteControlAvailable", () => {
  it("静的に対応するサービスではポップアップの切り替えを出す", () => {
    expect(isSiteControlAvailable("x.com", defaults)).toBe(true);
    expect(isSiteControlAvailable("twitter.com", defaults)).toBe(true);
    expect(isSiteControlAvailable("bsky.app", defaults)).toBe(true);
    expect(isSiteControlAvailable("misskey.io", defaults)).toBe(true);
  });

  it("追加済みのインスタンスだけで切り替えを出す", () => {
    const settings = normalizeSettings({
      misskeyInstances: ["social.example"],
    });

    expect(isSiteControlAvailable("social.example", settings)).toBe(true);
    expect(isSiteControlAvailable("example.com", settings)).toBe(false);
  });
});
