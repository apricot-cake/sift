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
      500,
    );
  });

  it("サイト別設定を書いて読み戻す", async () => {
    const { settingsItem } = await importStorage();
    await settingsItem.setValue(
      normalizeSettings({ siteSettings: { bluesky: { minReactions: 42 } } }),
    );
    const stored = await settingsItem.getValue();
    expect(stored.siteSettings.bluesky.minReactions).toBe(42);
    expect(stored.siteSettings.x.minReactions).toBe(500);
  });

  it("設定1つにキー1つだった版をサイト別設定へ畳み込む", async () => {
    await fakeBrowser.storage.sync.set({
      minLikes: 42,
      misskeyInstances: ["misskey.io"],
      hideReposts: false,
    });
    const { settingsItem } = await importStorage();
    const settings = await settingsItem.getValue();
    expect(settings.siteSettings.x.minReactions).toBe(42);
    expect(settings.siteSettings.bluesky.minReactions).toBe(42);
    expect(settings.siteSettings.x.hideReposts).toBe(false);
    expect(settings.misskeyInstances).toEqual(["misskey.io"]);
  });

  it("移行済みの値には手を出さない", async () => {
    const first = await importStorage();
    await first.settingsItem.setValue(
      normalizeSettings({ siteSettings: { bluesky: { minReactions: 42 } } }),
    );
    await fakeBrowser.storage.sync.set({ minLikes: 999 });
    const second = await importStorage();
    expect(
      (await second.settingsItem.getValue()).siteSettings.bluesky.minReactions,
    ).toBe(42);
  });
});

describe("instanceStorage", () => {
  it("ホスト一覧だけを変更する", async () => {
    const { instanceStorage, settingsItem } = await importStorage();
    await settingsItem.setValue(
      normalizeSettings({ siteSettings: { bluesky: { minReactions: 42 } } }),
    );
    await instanceStorage.setInstances(["misskey.io"]);
    expect(await instanceStorage.getInstances()).toEqual(["misskey.io"]);
    expect(
      (await settingsItem.getValue()).siteSettings.bluesky.minReactions,
    ).toBe(42);
  });

  it("不正なホストと重複を落とす", async () => {
    const { instanceStorage } = await importStorage();
    await instanceStorage.setInstances([
      "misskey.io",
      "http://bad",
      "misskey.io",
    ]);
    expect(await instanceStorage.getInstances()).toEqual(["misskey.io"]);
  });
});
