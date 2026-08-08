// Where the settings are kept. What they are is utils/settings.ts, which stays
// free of extension APIs so the build scripts can read it under node.
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";
import type { InstanceStorage } from "./instances.ts";
import { defaults, normalizeSettings, type Settings } from "./settings.ts";

// The keys the one-per-setting build wrote, which are the field names of
// `defaults` — derived rather than listed, so the migration below covers a
// setting that was added before the migration was removed.
const LEGACY_KEYS: string[] = Object.keys(defaults);

// What every surface reads and writes. One key holding one object, rather than
// one key per setting: `defaults` is already the single declaration `Settings`
// is derived from, and a `defineItem` per setting would put a second copy of
// every default beside it. It also makes a change one event carrying the whole
// value, instead of a diff to merge back into what the reader already had.
//
// `normalizeSettings()` still runs on every read. `fallback` answers for a key
// holding nothing; it says nothing about a key holding what an older build, or
// a half-finished write, left there.
export const settingsItem = storage.defineItem<Settings>("sync:settings", {
  fallback: defaults,
  // Settings used to live one-per-key at the top level of sync storage. This
  // folds whatever such a build left behind into the new value — `init` runs
  // once, and only while the key holds nothing.
  //
  // Removable once every profile running Sift has started on this version or a
  // later one. Nothing is published yet, so that is the author's two Chrome
  // profiles and whoever built this repository themselves.
  init: async () => normalizeSettings(await browser.storage.sync.get(LEGACY_KEYS))
});

// How utils/instances.ts reaches the host list: one field of the settings value
// rather than a key of its own, so the popup's list and the registrations it
// drives are reading the same thing.
export const instanceStorage: InstanceStorage = {
  async getInstances() {
    const settings = normalizeSettings(await settingsItem.getValue());
    return [...settings.misskeyInstances];
  },
  async setInstances(hosts) {
    const settings = normalizeSettings(await settingsItem.getValue());
    await settingsItem.setValue(
      normalizeSettings({ ...settings, misskeyInstances: hosts })
    );
  }
};
