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
import { decideDevLinkAction } from "./utils/dev-link.js";
import { ADAPTERS, hostMatchesPattern, selectAdapter } from "./utils/adapters/index.js";
import {
  BLUESKY_SELECTORS,
  blueskyAdapter,
  timestampFromRecordKey
} from "./utils/adapters/bluesky.js";
import { X_SELECTORS, xAdapter } from "./utils/adapters/x.js";
import { SITE_MATCHES } from "./utils/site-matches.js";
import { classifyPost, parseMetric } from "./utils/filter-core.js";
import {
  addInstance,
  handlePermissionsAdded,
  handlePermissionsRemoved,
  MISSKEY_CONTENT_SCRIPT_FILES,
  MISSKEY_INSTANCES_KEY,
  normalizeInstanceHost,
  originForHost,
  reconcileInstances,
  registrationIdForHost,
  removeInstance
} from "./utils/instances.js";
import { defaults, normalizeSettings } from "./utils/settings.js";

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

// A node that answers only the selectors it was given, keyed by the adapter's
// own selector table so the test never restates a selector. `extras` carries
// the properties an adapter reads directly rather than through a selector.
function createFakeNode(responses = {}, extras = {}) {
  return {
    querySelector(selector) {
      return responses[selector] ?? null;
    },
    querySelectorAll(selector) {
      const value = responses[selector];
      if (!value) {
        return [];
      }
      return Array.isArray(value) ? value : [value];
    },
    closest(selector) {
      return responses[selector] ?? null;
    },
    ...extras
  };
}

function createFakeAttributeNode(attributes = {}, textContent = "") {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    textContent
  };
}

// Every adapter answers for each of its own match patterns, and for no other
// adapter's: the host name has to pick one adapter, not a set.
for (const adapter of ADAPTERS) {
  for (const pattern of adapter.matches) {
    const host = pattern
      .slice(pattern.indexOf("://") + 3)
      .replace(/\/.*$/, "")
      .replace(/^\*\./, "");
    assert.equal(selectAdapter(host), adapter, `${pattern} selects ${adapter.id}`);
  }
}

assert.equal(selectAdapter("x.com"), xAdapter);
assert.equal(selectAdapter("twitter.com"), xAdapter);
assert.equal(selectAdapter("bsky.app"), blueskyAdapter);
assert.equal(selectAdapter("notx.com"), null);
// A match pattern without the "*." prefix does not cover subdomains.
assert.equal(selectAdapter("mobile.x.com"), null);

assert.equal(hostMatchesPattern("https://*.example.com/*", "example.com"), true);
assert.equal(hostMatchesPattern("https://*.example.com/*", "a.example.com"), true);
assert.equal(hostMatchesPattern("https://*.example.com/*", "notexample.com"), false);
assert.equal(hostMatchesPattern("https://*/*", "anything.test"), true);

// The registration and the adapters cannot drift: one is derived from the other.
assert.deepEqual(SITE_MATCHES, ADAPTERS.flatMap((adapter) => [...adapter.matches]));

const postCell = { id: "post-cell" };
const postCard = createFakeNode({ [X_SELECTORS.postCell]: postCell });
const postCardWithoutCell = createFakeNode();
const postRoot = createFakeNode({
  [X_SELECTORS.postCard]: [postCard, postCardWithoutCell]
});
const emptyRoot = createFakeNode();

assert.equal(xAdapter.hasPostCards(postRoot), true);
assert.equal(xAdapter.hasPostCards(emptyRoot), false);
assert.deepEqual(xAdapter.getPostCards(postRoot), [postCard, postCardWithoutCell]);
assert.deepEqual(xAdapter.getPostCards(emptyRoot), []);
assert.equal(xAdapter.findPostCell(postCard), postCell);
assert.equal(xAdapter.findPostCell(postCardWithoutCell), postCardWithoutCell);

// The reaction count prefers the accessible label, which carries the exact
// number, over the rounded text on the button.
assert.equal(
  xAdapter.readReactionCount(
    createFakeNode({
      [X_SELECTORS.reactionButton]: createFakeAttributeNode(
        { "aria-label": "11788 件のいいね。いいねする" },
        "1.1万"
      )
    })
  ),
  11788
);
assert.equal(
  xAdapter.readReactionCount(
    createFakeNode({
      [X_SELECTORS.reactionButton]: createFakeAttributeNode({}, " 1,234 ")
    })
  ),
  1234
);
assert.equal(xAdapter.readReactionCount(createFakeNode()), 0);

assert.equal(
  xAdapter.readCreatedAt(
    createFakeNode({
      [X_SELECTORS.createdAt]: createFakeAttributeNode({
        datetime: "2026-08-01T12:00:00.000Z"
      })
    })
  ),
  Date.parse("2026-08-01T12:00:00.000Z")
);
assert.equal(Number.isNaN(xAdapter.readCreatedAt(createFakeNode())), true);
assert.equal(
  Number.isNaN(
    xAdapter.readCreatedAt(
      createFakeNode({
        [X_SELECTORS.createdAt]: createFakeAttributeNode({ datetime: "not a date" })
      })
    )
  ),
  true
);

// Image and video stay separate: folding them into one answer is the reader's
// media setting, which is not this adapter's to apply.
assert.deepEqual(
  xAdapter.readMedia(createFakeNode({ [X_SELECTORS.image]: { id: "photo" } })),
  { hasImage: true, hasVideo: false }
);
assert.deepEqual(
  xAdapter.readMedia(createFakeNode({ [X_SELECTORS.video]: { id: "video" } })),
  { hasImage: false, hasVideo: true }
);
assert.deepEqual(xAdapter.readMedia(createFakeNode()), {
  hasImage: false,
  hasVideo: false
});

assert.equal(
  xAdapter.readIsRepost(
    createFakeNode({
      [X_SELECTORS.socialContext]: { textContent: "さんがリポストしました" }
    })
  ),
  true
);
assert.equal(
  xAdapter.readIsRepost(
    createFakeNode({ [X_SELECTORS.socialContext]: { textContent: "固定されたポスト" } })
  ),
  false
);
assert.equal(xAdapter.readIsRepost(createFakeNode()), false);

// The toolbar and its settings panel take this word from the adapter rather
// than spelling out X's.
assert.equal(xAdapter.reactionLabel, "いいね");

// Notification rows reuse the post card's testid. What they do not have is a
// like button, and that is what keeps them out of the reading.
const blueskyPostCard = createFakeNode({
  [BLUESKY_SELECTORS.reactionButton]: createFakeAttributeNode(
    { "aria-label": "いいねする（63,561件のいいね）" },
    "6万"
  )
});
const blueskyNotificationRow = createFakeNode();
const blueskyRoot = createFakeNode({
  [BLUESKY_SELECTORS.postCard]: [blueskyPostCard, blueskyNotificationRow]
});
const blueskyNotificationsRoot = createFakeNode({
  [BLUESKY_SELECTORS.postCard]: [blueskyNotificationRow]
});

assert.deepEqual(blueskyAdapter.getPostCards(blueskyRoot), [blueskyPostCard]);
assert.deepEqual(blueskyAdapter.getPostCards(emptyRoot), []);
assert.equal(blueskyAdapter.hasPostCards(blueskyRoot), true);
assert.equal(blueskyAdapter.hasPostCards(blueskyNotificationsRoot), false);
assert.equal(blueskyAdapter.hasPostCards(emptyRoot), false);

// Bluesky keeps the separator and the padding inside the card, so the card is
// the unit that gets hidden.
assert.equal(blueskyAdapter.findPostCell(blueskyPostCard), blueskyPostCard);

// The accessible label carries the exact count; the text on the button is
// rounded to "6万" and could never be compared against a threshold.
assert.equal(blueskyAdapter.readReactionCount(blueskyPostCard), 63561);
assert.equal(blueskyAdapter.readReactionCount(createFakeNode()), 0);

const blueskyPostHref = "/profile/example.bsky.social/post/3mqcze2d6k23e";
const recordKeyTime = Date.parse("2026-07-10T20:46:00.000Z");

function createBlueskyPostWithLink(attributes) {
  return createFakeNode({
    [BLUESKY_SELECTORS.postLink]: createFakeAttributeNode(attributes)
  });
}

// A label Date.parse understands is the reading; the record key is not
// consulted, and its time differs here so the test can tell which one won.
assert.equal(
  blueskyAdapter.readCreatedAt(
    createBlueskyPostWithLink({
      "aria-label": "2026-08-01T12:00:00.000Z",
      href: blueskyPostHref
    })
  ),
  Date.parse("2026-08-01T12:00:00.000Z")
);

// The label Bluesky actually writes is a localized absolute time, which
// Date.parse rejects — so in practice the record key is what carries the time.
assert.equal(Number.isNaN(Date.parse("2026年7月10日 20:46")), true);
assert.equal(
  blueskyAdapter.readCreatedAt(
    createBlueskyPostWithLink({
      "aria-label": "2026年7月10日 20:46",
      href: blueskyPostHref
    })
  ),
  recordKeyTime
);

// Neither reading available: the post still classifies, only "rising" drops.
assert.equal(
  Number.isNaN(
    blueskyAdapter.readCreatedAt(
      createBlueskyPostWithLink({ href: "/profile/example.bsky.social/post/self" })
    )
  ),
  true
);
assert.equal(Number.isNaN(blueskyAdapter.readCreatedAt(createFakeNode())), true);

// The post a detail screen is about has no permalink — it is where the link
// would point. Its first links are to its own sub-pages, whose labels are
// actions rather than times, and the record key rides in the middle of the path.
assert.equal(
  blueskyAdapter.readCreatedAt(
    createFakeNode({
      [BLUESKY_SELECTORS.postLink]: [
        createFakeAttributeNode({
          "aria-label": "この投稿をリポストする",
          href: `${blueskyPostHref}/reposted-by`
        }),
        createFakeAttributeNode({
          "aria-label": "この投稿をいいねする",
          href: `${blueskyPostHref}/liked-by`
        })
      ]
    })
  ),
  recordKeyTime
);

// A quoting post carries the quoted post's permalink too, after its own.
assert.equal(
  blueskyAdapter.readCreatedAt(
    createFakeNode({
      [BLUESKY_SELECTORS.postLink]: [
        createFakeAttributeNode({
          "aria-label": "2026年7月10日 20:46",
          href: blueskyPostHref
        }),
        createFakeAttributeNode({
          href: "/profile/quoted.bsky.social/post/3ms3mmsbt223e"
        })
      ]
    })
  ),
  recordKeyTime
);

assert.equal(timestampFromRecordKey(blueskyPostHref), recordKeyTime);
assert.equal(timestampFromRecordKey(`${blueskyPostHref}?foo=1`), recordKeyTime);
// The key is the segment after /post/, so a link to one of the post's own
// sub-pages carries it just as well as the permalink does.
assert.equal(
  timestampFromRecordKey(`${blueskyPostHref}/reposted-by`),
  recordKeyTime
);
assert.equal(
  timestampFromRecordKey(`https://bsky.app${blueskyPostHref}#anchor`),
  recordKeyTime
);
// A record key is only a TID by convention, so anything that does not decode to
// a plausible post time is refused: wrong length, a character outside the
// alphabet, or a time that cannot belong to a post.
assert.equal(Number.isNaN(timestampFromRecordKey("/post/tooshort")), true);
assert.equal(Number.isNaN(timestampFromRecordKey("/post/3111111111111")), true);
assert.equal(Number.isNaN(timestampFromRecordKey("")), true);
assert.equal(Number.isNaN(timestampFromRecordKey(null)), true);
// "aaaaaaaaaaaaa" decodes to the year 2190 — the reason the upper bound exists.
assert.equal(Number.isNaN(timestampFromRecordKey("/post/aaaaaaaaaaaaa")), true);
// A time before the network existed.
assert.equal(Number.isNaN(timestampFromRecordKey("/post/3i5p64yyc222b")), true);
// And a post cannot predate the clock reading it by more than a small skew.
assert.equal(
  Number.isNaN(timestampFromRecordKey(blueskyPostHref, recordKeyTime - 3600000)),
  true
);
assert.equal(
  timestampFromRecordKey(blueskyPostHref, recordKeyTime - 60000),
  recordKeyTime
);

assert.deepEqual(
  blueskyAdapter.readMedia(createFakeNode({ [BLUESKY_SELECTORS.image]: { id: "photo" } })),
  { hasImage: true, hasVideo: false }
);
// An unplayed video has no <video> at all: the thumbnail is a CSS background.
assert.deepEqual(
  blueskyAdapter.readMedia(createFakeNode({ [BLUESKY_SELECTORS.video]: { id: "video" } })),
  { hasImage: false, hasVideo: true }
);
assert.deepEqual(
  blueskyAdapter.readMedia(
    createFakeNode({ [BLUESKY_SELECTORS.animatedImage]: { id: "gif" } })
  ),
  { hasImage: false, hasVideo: true }
);
assert.deepEqual(blueskyAdapter.readMedia(createFakeNode()), {
  hasImage: false,
  hasVideo: false
});
// An external link card's thumbnail is served from the same path as a post's
// image and is told apart only by what encloses it: a link, not a button.
assert.match(BLUESKY_SELECTORS.image, /^button /);

// A repost is marked by a header whose profile link wraps an icon, where an
// author's profile link wraps an avatar image. The displayed word is localized
// and carries no testid, so the shape is what the reading can rely on.
function createFakeProfileLink({ hasAvatar = false, firstChildTag = null } = {}) {
  return createFakeNode(hasAvatar ? { img: { id: "avatar" } } : {}, {
    firstElementChild: firstChildTag === null ? null : { tagName: firstChildTag }
  });
}

function createBlueskyPostWithProfileLink(options) {
  return createFakeNode({
    [BLUESKY_SELECTORS.profileLink]: createFakeProfileLink(options)
  });
}

assert.equal(
  blueskyAdapter.readIsRepost(
    createBlueskyPostWithProfileLink({ firstChildTag: "svg" })
  ),
  true
);
assert.equal(
  blueskyAdapter.readIsRepost(
    createBlueskyPostWithProfileLink({ hasAvatar: true, firstChildTag: "svg" })
  ),
  false
);
assert.equal(
  blueskyAdapter.readIsRepost(
    createBlueskyPostWithProfileLink({ firstChildTag: "div" })
  ),
  false
);
assert.equal(
  blueskyAdapter.readIsRepost(createBlueskyPostWithProfileLink()),
  false
);
assert.equal(blueskyAdapter.readIsRepost(createFakeNode()), false);

// Bluesky's like is X's like, so the threshold and the word are shared rather
// than duplicated per service.
assert.equal(blueskyAdapter.reactionLabel, xAdapter.reactionLabel);

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

// The development link. Each case is a state the worker cannot be talked into
// reaching on demand inside a browser, which is why the decision is a function.
const linked = {
  boot: "server-1",
  ready: true,
  isFirstProbe: false,
  bootAtStart: "server-1",
  registeredCount: 1,
  reloadedForBoot: undefined
};

assert.equal(decideDevLinkAction(linked), "linked");

// Nothing to attach to.
assert.equal(decideDevLinkAction({ ...linked, boot: null }), "server-down");

// The server is up but has not written the build yet. Reloading into an empty
// folder unloads the extension outright, so every state waits behind this one.
assert.equal(
  decideDevLinkAction({
    ...linked,
    ready: false,
    bootAtStart: undefined,
    registeredCount: 0
  }),
  "building"
);
assert.equal(
  decideDevLinkAction({ ...linked, ready: false, boot: "server-2" }),
  "building"
);

// The worker just started and the server answered, so its socket went to this
// same server. Whatever it saw before does not matter.
assert.equal(
  decideDevLinkAction({
    ...linked,
    isFirstProbe: true,
    bootAtStart: undefined,
    registeredCount: 0
  }),
  "adopt"
);

// The browser was open before the server was: the worker's first probe found
// nothing, so it never adopted a generation, and the socket it opened is dead.
assert.equal(
  decideDevLinkAction({ ...linked, bootAtStart: undefined, registeredCount: 0 }),
  "reload"
);

// The server was restarted under a live worker.
assert.equal(decideDevLinkAction({ ...linked, boot: "server-2" }), "reload");

// Attached to the right server, but the registration never happened.
assert.equal(decideDevLinkAction({ ...linked, registeredCount: 0 }), "reload");

// One reload per generation. Coming back to the same state means something else
// is wrong, and a loop would only hide it.
assert.equal(
  decideDevLinkAction({
    ...linked,
    boot: "server-2",
    reloadedForBoot: "server-2"
  }),
  "waiting"
);

// A generation reloaded for earlier does not excuse the next one.
assert.equal(
  decideDevLinkAction({
    ...linked,
    boot: "server-3",
    reloadedForBoot: "server-2"
  }),
  "reload"
);

// -- Misskey instance permission and registration (utils/instances.js) --

assert.equal(normalizeInstanceHost("misskey.io"), "misskey.io");
assert.equal(normalizeInstanceHost("https://misskey.io"), "misskey.io");
assert.equal(normalizeInstanceHost("https://misskey.io/"), "misskey.io");
assert.equal(normalizeInstanceHost("  misskey.io  "), "misskey.io");
// Not a URL.
assert.equal(normalizeInstanceHost("not a host"), null);
assert.equal(normalizeInstanceHost(""), null);
assert.equal(normalizeInstanceHost(null), null);
// A path or query.
assert.equal(normalizeInstanceHost("https://misskey.io/notes/1"), null);
assert.equal(normalizeInstanceHost("misskey.io/notes/1"), null);
assert.equal(normalizeInstanceHost("https://misskey.io/?q=1"), null);
// http instead of https.
assert.equal(normalizeInstanceHost("http://misskey.io"), null);
// A port: match patterns cannot represent one.
assert.equal(normalizeInstanceHost("misskey.io:8080"), null);

assert.equal(originForHost("misskey.io"), "https://misskey.io/*");
assert.equal(registrationIdForHost("misskey.io"), "misskey-misskey.io");

function createFakePermissions(grantedOrigins = []) {
  const origins = new Set(grantedOrigins);
  return {
    origins,
    async request({ origins: requested }) {
      for (const origin of requested) {
        origins.add(origin);
      }
      return true;
    },
    async remove({ origins: requested }) {
      let removedAny = false;
      for (const origin of requested) {
        removedAny = origins.delete(origin) || removedAny;
      }
      return removedAny;
    },
    async contains({ origins: requested }) {
      return requested.every((origin) => origins.has(origin));
    }
  };
}

function createFakeScripting(initialScripts = []) {
  const scripts = new Map(initialScripts.map((script) => [script.id, script]));
  return {
    scripts,
    async registerContentScripts(registered) {
      for (const script of registered) {
        assert.ok(!scripts.has(script.id), `duplicate script id ${script.id}`);
        scripts.set(script.id, script);
      }
    },
    async unregisterContentScripts({ ids } = {}) {
      const targets = ids ?? [...scripts.keys()];
      for (const id of targets) {
        if (!scripts.has(id)) {
          throw new Error(`no registered content script with id ${id}`);
        }
        scripts.delete(id);
      }
    },
    async getRegisteredContentScripts() {
      return [...scripts.values()];
    }
  };
}

// addInstance(): denied permission registers nothing and stores nothing.
{
  const permissions = createFakePermissions();
  permissions.request = async () => false;
  const scripting = createFakeScripting();
  const storage = { sync: createFakeStorageArea() };

  const result = await addInstance("misskey.io", { permissions, scripting, storage });

  assert.deepEqual(result, { added: false, reason: "permission-denied" });
  assert.equal(scripting.scripts.size, 0);
  assert.equal(storage.sync.state[MISSKEY_INSTANCES_KEY], undefined);
}

// addInstance(): an invalid host is rejected before any permission request.
{
  const permissions = createFakePermissions();
  let requested = false;
  permissions.request = async () => {
    requested = true;
    return true;
  };
  const scripting = createFakeScripting();
  const storage = { sync: createFakeStorageArea() };

  const result = await addInstance("http://misskey.io", {
    permissions,
    scripting,
    storage
  });

  assert.deepEqual(result, { added: false, reason: "invalid-host" });
  assert.equal(requested, false);
}

// addInstance(): granted permission registers the same built files the
// static X/Bluesky content script uses, and stores the host.
{
  const permissions = createFakePermissions();
  const scripting = createFakeScripting();
  const storage = { sync: createFakeStorageArea() };

  const result = await addInstance("misskey.io", { permissions, scripting, storage });

  assert.deepEqual(result, { added: true });
  assert.ok(permissions.origins.has("https://misskey.io/*"));
  assert.deepEqual(scripting.scripts.get("misskey-misskey.io"), {
    id: "misskey-misskey.io",
    matches: ["https://misskey.io/*"],
    js: [...MISSKEY_CONTENT_SCRIPT_FILES.js],
    css: [...MISSKEY_CONTENT_SCRIPT_FILES.css],
    runAt: "document_idle",
    persistAcrossSessions: true
  });
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);

  // Adding the same host again is a no-op: it neither re-requests the
  // permission nor tries to register the now-duplicate script id (which
  // would throw).
  permissions.request = async () => {
    throw new Error("must not re-request an already-granted origin");
  };
  const repeated = await addInstance("misskey.io", { permissions, scripting, storage });
  assert.deepEqual(repeated, { added: true });
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// addInstance(): Chrome tears the popup down the instant its permission
// dialog appears, so handlePermissionsAdded (wired to permissions.onAdded)
// can win the race and register the host before this call resumes. Losing
// that race must not throw on the now-duplicate script id, and must not
// double the stored host.
{
  const permissions = createFakePermissions();
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
  };

  const result = await addInstance("misskey.io", { permissions, scripting, storage });

  assert.deepEqual(result, { added: true });
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// removeInstance(): drops the registration, the permission, and the stored
// host together.
{
  const permissions = createFakePermissions(["https://misskey.io/*"]);
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io", "other.example"] })
  };

  await removeInstance("misskey.io", { permissions, scripting, storage });

  assert.equal(scripting.scripts.has("misskey-misskey.io"), false);
  assert.equal(permissions.origins.has("https://misskey.io/*"), false);
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["other.example"]);
}

// removeInstance(): a registration that is already gone (a previous removal
// died partway through) does not stop the permission and storage cleanup.
{
  const permissions = createFakePermissions(["https://misskey.io/*"]);
  const scripting = createFakeScripting();
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
  };

  await removeInstance("misskey.io", { permissions, scripting, storage });

  assert.equal(permissions.origins.has("https://misskey.io/*"), false);
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], []);
}

// handlePermissionsRemoved(): a host revoked from chrome://extensions loses
// its registration and its stored entry; an unrelated stored host is left
// alone.
{
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({
      [MISSKEY_INSTANCES_KEY]: ["misskey.io", "other.example"]
    })
  };

  await handlePermissionsRemoved(
    { origins: ["https://misskey.io/*"] },
    { scripting, storage }
  );

  assert.equal(scripting.scripts.has("misskey-misskey.io"), false);
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["other.example"]);
}

// handlePermissionsRemoved(): an unrelated permission removal touches
// nothing.
{
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
  };

  await handlePermissionsRemoved({ origins: ["https://other.test/*"] }, {
    scripting,
    storage
  });

  assert.ok(scripting.scripts.has("misskey-misskey.io"));
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// handlePermissionsAdded(): the backstop for addInstance() losing its popup
// mid-flight — a grant with no matching registration or stored host gets
// both.
{
  const scripting = createFakeScripting();
  const storage = { sync: createFakeStorageArea() };

  await handlePermissionsAdded(
    { origins: ["https://misskey.io/*"] },
    { scripting, storage }
  );

  assert.deepEqual(scripting.scripts.get("misskey-misskey.io"), {
    id: "misskey-misskey.io",
    matches: ["https://misskey.io/*"],
    js: [...MISSKEY_CONTENT_SCRIPT_FILES.js],
    css: [...MISSKEY_CONTENT_SCRIPT_FILES.css],
    runAt: "document_idle",
    persistAcrossSessions: true
  });
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// handlePermissionsAdded(): a host addInstance() already registered and
// stored before this listener heard the same grant is left alone — no
// duplicate script id, no duplicate storage entry.
{
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
  };

  await handlePermissionsAdded(
    { origins: ["https://misskey.io/*"] },
    { scripting, storage }
  );

  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// handlePermissionsAdded(): a registration addInstance() already made, for a
// host the storage write from that same call has not landed yet, is adopted
// without re-registering.
{
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = { sync: createFakeStorageArea() };

  await handlePermissionsAdded(
    { origins: ["https://misskey.io/*"] },
    { scripting, storage }
  );

  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// handlePermissionsAdded(): a grant that is not a well-formed single-host
// https origin (a manifest permission string, or an origin with a path)
// touches nothing rather than registering garbage.
{
  const scripting = createFakeScripting();
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["kept.example"] })
  };

  await handlePermissionsAdded(
    { origins: ["<all_urls>", "https://example.com/path/*"] },
    { scripting, storage }
  );

  assert.equal(scripting.scripts.size, 0);
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["kept.example"]);
}

// handlePermissionsAdded(): no origins at all (an empty onAdded payload,
// which should not occur but costs nothing to guard) is a no-op.
{
  const scripting = createFakeScripting();
  const storage = { sync: createFakeStorageArea() };

  await handlePermissionsAdded({ origins: [] }, { scripting, storage });

  assert.equal(scripting.scripts.size, 0);
  assert.equal(storage.sync.state[MISSKEY_INSTANCES_KEY], undefined);
}

// reconcileInstances(): a stored host whose permission is still granted but
// whose registration was lost gets re-registered.
{
  const permissions = createFakePermissions(["https://misskey.io/*"]);
  const scripting = createFakeScripting();
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
  };

  await reconcileInstances({ permissions, scripting, storage });

  assert.ok(scripting.scripts.has("misskey-misskey.io"));
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["misskey.io"]);
}

// reconcileInstances(): a stored host whose permission was revoked while
// Sift was not running to hear permissions.onRemoved loses its registration
// and its stored entry.
{
  const permissions = createFakePermissions();
  const scripting = createFakeScripting([
    { id: "misskey-misskey.io", matches: ["https://misskey.io/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["misskey.io"] })
  };

  await reconcileInstances({ permissions, scripting, storage });

  assert.equal(scripting.scripts.has("misskey-misskey.io"), false);
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], []);
}

// reconcileInstances(): a registered script with no matching stored host at
// all (a removeInstance() that saved storage but died before unregistering)
// gets cleaned up without touching a legitimately kept one.
{
  const permissions = createFakePermissions(["https://kept.example/*"]);
  const scripting = createFakeScripting([
    { id: "misskey-kept.example", matches: ["https://kept.example/*"] },
    { id: "misskey-orphan.example", matches: ["https://orphan.example/*"] }
  ]);
  const storage = {
    sync: createFakeStorageArea({ [MISSKEY_INSTANCES_KEY]: ["kept.example"] })
  };

  await reconcileInstances({ permissions, scripting, storage });

  assert.ok(scripting.scripts.has("misskey-kept.example"));
  assert.equal(scripting.scripts.has("misskey-orphan.example"), false);
  assert.deepEqual(storage.sync.state[MISSKEY_INSTANCES_KEY], ["kept.example"]);
}

// utils/settings.js normalizes the stored instance list the same way: invalid
// and duplicate entries are dropped, and a missing/non-array value becomes
// an empty list rather than throwing.
assert.deepEqual(
  normalizeSettings({ misskeyInstances: ["misskey.io", "misskey.io", "http://bad", "x.com"] })
    .misskeyInstances,
  ["misskey.io", "x.com"]
);
assert.deepEqual(normalizeSettings({}).misskeyInstances, []);
assert.deepEqual(normalizeSettings({ misskeyInstances: "not-an-array" }).misskeyInstances, []);
assert.deepEqual(defaults.misskeyInstances, []);

// TEMPORARY — proves the ruleset refuses a red pull request. Reverted in the
// next commit on this branch; never merged.
assert.equal(1, 2, "intentional failure for the merge gate check");

console.log("Sift tests passed");
