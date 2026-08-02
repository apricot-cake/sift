import assert from "node:assert/strict";
import { drainErrorLog, ERROR_LOG_DRAINED_SEQ_KEY } from "./utils/error-drain.js";
import {
  appendErrorEntry,
  collectUndrainedEntries,
  describeUncaughtEvent,
  ERROR_LOG_KEY,
  installUncaughtReporting,
  isOwnExtensionError,
  recordErrorEntry
} from "./utils/error-log.js";
import { formatErrorLogLines } from "./scripts/dev-error-log.js";
import {
  findPostCell,
  getPostCards,
  hasPostCards,
  POST_CARD_SELECTOR,
  POST_CELL_SELECTOR
} from "./utils/post-cards.js";
import { classifyPost, parseMetric } from "./utils/filter-core.js";

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

const postCell = { id: "post-cell" };
const postCard = {
  closest(selector) {
    assert.equal(selector, POST_CELL_SELECTOR);
    return postCell;
  }
};
const postCardWithoutCell = {
  closest(selector) {
    assert.equal(selector, POST_CELL_SELECTOR);
    return null;
  }
};
const postRoot = {
  querySelector(selector) {
    assert.equal(selector, POST_CARD_SELECTOR);
    return postCard;
  },
  querySelectorAll(selector) {
    assert.equal(selector, POST_CARD_SELECTOR);
    return [postCard, postCardWithoutCell];
  }
};
const emptyRoot = {
  querySelector(selector) {
    assert.equal(selector, POST_CARD_SELECTOR);
    return null;
  },
  querySelectorAll(selector) {
    assert.equal(selector, POST_CARD_SELECTOR);
    return [];
  }
};

assert.equal(hasPostCards(postRoot), true);
assert.equal(hasPostCards(emptyRoot), false);
assert.deepEqual(getPostCards(postRoot), [postCard, postCardWithoutCell]);
assert.deepEqual(getPostCards(emptyRoot), []);
assert.equal(findPostCell(postCard), postCell);
assert.equal(findPostCell(postCardWithoutCell), postCardWithoutCell);

const extensionPrefix = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";

assert.equal(
  isOwnExtensionError(
    { filename: `${extensionPrefix}src/content/index.js`, stack: null },
    extensionPrefix
  ),
  true
);
assert.equal(
  isOwnExtensionError(
    {
      filename: null,
      stack: `Error: broke\n    at readLikeCount (${extensionPrefix}src/filter-core.js:12:5)`
    },
    extensionPrefix
  ),
  true
);
assert.equal(
  isOwnExtensionError(
    {
      filename: "https://x.com/bundle.js",
      stack: "TypeError: x\n    at https://x.com/bundle.js:1:1"
    },
    extensionPrefix
  ),
  false
);
assert.equal(isOwnExtensionError({ filename: null, stack: null }, extensionPrefix), false);
assert.equal(isOwnExtensionError({ filename: `${extensionPrefix}a.js` }, ""), false);

const uncaughtError = new Error("boom");
uncaughtError.stack = `Error: boom\n    at ${extensionPrefix}src/content/index.js:3:1`;
assert.deepEqual(
  describeUncaughtEvent(
    {
      message: "Uncaught Error: boom",
      filename: `${extensionPrefix}src/content/index.js`,
      error: uncaughtError
    },
    "error"
  ),
  {
    message: "Uncaught Error: boom",
    stack: uncaughtError.stack,
    filename: `${extensionPrefix}src/content/index.js`
  }
);
assert.deepEqual(
  describeUncaughtEvent({ reason: uncaughtError }, "unhandledrejection"),
  { message: "Error: boom", stack: uncaughtError.stack, filename: null }
);
assert.deepEqual(
  describeUncaughtEvent({ reason: "plain string" }, "unhandledrejection"),
  { message: "plain string", stack: null, filename: null }
);
assert.equal(
  describeUncaughtEvent(
    { reason: { get message() { throw new Error("hostile"); } } },
    "unhandledrejection"
  ).message,
  "[object Object]"
);
assert.equal(
  describeUncaughtEvent(
    { reason: Object.assign(Object.create(null), { toString: null }) },
    "unhandledrejection"
  ).message,
  "(unstringifiable value)"
);
assert.equal(
  describeUncaughtEvent({ message: "x".repeat(600) }, "error").message.length,
  501
);

assert.deepEqual(appendErrorEntry(undefined, { source: "content" }), [
  { source: "content", seq: 1 }
]);
assert.deepEqual(
  appendErrorEntry([{ source: "popup", seq: 4 }], { source: "content" }),
  [
    { source: "popup", seq: 4 },
    { source: "content", seq: 5 }
  ]
);

let ringBuffer = [];
for (let index = 0; index < 5; index += 1) {
  ringBuffer = appendErrorEntry(ringBuffer, { message: `error ${index}` }, 3);
}
assert.deepEqual(
  ringBuffer.map((entry) => entry.seq),
  [3, 4, 5]
);
assert.equal(ringBuffer[0].message, "error 2");

assert.deepEqual(
  collectUndrainedEntries([{ seq: 1 }, { seq: 2 }, { seq: 3 }], 2),
  [{ seq: 3 }]
);
assert.deepEqual(collectUndrainedEntries([{ seq: 1 }, { seq: 2 }], undefined), [
  { seq: 1 },
  { seq: 2 }
]);
// A buffer that restarted below the drain mark is forwarded whole rather than
// silently withheld until the counter catches up.
assert.deepEqual(collectUndrainedEntries([{ seq: 1 }], 9), [{ seq: 1 }]);
assert.deepEqual(collectUndrainedEntries([], 9), []);

function createFakeStorageArea(initial = {}) {
  const state = { ...initial };
  return {
    state,
    async get(key) {
      return key in state ? { [key]: state[key] } : {};
    },
    async set(values) {
      Object.assign(state, values);
    }
  };
}

const recordingStorage = createFakeStorageArea();
await recordErrorEntry(recordingStorage, { source: "content", message: "first" });
await recordErrorEntry(recordingStorage, { source: "popup", message: "second" });
assert.deepEqual(recordingStorage.state[ERROR_LOG_KEY], [
  { source: "content", message: "first", seq: 1 },
  { source: "popup", message: "second", seq: 2 }
]);

const brokenStorage = {
  async get() {
    throw new Error("Extension context invalidated.");
  },
  async set() {}
};
await recordErrorEntry(brokenStorage, { source: "content" });

function createFakeTarget(href = null) {
  const listeners = new Map();
  return {
    location: href === null ? undefined : { href },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener)
      );
    },
    emit(type, event) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
    count(type) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

const contentTarget = createFakeTarget("https://x.com/home");
const recorded = [];
const stopContentReporting = installUncaughtReporting({
  target: contentTarget,
  source: "content",
  extensionUrlPrefix: extensionPrefix,
  record: (entry) => {
    recorded.push(entry);
  },
  now: () => "2026-08-02T00:00:00.000Z"
});

contentTarget.emit("error", {
  message: "Uncaught Error: boom",
  filename: `${extensionPrefix}src/content/index.js`,
  error: uncaughtError
});
contentTarget.emit("error", {
  message: "Uncaught TypeError: page broke",
  filename: "https://x.com/bundle.js",
  error: new Error("page broke")
});
contentTarget.emit("unhandledrejection", { reason: uncaughtError });
contentTarget.emit("unhandledrejection", { reason: "a bare page rejection" });

assert.deepEqual(recorded, [
  {
    at: "2026-08-02T00:00:00.000Z",
    source: "content",
    kind: "error",
    message: "Uncaught Error: boom",
    stack: uncaughtError.stack,
    url: "https://x.com/home"
  },
  {
    at: "2026-08-02T00:00:00.000Z",
    source: "content",
    kind: "unhandledrejection",
    message: "Error: boom",
    stack: uncaughtError.stack,
    url: "https://x.com/home"
  }
]);

stopContentReporting();
assert.equal(contentTarget.count("error"), 0);
assert.equal(contentTarget.count("unhandledrejection"), 0);
contentTarget.emit("error", {
  filename: `${extensionPrefix}src/content/index.js`,
  error: uncaughtError
});
assert.equal(recorded.length, 2);

const pageTarget = createFakeTarget("chrome-extension://abc/popup.html");
installUncaughtReporting({
  target: pageTarget,
  source: "popup",
  record: (entry) => recorded.push(entry)
});
pageTarget.emit("error", { message: "anything on an extension page", error: null });
assert.equal(recorded.length, 3);
assert.equal(recorded[2].source, "popup");

// A recorder that fails must not take the watched code down with it, and a
// rejected write must not become the next unhandled rejection.
const hostileTarget = createFakeTarget();
installUncaughtReporting({
  target: hostileTarget,
  source: "popup",
  record: () => {
    throw new Error("storage is gone");
  }
});
hostileTarget.emit("error", { message: "x" });

const rejectingTarget = createFakeTarget();
installUncaughtReporting({
  target: rejectingTarget,
  source: "popup",
  record: () => Promise.reject(new Error("storage is gone"))
});
rejectingTarget.emit("unhandledrejection", { reason: "x" });
await new Promise((resolve) => setImmediate(resolve));

const drainStorage = {
  local: createFakeStorageArea({
    [ERROR_LOG_KEY]: [
      { seq: 1, message: "first" },
      { seq: 2, message: "second" }
    ]
  }),
  session: createFakeStorageArea()
};
const posted = [];

assert.deepEqual(
  await drainErrorLog({
    storage: drainStorage,
    post: (entries) => {
      posted.push(entries);
    }
  }),
  { forwarded: 2 }
);
assert.deepEqual(posted, [
  [
    { seq: 1, message: "first" },
    { seq: 2, message: "second" }
  ]
]);
assert.equal(drainStorage.session.state[ERROR_LOG_DRAINED_SEQ_KEY], 2);

assert.deepEqual(
  await drainErrorLog({ storage: drainStorage, post: () => posted.push("again") }),
  { forwarded: 0 }
);
assert.equal(posted.length, 1);

// A post that fails leaves the mark alone so the entries go out next time.
drainStorage.local.state[ERROR_LOG_KEY] = [
  ...drainStorage.local.state[ERROR_LOG_KEY],
  { seq: 3, message: "third" }
];
await assert.rejects(
  drainErrorLog({
    storage: drainStorage,
    post: () => {
      throw new Error("the development server is down");
    }
  })
);
assert.equal(drainStorage.session.state[ERROR_LOG_DRAINED_SEQ_KEY], 2);
assert.deepEqual(
  await drainErrorLog({
    storage: drainStorage,
    post: (entries) => posted.push(entries)
  }),
  { forwarded: 1 }
);
assert.deepEqual(posted.at(-1), [{ seq: 3, message: "third" }]);

assert.equal(
  formatErrorLogLines([{ seq: 1, message: "first" }, { seq: 2 }]),
  '{"seq":1,"message":"first"}\n{"seq":2}\n'
);
assert.equal(formatErrorLogLines(undefined), "");

console.log("Sift tests passed");
