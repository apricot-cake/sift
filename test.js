import assert from "node:assert/strict";
import {
  createDevServerMonitor,
  getContentScriptPlans,
  initializeDevRuntime
} from "./src/background-dev.js";
import { classifyPost, parseMetric } from "./src/filter-core.js";

const settings = {
  minLikes: 500,
  risingEnabled: true,
  risingMinLikes: 100,
  risingMaxAgeHours: 6,
  hideReposts: true
};

assert.equal(parseMetric("1,234"), 1234);
assert.equal(parseMetric("1.2K"), 1200);
assert.equal(parseMetric("1.2万 件のいいね"), 12000);
assert.equal(parseMetric("３５０ 件のいいね"), 350);
assert.equal(parseMetric("11788 件のいいね。いいねする"), 11788);
assert.equal(parseMetric(""), 0);

const now = Date.parse("2026-08-01T12:00:00Z");

assert.deepEqual(
  classifyPost(
    {
      hasMedia: true,
      likeCount: 500,
      createdAtMs: now - 24 * 3600000,
      isRepost: false
    },
    settings,
    now
  ),
  { state: "hit", reason: "minimum-likes" }
);

assert.deepEqual(
  classifyPost(
    {
      hasMedia: true,
      likeCount: 120,
      createdAtMs: now - 2 * 3600000,
      isRepost: false
    },
    settings,
    now
  ),
  { state: "rising", reason: "rising" }
);

assert.deepEqual(
  classifyPost(
    {
      hasMedia: true,
      likeCount: 120,
      createdAtMs: now - 7 * 3600000,
      isRepost: false
    },
    settings,
    now
  ),
  { state: "hidden", reason: "below-threshold" }
);

assert.deepEqual(
  classifyPost(
    {
      hasMedia: false,
      likeCount: 1000,
      createdAtMs: now,
      isRepost: false
    },
    settings,
    now
  ),
  { state: "hidden", reason: "no-media" }
);

assert.deepEqual(
  classifyPost(
    {
      hasMedia: true,
      likeCount: 1000,
      createdAtMs: now,
      isRepost: true
    },
    settings,
    now
  ),
  { state: "hidden", reason: "repost" }
);

const runtimeManifest = {
  content_scripts: [
    {
      matches: ["https://x.com/*", "https://twitter.com/*"],
      js: ["vendor/content-css-loader.js", "src/content/index.js-loader.js"]
    }
  ]
};
assert.deepEqual(getContentScriptPlans(runtimeManifest), [
  {
    matches: ["https://x.com/*", "https://twitter.com/*"],
    files: ["vendor/content-css-loader.js", "src/content/index.js-loader.js"]
  }
]);

const sessionState = {};
const queryCalls = [];
const injectionCalls = [];
const runtimeApi = {
  runtime: {
    getManifest: () => runtimeManifest
  },
  scripting: {
    executeScript: async (options) => {
      injectionCalls.push(options);
    }
  },
  storage: {
    session: {
      get: async (key) => ({ [key]: sessionState[key] }),
      set: async (values) => Object.assign(sessionState, values)
    }
  },
  tabs: {
    query: async (options) => {
      queryCalls.push(options);
      return [{ id: 10 }, { id: 20 }, { id: null }];
    }
  }
};

assert.deepEqual(await initializeDevRuntime(runtimeApi), {
  initialized: true,
  injectedTabCount: 2
});
assert.deepEqual(queryCalls, [
  { url: ["https://x.com/*", "https://twitter.com/*"] }
]);
assert.deepEqual(injectionCalls, [
  {
    target: { tabId: 10 },
    files: ["vendor/content-css-loader.js", "src/content/index.js-loader.js"]
  },
  {
    target: { tabId: 20 },
    files: ["vendor/content-css-loader.js", "src/content/index.js-loader.js"]
  }
]);

assert.deepEqual(await initializeDevRuntime(runtimeApi), {
  initialized: false,
  injectedTabCount: 0
});
assert.equal(queryCalls.length, 1);

let probeSucceeds = true;
let reloadCount = 0;
const monitor = createDevServerMonitor({
  probe: async () => {
    if (!probeSucceeds) {
      throw new Error("offline");
    }
  },
  reload: () => {
    reloadCount += 1;
  }
});
assert.equal(await monitor.check(), "connected");
probeSucceeds = false;
assert.equal(await monitor.check(), "disconnected");
assert.equal(await monitor.check(), "disconnected");
probeSucceeds = true;
assert.equal(await monitor.check(), "reloaded");
assert.equal(reloadCount, 1);
assert.equal(await monitor.check(), "connected");

console.log("filter-core tests passed");
