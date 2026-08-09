import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { defaults, normalizeSettings } from "./settings.ts";

// 設定の item は、モジュールが最初に読み込まれた時点で自分を定義し、移行も
// そこで走る。だからここの各ケースは1つの実体を共有せず、保管庫を戻して
// 読み込み直す。
async function importStorage() {
  vi.resetModules();
  return await import("./settings-storage.ts");
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("保管された設定", () => {
  it("何も保管したことのないプロファイルには既定値を返す", async () => {
    const { settingsItem } = await importStorage();

    expect(await settingsItem.getValue()).toEqual(defaults);
  });

  it("書いたものを読み戻す", async () => {
    const { settingsItem } = await importStorage();

    await settingsItem.setValue(normalizeSettings({ minLikes: 42 }));

    expect((await settingsItem.getValue()).minLikes).toBe(42);
  });

  // 1つ前のビルドは、sync ストレージの最上位に設定1つにつきキー1つを書いて
  // いた。その値は、単一キーへの移動を越えて残らなければならない。
  it("設定1つにキー1つだったビルドの残りを畳み込む", async () => {
    await fakeBrowser.storage.sync.set({
      minLikes: 42,
      misskeyInstances: ["misskey.io"],
      hideReposts: false,
    });

    const { settingsItem } = await importStorage();
    const settings = await settingsItem.getValue();

    expect(settings.minLikes).toBe(42);
    expect(settings.misskeyInstances).toEqual(["misskey.io"]);
    expect(settings.hideReposts).toBe(false);
    // そのビルドが一度も書かなかった設定は、既定値として返ってくる。
    expect(settings.risingMaxAgeHours).toBe(defaults.risingMaxAgeHours);
  });

  it("移行済みの値には手を出さない", async () => {
    const first = await importStorage();
    await first.settingsItem.setValue(normalizeSettings({ minLikes: 42 }));
    // 新しいキーが書かれた後は、古いキーが何を持っていても関係なくなる。
    await fakeBrowser.storage.sync.set({ minLikes: 999 });

    const second = await importStorage();

    expect((await second.settingsItem.getValue()).minLikes).toBe(42);
  });
});

// utils/instances.ts はこれを通してホストの一覧へ届き、popup は同じ値の同じ
// フィールドを描く。
describe("instanceStorage", () => {
  it("空から始まる", async () => {
    const { instanceStorage } = await importStorage();

    expect(await instanceStorage.getInstances()).toEqual([]);
  });

  it("他のコードが読む設定へホストの一覧を書く", async () => {
    const { instanceStorage, settingsItem } = await importStorage();

    await instanceStorage.setInstances(["misskey.io"]);

    expect(await instanceStorage.getInstances()).toEqual(["misskey.io"]);
    expect((await settingsItem.getValue()).misskeyInstances).toEqual([
      "misskey.io",
    ]);
  });

  // 他の読み出しと同じ正規化＝1つのオリジンに直せないホストは登録まで届かない。
  it("1つの https ホストになっていないものは落とす", async () => {
    const { instanceStorage } = await importStorage();

    await instanceStorage.setInstances([
      "misskey.io",
      "http://bad",
      "misskey.io",
    ]);

    expect(await instanceStorage.getInstances()).toEqual(["misskey.io"]);
  });

  it("他の設定はそのままにする", async () => {
    const { instanceStorage, settingsItem } = await importStorage();
    await settingsItem.setValue(normalizeSettings({ minLikes: 42 }));

    await instanceStorage.setInstances(["misskey.io"]);

    expect((await settingsItem.getValue()).minLikes).toBe(42);
  });
});
