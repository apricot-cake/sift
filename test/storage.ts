// One chrome.storage area, in memory.
//
// The code that writes to storage takes the area as a dependency rather than
// reaching for `chrome.storage` itself (utils/error-log.ts, utils/error-drain.ts,
// utils/instances.ts), and this is what its tests pass in. `state` is the same
// object the fake reads and writes, so a test can seed it and then assert
// against it directly.
export function createFakeStorageArea(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { ...initial };
  return {
    state,
    async get(key: string) {
      return key in state ? { [key]: state[key] } : {};
    },
    async set(values: Record<string, unknown>) {
      Object.assign(state, values);
    }
  };
}
