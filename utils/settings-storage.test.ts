import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { defaults, normalizeSettings } from "./settings.ts";

// The settings item defines itself — and runs its migration — when the module
// is first imported, so each case here resets storage and re-imports rather
// than sharing one instance across all of them.
async function importStorage() {
  vi.resetModules();
  return await import("./settings-storage.ts");
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("the stored settings", () => {
  it("answers the defaults for a profile that has never stored anything", async () => {
    const { settingsItem } = await importStorage();

    expect(await settingsItem.getValue()).toEqual(defaults);
  });

  it("reads back what was written", async () => {
    const { settingsItem } = await importStorage();

    await settingsItem.setValue(normalizeSettings({ minLikes: 42 }));

    expect((await settingsItem.getValue()).minLikes).toBe(42);
  });

  // The build before this one wrote one key per setting at the top level of
  // sync storage. Those values have to survive the move to a single key.
  it("folds in what the one-key-per-setting build left behind", async () => {
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
    // A setting that build never wrote still comes back as its default.
    expect(settings.risingMaxAgeHours).toBe(defaults.risingMaxAgeHours);
  });

  it("leaves an already-migrated value alone", async () => {
    const first = await importStorage();
    await first.settingsItem.setValue(normalizeSettings({ minLikes: 42 }));
    // What the legacy keys hold stops mattering once the new key is written.
    await fakeBrowser.storage.sync.set({ minLikes: 999 });

    const second = await importStorage();

    expect((await second.settingsItem.getValue()).minLikes).toBe(42);
  });
});

// utils/instances.ts reaches the host list through this, and the popup renders
// the same field of the same value.
describe("instanceStorage", () => {
  it("starts empty", async () => {
    const { instanceStorage } = await importStorage();

    expect(await instanceStorage.getInstances()).toEqual([]);
  });

  it("writes the host list into the settings the rest of the code reads", async () => {
    const { instanceStorage, settingsItem } = await importStorage();

    await instanceStorage.setInstances(["misskey.io"]);

    expect(await instanceStorage.getInstances()).toEqual(["misskey.io"]);
    expect((await settingsItem.getValue()).misskeyInstances).toEqual([
      "misskey.io",
    ]);
  });

  // The same normalization every other read gets: a host that cannot be turned
  // into one origin never reaches a registration.
  it("drops a host that is not one https host", async () => {
    const { instanceStorage } = await importStorage();

    await instanceStorage.setInstances([
      "misskey.io",
      "http://bad",
      "misskey.io",
    ]);

    expect(await instanceStorage.getInstances()).toEqual(["misskey.io"]);
  });

  it("leaves the other settings where they were", async () => {
    const { instanceStorage, settingsItem } = await importStorage();
    await settingsItem.setValue(normalizeSettings({ minLikes: 42 }));

    await instanceStorage.setInstances(["misskey.io"]);

    expect((await settingsItem.getValue()).minLikes).toBe(42);
  });
});
