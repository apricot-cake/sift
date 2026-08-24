import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { normalizeSettings } from "./settings.ts";

async function importStorage() {
  vi.resetModules();
  return await import("./settings-storage.ts");
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("保管された設定", () => {
  it("何も保管していないプロファイルには既定値を返す", async () => {
    const { settingsItem } = await importStorage();
    expect((await settingsItem.getValue()).siteSettings.x.minReactions).toBe(
      1000,
    );
  });

  it("サイト別設定を書いて読み戻す", async () => {
    const { settingsItem } = await importStorage();
    await settingsItem.setValue(
      normalizeSettings({ siteSettings: { bluesky: { minReactions: 42 } } }),
    );
    const stored = await settingsItem.getValue();
    expect(stored.siteSettings.bluesky.minReactions).toBe(42);
    expect(stored.siteSettings.x.minReactions).toBe(1000);
  });
});
