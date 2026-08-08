import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drainErrorLog, ERROR_LOG_DRAINED_SEQ_KEY } from "./utils/error-drain.ts";
import {
  appendErrorEntry,
  collectUndrainedEntries,
  describeUncaughtEvent,
  ERROR_LOG_KEY,
  installUncaughtReporting,
  isOwnExtensionError,
  recordErrorEntry,
  type ErrorLogEntry,
  type ErrorLogStorage
} from "./utils/error-log.ts";
import { formatErrorLogLines } from "./scripts/dev-error-log.ts";
import { decideDevLinkAction } from "./utils/dev-link.ts";
import { ADAPTERS, hostMatchesPattern, selectAdapter } from "./utils/adapters/index.ts";
import {
  BLUESKY_SELECTORS,
  blueskyAdapter,
  timestampFromRecordKey
} from "./utils/adapters/bluesky.ts";
import {
  isMisskeyPage,
  MISSKEY_SELECTORS,
  misskeyAdapter
} from "./utils/adapters/misskey.ts";
import { X_SELECTORS, xAdapter } from "./utils/adapters/x.ts";
import { SITE_MATCHES } from "./utils/site-matches.ts";
import { classifyPost, parseMetric } from "./utils/filter-core.ts";
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
  removeInstance,
  type InstancePermissions,
  type InstanceScripting,
  type RegisteredContentScript
} from "./utils/instances.ts";
import {
  defaults,
  LIKE_THRESHOLDS,
  MISSKEY_REACTION_THRESHOLDS,
  normalizeSettings,
  thresholdsFor
} from "./utils/settings.ts";

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
// Cast to Element at the boundary: this fake only ever needs to satisfy the
// three DOM methods an adapter actually calls, not the real interface.
function createFakeNode(
  responses: Record<string, unknown> = {},
  extras: Record<string, unknown> = {}
): Element {
  return {
    querySelector(selector: string) {
      return responses[selector] ?? null;
    },
    querySelectorAll(selector: string) {
      const value = responses[selector];
      if (!value) {
        return [];
      }
      return Array.isArray(value) ? value : [value];
    },
    closest(selector: string) {
      return responses[selector] ?? null;
    },
    ...extras
  } as unknown as Element;
}

function createFakeAttributeNode(
  attributes: Record<string, unknown> = {},
  textContent = ""
): Element {
  return {
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    textContent
  } as unknown as Element;
}

// A page that says it is a Misskey instance, and one that says nothing.
const misskeyPage = createFakeNode({
  [MISSKEY_SELECTORS.application]: { id: "application-name" }
});
const otherPage = createFakeNode();

// Every adapter answers for each of its own match patterns, and for no other
// adapter's: the host name has to pick one adapter, not a set.
for (const adapter of ADAPTERS) {
  for (const pattern of adapter.matches) {
    const host = pattern
      .slice(pattern.indexOf("://") + 3)
      .replace(/\/.*$/, "")
      .replace(/^\*\./, "");
    assert.equal(
      selectAdapter(host, otherPage),
      adapter,
      `${pattern} selects ${adapter.id}`
    );
  }
}

assert.equal(selectAdapter("x.com", otherPage), xAdapter);
assert.equal(selectAdapter("twitter.com", otherPage), xAdapter);
assert.equal(selectAdapter("bsky.app", otherPage), blueskyAdapter);
assert.equal(selectAdapter("notx.com", otherPage), null);
// A match pattern without the "*." prefix does not cover subdomains.
assert.equal(selectAdapter("mobile.x.com", otherPage), null);

// Misskey has no declared host: a page is read as Misskey when the page itself
// says so, which is the only claim available for a host the reader added.
assert.equal(selectAdapter("misskey.example", misskeyPage), misskeyAdapter);
assert.equal(selectAdapter("misskey.example", otherPage), null);
// A declared service is never re-read as Misskey, whatever the page claims.
assert.equal(selectAdapter("x.com", misskeyPage), xAdapter);
assert.equal(isMisskeyPage(misskeyPage), true);
assert.equal(isMisskeyPage(otherPage), false);
assert.deepEqual(misskeyAdapter.matches, []);

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

function createBlueskyPostWithLink(attributes: Record<string, unknown>) {
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
function createFakeProfileLink({
  hasAvatar = false,
  firstChildTag = null
}: { hasAvatar?: boolean; firstChildTag?: string | null } = {}) {
  return createFakeNode(hasAvatar ? { img: { id: "avatar" } } : {}, {
    firstElementChild: firstChildTag === null ? null : { tagName: firstChildTag }
  });
}

function createBlueskyPostWithProfileLink(
  options?: { hasAvatar?: boolean; firstChildTag?: string | null }
) {
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
assert.equal(blueskyAdapter.thresholdKeys, xAdapter.thresholdKeys);
assert.equal(xAdapter.thresholdKeys, LIKE_THRESHOLDS);

// -- Misskey (utils/adapters/misskey.ts) --
//
// Nothing in a Misskey note is marked: the classes are per-build hashes, so
// every reading below is a shape rather than a name. The fakes are built from
// the adapter's own selector table for that reason.

function createFakeMisskeyImage(
  alt: string | null,
  {
    insideAvatar = false,
    isVideoPoster = false
  }: { insideAvatar?: boolean; isVideoPoster?: boolean } = {}
): Element {
  return createFakeNode(
    insideAvatar ? { [MISSKEY_SELECTORS.avatar]: { id: "avatar" } } : {},
    {
      getAttribute: (name: string) => (name === "alt" ? alt : null),
      parentElement: isVideoPoster
        ? createFakeNode({ [MISSKEY_SELECTORS.video]: { id: "play" } })
        : createFakeNode()
    }
  );
}

// A reaction chip carries its count as its only text; a footer button leads
// with a `ti-*` icon, and both are `button._button`.
function createFakeMisskeyButton(
  text: string,
  { hasIcon = false }: { hasIcon?: boolean } = {}
): Element {
  return createFakeNode(hasIcon ? { [MISSKEY_SELECTORS.icon]: { id: "icon" } } : {}, {
    textContent: text
  });
}

function createFakeMisskeyNote({
  time = null,
  buttons = [],
  images = [],
  video = false,
  hiddenMedia = false
}: {
  time?: string | null;
  buttons?: Element[];
  images?: Element[];
  video?: boolean;
  hiddenMedia?: boolean;
} = {}): Element {
  return createFakeNode({
    ...(time === null
      ? {}
      : { [MISSKEY_SELECTORS.createdAt]: createFakeAttributeNode({ title: time }) }),
    [MISSKEY_SELECTORS.reactionButton]: buttons,
    img: images,
    ...(video ? { [MISSKEY_SELECTORS.video]: { id: "video" } } : {}),
    ...(hiddenMedia ? { [MISSKEY_SELECTORS.hiddenMedia]: { id: "placeholder" } } : {})
  });
}

// A note's root holds the renote header and the reply it answers, both drawn
// outside the article, and it is the root that gets hidden.
function createFakeMisskeyRoot(postCard: Element, before: Element[] = []): Element {
  const root = createFakeNode({}, { children: [...before, postCard] });
  Object.assign(postCard, { parentElement: root });
  return root;
}

const misskeyNote = createFakeMisskeyNote({ time: "2026/8/5 17:44:21" });
const misskeyNoteRoot = createFakeMisskeyRoot(misskeyNote);
// An instance can put an <article> on the page that is not a note at all
// (misskey.io draws its ads that way). A note always carries its own timestamp.
const misskeyNonNote = createFakeNode();
const misskeyRoot = createFakeNode({
  [MISSKEY_SELECTORS.postCard]: [misskeyNote, misskeyNonNote]
});

assert.deepEqual(misskeyAdapter.getPostCards(misskeyRoot), [misskeyNote]);
assert.deepEqual(misskeyAdapter.getPostCards(emptyRoot), []);
assert.equal(misskeyAdapter.hasPostCards(misskeyRoot), true);
assert.equal(
  misskeyAdapter.hasPostCards(
    createFakeNode({ [MISSKEY_SELECTORS.postCard]: [misskeyNonNote] })
  ),
  false
);
assert.equal(misskeyAdapter.findPostCell(misskeyNote), misskeyNoteRoot);
// A card with no root of its own is still a unit that can be hidden.
assert.equal(misskeyAdapter.findPostCell(misskeyNonNote), misskeyNonNote);

// No reaction total exists in the page — the footer's is off by default — so
// the per-emoji chips are added up. Everything else wearing `_button` has to
// stay out: the footer's buttons (each led by an icon) and a long note's
// "show more" (words rather than a number).
assert.equal(
  misskeyAdapter.readReactionCount(
    createFakeMisskeyNote({
      buttons: [
        createFakeMisskeyButton("12"),
        createFakeMisskeyButton("3"),
        // A native emoji is text, and the count is what is left of it.
        createFakeMisskeyButton("😀5"),
        createFakeMisskeyButton("もっと見る"),
        createFakeMisskeyButton("16", { hasIcon: true }),
        createFakeMisskeyButton("2,397", { hasIcon: true })
      ]
    })
  ),
  20
);
assert.equal(misskeyAdapter.readReactionCount(createFakeMisskeyNote()), 0);

// The timestamp is localized text in a title attribute, so it reads for some
// readers and not others. When it does not, only "rising" drops.
assert.equal(
  misskeyAdapter.readCreatedAt(createFakeMisskeyNote({ time: "2026/8/5 17:44:21" })),
  Date.parse("2026/8/5 17:44:21")
);
// A Korean reader's page, which Date.parse refuses outright.
assert.equal(
  Number.isNaN(
    misskeyAdapter.readCreatedAt(
      createFakeMisskeyNote({ time: "2026. 8. 5. 오후 5:44:21" })
    )
  ),
  true
);
assert.equal(Number.isNaN(misskeyAdapter.readCreatedAt(createFakeMisskeyNote())), true);

// Media is told from an avatar, a role badge and an emoji by what the image
// leaves in `alt`: the file's name or comment, and nothing else readable.
assert.deepEqual(
  misskeyAdapter.readMedia(
    createFakeMisskeyNote({ images: [createFakeMisskeyImage("IMG_8802.png")] })
  ),
  { hasImage: true, hasVideo: false }
);
assert.deepEqual(
  misskeyAdapter.readMedia(
    createFakeMisskeyNote({
      images: [
        createFakeMisskeyImage("", { insideAvatar: true }),
        createFakeMisskeyImage(":party@example.com:"),
        createFakeMisskeyImage("😀"),
        createFakeMisskeyImage(null)
      ]
    })
  ),
  { hasImage: false, hasVideo: false }
);
// A video's poster frame is an <img> carrying the file's own comment, which
// reads exactly like a picture's alt. The play control over it is the
// difference, and without it a video would also count as an image — which the
// "images only" setting would then let through.
assert.deepEqual(
  misskeyAdapter.readMedia(
    createFakeMisskeyNote({
      video: true,
      images: [
        createFakeMisskeyImage("道具箱を開けて中身を紹介する動画。", { isVideoPoster: true })
      ]
    })
  ),
  { hasImage: false, hasVideo: true }
);

// A file the client is holding back behind a click says a file is there but not
// what it is; reading it as no media at all would hide the note outright.
assert.deepEqual(misskeyAdapter.readMedia(createFakeMisskeyNote({ hiddenMedia: true })), {
  hasImage: true,
  hasVideo: false
});
assert.deepEqual(misskeyAdapter.readMedia(createFakeMisskeyNote({ video: true })), {
  hasImage: false,
  hasVideo: true
});
assert.deepEqual(misskeyAdapter.readMedia(createFakeMisskeyNote()), {
  hasImage: false,
  hasVideo: false
});

// The renote header sits above the article, inside the same root. The footer's
// renote button wears the same icon, which is why only what precedes the
// article counts — otherwise every note would read as a renote.
const misskeyRenoteHeader = createFakeNode({
  [MISSKEY_SELECTORS.repost]: { id: "repeat" }
});
const misskeyRenote = createFakeMisskeyNote({ time: "2026/8/5 17:44:21" });
createFakeMisskeyRoot(misskeyRenote, [misskeyRenoteHeader]);
assert.equal(misskeyAdapter.readIsRepost(misskeyRenote), true);

const misskeyPlainNote = createFakeMisskeyNote({ time: "2026/8/5 17:44:21" });
createFakeMisskeyRoot(misskeyPlainNote, [createFakeNode()]);
assert.equal(misskeyAdapter.readIsRepost(misskeyPlainNote), false);
// The icon inside the card itself is the footer's renote button.
const misskeyNoteWithFooterIcon = createFakeMisskeyNote({ time: "2026/8/5 17:44:21" });
Object.assign(misskeyNoteWithFooterIcon, {
  querySelector: (selector: string) =>
    selector === MISSKEY_SELECTORS.repost ? { id: "repeat" } : null
});
createFakeMisskeyRoot(misskeyNoteWithFooterIcon);
assert.equal(misskeyAdapter.readIsRepost(misskeyNoteWithFooterIcon), false);
assert.equal(misskeyAdapter.readIsRepost(createFakeNode()), false);

// A reaction is one per reader like a like is, but instance sizes differ by
// orders of magnitude, so it counts against its own pair of thresholds.
assert.equal(misskeyAdapter.reactionLabel, "リアクション");
assert.equal(misskeyAdapter.thresholdKeys, MISSKEY_REACTION_THRESHOLDS);
assert.notEqual(misskeyAdapter.thresholdKeys, xAdapter.thresholdKeys);

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
  describeUncaughtEvent({ message: "x".repeat(600) }, "error").message?.length,
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

let ringBuffer: ErrorLogEntry[] = [];
for (let index = 0; index < 5; index += 1) {
  ringBuffer = appendErrorEntry(
    ringBuffer,
    { source: "test", message: `error ${index}` },
    3
  );
}
assert.deepEqual(
  ringBuffer.map((entry) => entry.seq),
  [3, 4, 5]
);
assert.equal(ringBuffer[0]?.message, "error 2");

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

function createFakeStorageArea(initial: Record<string, unknown> = {}) {
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

function createFakeTarget(href: string | null = null) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    location: href === null ? undefined : { href },
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener)
      );
    },
    emit(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

const contentTarget = createFakeTarget("https://x.com/home");
const recorded: Omit<ErrorLogEntry, "seq">[] = [];
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

// The explicit type argument keeps `assert.deepEqual` (aliased to
// deepStrictEqual, whose type is `asserts actual is T`) from narrowing
// `recorded`'s type to this literal for the rest of the file — `recorded` is
// still being pushed to below.
assert.deepEqual<Omit<ErrorLogEntry, "seq">[]>(recorded, [
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
  record: (entry) => {
    recorded.push(entry);
  }
});
pageTarget.emit("error", { message: "anything on an extension page", error: null });
assert.equal(recorded.length, 3);
assert.equal(recorded[2]?.source, "popup");

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
      { source: "test", seq: 1, message: "first" },
      { source: "test", seq: 2, message: "second" }
    ]
  }),
  session: createFakeStorageArea()
};
const posted: (ErrorLogEntry[] | "again")[] = [];

assert.deepEqual(
  await drainErrorLog({
    storage: drainStorage,
    post: (entries) => {
      posted.push(entries);
    }
  }),
  { forwarded: 2 }
);
assert.deepEqual<(ErrorLogEntry[] | "again")[]>(posted, [
  [
    { source: "test", seq: 1, message: "first" },
    { source: "test", seq: 2, message: "second" }
  ]
]);
assert.equal(drainStorage.session.state[ERROR_LOG_DRAINED_SEQ_KEY], 2);

assert.deepEqual(
  await drainErrorLog({
    storage: drainStorage,
    post: () => {
      posted.push("again");
    }
  }),
  { forwarded: 0 }
);
assert.equal(posted.length, 1);

// A post that fails leaves the mark alone so the entries go out next time.
const previousLocalLog = drainStorage.local.state[ERROR_LOG_KEY];
drainStorage.local.state[ERROR_LOG_KEY] = [
  ...(Array.isArray(previousLocalLog) ? previousLocalLog : []),
  { source: "test", seq: 3, message: "third" }
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
    post: (entries) => {
      posted.push(entries);
    }
  }),
  { forwarded: 1 }
);
assert.deepEqual<ErrorLogEntry[] | "again" | undefined>(posted.at(-1), [
  { source: "test", seq: 3, message: "third" }
]);

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

// -- Misskey instance permission and registration (utils/instances.ts) --

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

function createFakePermissions(grantedOrigins: string[] = []) {
  const origins = new Set(grantedOrigins);
  return {
    origins,
    async request({ origins: requested }: { origins: string[] }) {
      for (const origin of requested) {
        origins.add(origin);
      }
      return true;
    },
    async remove({ origins: requested }: { origins: string[] }) {
      let removedAny = false;
      for (const origin of requested) {
        removedAny = origins.delete(origin) || removedAny;
      }
      return removedAny;
    },
    async contains({ origins: requested }: { origins: string[] }) {
      return requested.every((origin) => origins.has(origin));
    }
  };
}

// A registered script as this fake stores it. Looser than the real
// RegisteredContentScript: seed data for getRegisteredContentScripts() in
// tests below only ever supplies `id` and sometimes `matches`.
interface FakeRegisteredScript {
  id: string;
  matches?: string[];
  js?: string[];
  css?: string[];
  runAt?: string;
  persistAcrossSessions?: boolean;
}

function createFakeScripting(initialScripts: FakeRegisteredScript[] = []) {
  const scripts = new Map<string, FakeRegisteredScript>(
    initialScripts.map((script) => [script.id, script])
  );
  return {
    scripts,
    async registerContentScripts(registered: RegisteredContentScript[]) {
      for (const script of registered) {
        assert.ok(!scripts.has(script.id), `duplicate script id ${script.id}`);
        scripts.set(script.id, script);
      }
    },
    async unregisterContentScripts({ ids }: { ids?: string[] } = {}) {
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

// utils/settings.ts normalizes the stored instance list the same way: invalid
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

// Misskey's thresholds are stored beside X's and normalized the same way.
assert.equal(normalizeSettings({ misskeyMinReactions: "35" }).misskeyMinReactions, 35);
assert.equal(
  normalizeSettings({ misskeyMinReactions: -4 }).misskeyMinReactions,
  0
);
assert.equal(
  normalizeSettings({ misskeyRisingMinReactions: "not a number" })
    .misskeyRisingMinReactions,
  defaults.misskeyRisingMinReactions
);

// The classification takes one pair of numbers, and which pair depends on the
// service. Everything else it takes is shared by all of them.
{
  const stored = normalizeSettings({
    minLikes: 500,
    risingMinLikes: 100,
    misskeyMinReactions: 20,
    misskeyRisingMinReactions: 5,
    risingMaxAgeHours: 6,
    hideReposts: true
  });

  assert.deepEqual(thresholdsFor(stored, LIKE_THRESHOLDS), {
    hideReposts: true,
    minLikes: 500,
    risingEnabled: true,
    risingMinLikes: 100,
    risingMaxAgeHours: 6
  });
  assert.deepEqual(thresholdsFor(stored, MISSKEY_REACTION_THRESHOLDS), {
    hideReposts: true,
    minLikes: 20,
    risingEnabled: true,
    risingMinLikes: 5,
    risingMaxAgeHours: 6
  });
}

// The content stylesheet reacts to the state the content script writes, and
// never to a service's page structure — otherwise the highlight would appear on
// whichever service the CSS happened to name (it named X's post card, so the
// line was drawn on X alone), and every new adapter would have to add a rule
// here. Reading the file rather than the rules: the assertion is about what the
// stylesheet is allowed to mention, which no DOM would show.
{
  const contentStyles = readFileSync(
    new URL("./entrypoints/content/style.css", import.meta.url),
    "utf8"
  );

  for (const serviceSpecific of ["data-testid", "tweet", "feedItem", "bsky", "article"]) {
    assert.equal(
      contentStyles.includes(serviceSpecific),
      false,
      `entrypoints/content/style.css names ${serviceSpecific}, which is one service's page structure`
    );
  }

  // Both highlights are keyed off the state attribute alone, so they match the
  // cell every adapter marks.
  for (const state of ["hit", "rising"]) {
    assert.match(
      contentStyles,
      new RegExp(`\\[data-sift-filter-state="${state}"\\]\\s*\\{`),
      `entrypoints/content/style.css has no rule matching the ${state} cell itself`
    );
  }

  // The extension was renamed to Sift long before this file existed, and the
  // attributes and class names the content script writes onto the page were the
  // last place the old prefix survived. They are a public surface — a reader's
  // own CSS, and any other extension on the same page, can see them — so the
  // old name must not come back through a copied line.
  for (const source of [
    "./entrypoints/content/style.css",
    "./entrypoints/content/index.ts"
  ]) {
    assert.equal(
      readFileSync(new URL(source, import.meta.url), "utf8").includes("xif"),
      false,
      `${source} still writes the extension's old name onto the page`
    );
  }
}

console.log("Sift tests passed");
