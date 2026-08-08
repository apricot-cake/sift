// Misskey. Everything in this file is Misskey's page structure — which element
// is a note, and where each classification input is written. The classification
// itself lives in filter-core.ts and is shared by every service.
//
// Misskey gives a reader almost nothing to hold on to. Class names are per-build
// hashes (CSS Modules) and the data-cy-* attributes older versions carried are
// gone, so the only stable handles are element names, the global utility class
// `_button`, the avatar's `_noSelect`, and the icon-font classes `ti ti-*`
// (see #2's issue comment, section 3). Every selector below is one of those.
//
// Verified on 2026-08-05 against two live instances at opposite ends of the
// range Sift has to survive: misskey.io (2025.4.1-io, a fork) and misskey.design
// (2026.7.0, close to upstream). Reaction totals, note times and media presence
// were read off the DOM and compared against each instance's own API answer for
// the same notes.
import { parseMetric } from "../filter-core.ts";
import { MISSKEY_REACTION_THRESHOLDS } from "../settings.ts";
import type { ServiceAdapter } from "./types.ts";

// Misskey's page structure in one place, so a change on an instance's side is
// one edit here. Not exported: what a test supplies is markup, and what it reads
// is the answer this file gives for it (utils/adapters/misskey.test.ts).
const MISSKEY_SELECTORS = Object.freeze({
  // A note renders as <div>(root) > <article>. Nothing else in the client uses
  // <article>, but an instance's own additions might, so a card also has to
  // carry a note's timestamp to count as one.
  postCard: "article",
  createdAt: "time[title]",
  // Reaction chips and the footer's reply/renote/react buttons are all
  // `button._button`; readReactionCount() below is what tells them apart.
  reactionButton: "button._button",
  icon: 'i[class*="ti-"]',
  // The renote header's icon. It also appears on the footer's renote button,
  // which is why readIsRepost() looks only above the article.
  repost: "i.ti-repeat",
  // The avatar and its decorations. `_noSelect` is a global utility class, not
  // a hashed one.
  avatar: "._noSelect",
  // An unplayed video is a <video> on some builds and a thumbnail <img> under a
  // play icon on others; a video the reader has to click to reveal is neither.
  video: "video, i.ti-player-play, i.ti-movie",
  // What a hidden image leaves behind: the placeholder for a sensitive file
  // (which says nothing about its type) or for one the data saver held back.
  hiddenMedia: "i.ti-photo, i.ti-eye-exclamation",
  // Written into the page the server sends, before any of the client runs.
  application: 'meta[name="application-name"][content="Misskey"]',
});

// Whether this page is a Misskey instance. Asked of hosts Sift was not built
// for — the ones a reader added — because a host being in that list is the
// reader's claim, and this is the page's own answer. Every instance checked on
// 2026-08-05 carries the tag, forks included (misskey.io, misskey.design,
// submarin.online, nijimiss.moe, misskey.systems, mi.yumechi.jp): it comes from
// the server's HTML template rather than from the client build.
export function isMisskeyPage(page: ParentNode): boolean {
  return Boolean(page.querySelector(MISSKEY_SELECTORS.application));
}

// A custom emoji's alt text, local (":party:") or remote (":party@example:").
const EMOJI_SHORTCODE = /^:.+:$/;
// Emoji drawn as characters rather than as an image: what a native-emoji
// reaction leaves in a chip's text, and what MkEmoji puts in an img's alt.
// Digits are deliberately not stripped — \p{Emoji_Component} would take them.
//
// \uFE0F (variation selector-16) and \u200D (zero-width joiner) are what holds a
// multi-codepoint emoji together, and this takes them one codepoint at a time on
// purpose: the point is to leave nothing of the emoji behind, not to match it as
// one grapheme. An alternation rather than one character class, because a
// combining mark inside a class matches on its own there anyway and reads as if
// it were part of the character before it.
const EMOJI_TEXT =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u200D|\s/gu;
// A reaction chip's text is its count and nothing else, once the emoji is out.
const COUNT_ONLY = /^\d[\d,]*$/;

function noteCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(MISSKEY_SELECTORS.postCard)).filter(
    (postCard) => postCard.querySelector(MISSKEY_SELECTORS.createdAt),
  );
}

// True for an image that is part of the note's media, rather than an avatar, an
// avatar decoration, a role badge or an emoji. Misskey marks none of these, so
// the reading is what they leave in `alt`: media carries the file's comment or
// name, and nothing else carries readable text.
function isNoteImage(image: Element): boolean {
  if (image.closest(MISSKEY_SELECTORS.avatar)) {
    return false;
  }

  // A video's poster frame is an <img> as well, and it carries the file's own
  // comment as alt — readable text, like a picture's. What tells them apart is
  // the play control drawn over it, in the same wrapper.
  if (image.parentElement?.querySelector(MISSKEY_SELECTORS.video)) {
    return false;
  }

  const alt = (image.getAttribute("alt") ?? "").trim();
  // Empty or absent: an avatar decoration, a role badge, a video's thumbnail.
  if (alt === "" || EMOJI_SHORTCODE.test(alt)) {
    return false;
  }
  return alt.replace(EMOJI_TEXT, "") !== "";
}

// `satisfies` rather than a `:` annotation — see x.ts for why.
export const misskeyAdapter = Object.freeze({
  id: "misskey",
  // Empty, and not an oversight: Misskey hosts are added by the reader one at a
  // time and registered at runtime (utils/instances.ts), so there is nothing
  // for the manifest to declare at build time. selectAdapter() is what routes a
  // page to this adapter instead.
  matches: Object.freeze([]),
  // Misskey's reaction is one per reader like a like is, but instance sizes
  // differ from X's by orders of magnitude, so it counts against its own
  // thresholds (see #2's issue comment, section 4).
  reactionLabel: "リアクション",
  thresholdKeys: MISSKEY_REACTION_THRESHOLDS,

  getPostCards(root: ParentNode) {
    return noteCards(root);
  },

  hasPostCards(root: ParentNode) {
    return noteCards(root).length > 0;
  },

  // The unit that gets hidden is the note's root, not the article: the renote
  // header and the note being replied to are drawn outside the article, and
  // hiding the article alone would leave them behind.
  findPostCell(postCard: Element) {
    return postCard.parentElement ?? postCard;
  },

  // Misskey does not put a reaction total in the page. The footer can show one,
  // but only for a reader who turned that setting on (`showReactionsCount`,
  // off by default), so what is always there is one chip per emoji, each with
  // its own count — this adds them up.
  //
  // The chips are told apart from the footer's buttons, which share the same
  // `_button` class, by what they contain: every footer button leads with a
  // `ti-*` icon, and a chip's text is its count alone (the emoji is an image,
  // or a character this strips). A "show more" button inside a long note is a
  // `_button` too, and its text is words rather than a number.
  //
  // The chips stop at 16 emoji, which is Misskey's own limit and not a reading
  // Sift can widen: a note reacted to with more kinds than that reads low here
  // by the tail it never draws.
  readReactionCount(postCard: Element) {
    let total = 0;

    for (const button of postCard.querySelectorAll(
      MISSKEY_SELECTORS.reactionButton,
    )) {
      if (button.querySelector(MISSKEY_SELECTORS.icon)) {
        continue;
      }

      const text = (button.textContent ?? "").replace(EMOJI_TEXT, "");
      if (COUNT_ONLY.test(text)) {
        total += parseMetric(text);
      }
    }

    return total;
  },

  // Misskey writes no <time datetime>. What it has is the absolute time in the
  // element's title, formatted for whatever locale the reader's browser asks
  // for, so Date.parse understands some readers' pages and not others'. When it
  // does not, the post still classifies and only "rising" drops.
  //
  // A day-first format ("5.8.2026, 17:44:21") is the one case that neither
  // reads nor fails: Date.parse takes it month-first and answers a date months
  // away. That answer only ever falls outside the rising window, so it costs
  // the same "rising" and nothing more.
  readCreatedAt(postCard: Element) {
    const title = postCard
      .querySelector(MISSKEY_SELECTORS.createdAt)
      ?.getAttribute("title");
    const timestamp = title ? Date.parse(title) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  },

  // Image and video are reported separately: which of them counts as media is
  // the reader's setting, not this service's structure. A file the client is
  // holding back behind a click counts as an image — the placeholder says a
  // file is there but not what it is, and a note read as having no media at all
  // would be hidden outright.
  readMedia(postCard: Element) {
    const images = Array.from(postCard.querySelectorAll("img")).some(
      isNoteImage,
    );
    return {
      hasImage:
        images ||
        Boolean(postCard.querySelector(MISSKEY_SELECTORS.hiddenMedia)),
      hasVideo: Boolean(postCard.querySelector(MISSKEY_SELECTORS.video)),
    };
  },

  // A renote is drawn as a header above the article, inside the same root. The
  // header's text is localized ("◯◯がリノート") and carries no marker of its
  // own, so the icon is the reading — but the footer's renote button uses that
  // same icon, which is why only the elements before the article are looked at.
  //
  // A quote renote is not a renote here: it carries its author's own text and
  // renders as an ordinary note, which is what keeps it out of hideReposts.
  readIsRepost(postCard: Element) {
    const root = postCard.parentElement;
    if (!root) {
      return false;
    }

    for (const sibling of root.children) {
      if (sibling === postCard) {
        return false;
      }
      if (sibling.querySelector(MISSKEY_SELECTORS.repost)) {
        return true;
      }
    }

    return false;
  },
}) satisfies ServiceAdapter;
