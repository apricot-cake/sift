import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { MISSKEY_REACTION_THRESHOLDS } from "../settings.ts";
import { misskeyAdapter } from "./misskey.ts";
import { REACTION_LABELS } from "./types.ts";
import { xAdapter } from "./x.ts";

// Nothing in a Misskey note is marked: the class names are per-build hashes and
// the data-cy-* attributes older versions carried are gone, so every reading is
// a shape. A note renders as <div>(root) > <article>, with the renote header and
// the note being replied to drawn inside the root and outside the article.
const noteTime = "2026/8/5 17:44:21";

function renderNoteRoot({
  time = noteTime as string | null,
  header = "",
  body = "",
} = {}): HTMLElement {
  return render(`
    <div>
      ${header}
      <article>
        ${time === null ? "" : `<time title="${time}">3分前</time>`}
        ${body}
      </article>
    </div>
  `);
}

function renderNote(options?: Parameters<typeof renderNoteRoot>[0]): Element {
  const note = renderNoteRoot(options).querySelector("article");
  if (!note) {
    throw new Error("the rendered note has no article");
  }
  return note;
}

describe("finding notes", () => {
  it("finds the notes on a timeline", () => {
    const timeline = render(
      `${renderNoteRoot().innerHTML}${renderNoteRoot().innerHTML}`,
    );

    expect(misskeyAdapter.getPostCards(timeline)).toHaveLength(2);
    expect(misskeyAdapter.hasPostCards(timeline)).toBe(true);
  });

  // An instance can put an <article> on the page that is not a note at all
  // (misskey.io draws its ads that way). A note always carries its own
  // timestamp, and that is what tells the two apart.
  it("leaves out an article that carries no note time", () => {
    const timeline = render(
      `${renderNoteRoot().innerHTML}${renderNoteRoot({ time: null }).innerHTML}`,
    );

    expect(misskeyAdapter.getPostCards(timeline)).toHaveLength(1);
  });

  it("finds none where every article is something else", () => {
    const page = render(renderNoteRoot({ time: null }).innerHTML);

    expect(misskeyAdapter.getPostCards(page)).toEqual([]);
    expect(misskeyAdapter.hasPostCards(page)).toBe(false);
  });
});

describe("the unit that gets hidden", () => {
  // The renote header and the note being replied to are drawn outside the
  // article, so hiding the article alone would leave them behind.
  it("is the note's root, not the article", () => {
    const root = renderNoteRoot();
    const note = root.querySelector("article");
    if (!note) {
      throw new Error("the rendered note has no article");
    }

    expect(misskeyAdapter.findPostCell(note)).toBe(root.firstElementChild);
  });

  it("falls back to the card where it has no root of its own", () => {
    const orphan = render("<article></article>").firstElementChild;
    if (!orphan) {
      throw new Error("the rendered article is missing");
    }
    orphan.remove();

    expect(misskeyAdapter.findPostCell(orphan)).toBe(orphan);
  });
});

// No reaction total exists in the page — the footer's is off by default — so the
// per-emoji chips are added up. Everything else wearing `_button` has to stay
// out: the footer's buttons (each led by a `ti-*` icon) and a long note's "show
// more" (words rather than a number).
describe("reading the reaction count", () => {
  it("adds up the per-emoji chips and leaves everything else out", () => {
    const note = renderNote({
      body: `
        <div>
          <button class="_button"><img alt=":party:">12</button>
          <button class="_button"><img alt=":blobcat:">3</button>
          <button class="_button">😀5</button>
          <button class="_button">もっと見る</button>
        </div>
        <footer>
          <button class="_button"><i class="ti ti-repeat"></i>16</button>
          <button class="_button"><i class="ti ti-plus"></i>2,397</button>
        </footer>
      `,
    });

    expect(misskeyAdapter.readReactionCount(note)).toBe(20);
  });

  it("answers 0 for a note nobody reacted to", () => {
    expect(misskeyAdapter.readReactionCount(renderNote())).toBe(0);
  });
});

// The timestamp is localized text in a title attribute, so it reads for some
// readers and not others. When it does not, only "rising" drops.
describe("reading the note time", () => {
  it("reads a time Date.parse understands", () => {
    expect(misskeyAdapter.readCreatedAt(renderNote())).toBe(
      Date.parse(noteTime),
    );
  });

  it("answers NaN for a locale Date.parse refuses", () => {
    // A Korean reader's page.
    const note = renderNote({ time: "2026. 8. 5. 오후 5:44:21" });

    expect(misskeyAdapter.readCreatedAt(note)).toBeNaN();
  });

  it("answers NaN where there is no time at all", () => {
    expect(misskeyAdapter.readCreatedAt(renderNote({ time: null }))).toBeNaN();
  });
});

// Media is told from an avatar, a role badge and an emoji by what the image
// leaves in `alt`: the file's name or comment, and nothing else readable.
describe("reading the media", () => {
  it("reads an attached image by the text its alt carries", () => {
    const note = renderNote({
      body: '<img alt="IMG_8802.png" src="/files/1.png">',
    });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("reads the avatar, the badges and the emoji as no media at all", () => {
    const note = renderNote({
      body: `
        <div class="_noSelect"><img alt="" src="/avatar.png"></div>
        <img alt=":party@example.com:" src="/emoji.png">
        <img alt="😀" src="/emoji.png">
        <img src="/decoration.png">
      `,
    });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });

  // A video's poster frame is an <img> carrying the file's own comment, which
  // reads exactly like a picture's alt. The play control drawn over it, in the
  // same wrapper, is the difference — and without it a video would also count as
  // an image, which the "images only" setting would then let through.
  it("does not read a video's poster frame as an image", () => {
    const note = renderNote({
      body: `
        <div>
          <img alt="道具箱を開けて中身を紹介する動画。" src="/files/thumb.png">
          <i class="ti ti-player-play"></i>
        </div>
      `,
    });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
  });

  it("reads a video the build draws as a video element", () => {
    const note = renderNote({ body: '<video src="/files/1.mp4"></video>' });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
  });

  // A file the client is holding back behind a click says a file is there but
  // not what it is; reading it as no media at all would hide the note outright.
  it("reads a file held back behind a click as an image", () => {
    const note = renderNote({ body: '<i class="ti ti-eye-exclamation"></i>' });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("reads a note with no files as having none", () => {
    expect(
      misskeyAdapter.readMedia(renderNote({ body: "<p>text only</p>" })),
    ).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });
});

// The renote header sits above the article, inside the same root. The footer's
// renote button wears the same icon, which is why only what precedes the article
// counts — otherwise every note would read as a renote.
describe("reading a renote", () => {
  it("reads the header drawn above the note", () => {
    const note = renderNote({
      header:
        '<div><i class="ti ti-repeat"></i><span>さんがリノート</span></div>',
    });

    expect(misskeyAdapter.readIsRepost(note)).toBe(true);
  });

  it("does not read the reply header above a note as one", () => {
    const note = renderNote({
      header: '<div><i class="ti ti-arrow-back-up"></i></div>',
    });

    expect(misskeyAdapter.readIsRepost(note)).toBe(false);
  });

  it("does not read the footer's own renote button as one", () => {
    const note = renderNote({
      body: '<footer><button class="_button"><i class="ti ti-repeat"></i></button></footer>',
    });

    expect(misskeyAdapter.readIsRepost(note)).toBe(false);
  });

  it("answers false for a card with no root", () => {
    const orphan = render("<article></article>").firstElementChild;
    if (!orphan) {
      throw new Error("the rendered article is missing");
    }
    orphan.remove();

    expect(misskeyAdapter.readIsRepost(orphan)).toBe(false);
  });
});

// A reaction is one per reader like a like is, but instance sizes differ from
// X's by orders of magnitude, so it counts against its own pair of thresholds.
describe("what the thresholds count", () => {
  it("is the reaction, against Misskey's own pair of numbers", () => {
    expect(misskeyAdapter.reactionLabels).toBe(REACTION_LABELS);
    expect(misskeyAdapter.reactionLabels).not.toBe(xAdapter.reactionLabels);
    expect(misskeyAdapter.thresholdKeys).toBe(MISSKEY_REACTION_THRESHOLDS);
    expect(misskeyAdapter.thresholdKeys).not.toBe(xAdapter.thresholdKeys);
  });
});
