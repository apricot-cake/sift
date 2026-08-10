import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { MISSKEY_REACTION_THRESHOLDS } from "../settings.ts";
import { misskeyAdapter } from "./misskey.ts";
import { REACTION_LABELS } from "./types.ts";
import { xAdapter } from "./x.ts";

// Misskey のノートには目印が何も無い＝クラス名はビルドごとのハッシュで、
// 古い版が持っていた data-cy-* も今は無い。だから読み取りは全部が形の話。
// ノートは <div>（根） > <article> として描かれ、リノートのヘッダと返信先の
// ノートは根の内側・article の外側に置かれる。
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
    throw new Error("描画したノートに article が無い");
  }
  return note;
}

describe("ノートを見つける", () => {
  it("タイムラインにあるノートを見つける", () => {
    const timeline = render(
      `${renderNoteRoot().innerHTML}${renderNoteRoot().innerHTML}`,
    );

    expect(misskeyAdapter.getPostCards(timeline)).toHaveLength(2);
    expect(misskeyAdapter.hasPostCards(timeline)).toBe(true);
  });

  // インスタンスは、ノートではない <article> を画面に置くことがある
  // （misskey.io の広告がこの形）。ノートは必ず自分の時刻を持っていて、
  // 見分けが付くのはそこ。
  it("ノートの時刻を持たない article は外す", () => {
    const timeline = render(
      `${renderNoteRoot().innerHTML}${renderNoteRoot({ time: null }).innerHTML}`,
    );

    expect(misskeyAdapter.getPostCards(timeline)).toHaveLength(1);
  });

  it("article が全部それ以外の画面では1件も見つけない", () => {
    const page = render(renderNoteRoot({ time: null }).innerHTML);

    expect(misskeyAdapter.getPostCards(page)).toEqual([]);
    expect(misskeyAdapter.hasPostCards(page)).toBe(false);
  });
});

describe("隠される単位", () => {
  // リノートのヘッダと返信先のノートは article の外側に描かれるので、
  // article だけを隠すとそれらが残ってしまう。
  it("article ではなく、ノートの根", () => {
    const root = renderNoteRoot();
    const note = root.querySelector("article");
    if (!note) {
      throw new Error("描画したノートに article が無い");
    }

    expect(misskeyAdapter.findPostCell(note)).toBe(root.firstElementChild);
  });

  it("自分の根が無ければカードそのものに落ちる", () => {
    const orphan = render("<article></article>").firstElementChild;
    if (!orphan) {
      throw new Error("描画した article が無い");
    }
    orphan.remove();

    expect(misskeyAdapter.findPostCell(orphan)).toBe(orphan);
  });
});

// リアクションの合計は画面のどこにも無い＝フッターのものは既定で出ないので、
// 絵文字ごとのチップを足し合わせる。`_button` を着ている他のものは全部外す
// 必要がある＝フッターのボタン（どれも `ti-*` のアイコンが先頭に付く）と、
// 長いノートの「もっと見る」（数ではなく言葉）。
describe("リアクション数を読む", () => {
  it("絵文字ごとのチップだけを足し、他は全部外す", () => {
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

  it("誰もリアクションしていないノートには 0 を返す", () => {
    expect(misskeyAdapter.readReactionCount(renderNote())).toBe(0);
  });
});

// 時刻は title 属性に入った現地語の文字なので、読者によって読めたり読めなかったり
// する。読めなかった場合に落ちるのは「上昇中」だけ。
describe("ノートの時刻を読む", () => {
  it("Date.parse が解釈できる時刻を読む", () => {
    expect(misskeyAdapter.readCreatedAt(renderNote())).toBe(
      Date.parse(noteTime),
    );
  });

  it("Date.parse が拒む言語には NaN を返す", () => {
    // 韓国語の読者の画面。
    const note = renderNote({ time: "2026. 8. 5. 오후 5:44:21" });

    expect(misskeyAdapter.readCreatedAt(note)).toBeNaN();
  });

  it("時刻がそもそも無ければ NaN を返す", () => {
    expect(misskeyAdapter.readCreatedAt(renderNote({ time: null }))).toBeNaN();
  });
});

// メディアとアバター・ロールのバッジ・絵文字を見分けるのは、画像が `alt` に
// 残しているもの＝ファイルの名前かコメントで、それ以外に読めるものは無い。
describe("メディアを読む", () => {
  it("添付された画像を、alt が運ぶ文字から読む", () => {
    const note = renderNote({
      body: '<img alt="IMG_8802.png" src="/files/1.png">',
    });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("アバター・バッジ・絵文字はメディア無しとして読む", () => {
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

  // 動画のサムネイルはファイル自身のコメントを持つ <img> で、画像の alt と
  // 見分けが付かない。同じ入れ物の中に重ねて描かれる再生ボタンが違いで、
  // これが無いと動画も画像として数えられ、「画像のみ」の設定を通り抜けてしまう。
  it("動画のサムネイルを画像として読まない", () => {
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

  it("ビルドが video 要素として描く動画も読む", () => {
    const note = renderNote({ body: '<video src="/files/1.mp4"></video>' });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
  });

  // クリックするまで見せない扱いのファイルは、ファイルがあることは伝えるが
  // それが何かは伝えない。メディア無しとして読むとノートごと隠れてしまう。
  it("クリックまで伏せられたファイルは画像として読む", () => {
    const note = renderNote({ body: '<i class="ti ti-eye-exclamation"></i>' });

    expect(misskeyAdapter.readMedia(note)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("ファイルの無いノートは無しとして読む", () => {
    expect(
      misskeyAdapter.readMedia(renderNote({ body: "<p>text only</p>" })),
    ).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });
});

describe("投稿本文を読む", () => {
  it("投稿本文とハッシュタグだけを読む", () => {
    const note = renderNote({
      body: '<span class="_selectable">New trailer <a>#Spoiler</a></span><button>Like</button>',
    });

    expect(misskeyAdapter.readText(note)).toBe("New trailer #Spoiler");
  });
});

// リノートのヘッダは article の上、同じ根の内側に座っている。フッターの
// リノートボタンも同じアイコンを着ているので、数えるのは article より前に
// あるものだけ＝そうしないと全部のノートがリノートとして読まれる。
describe("リノートを読む", () => {
  it("ノートの上に描かれるヘッダを読む", () => {
    const note = renderNote({
      header:
        '<div><i class="ti ti-repeat"></i><span>さんがリノート</span></div>',
    });

    expect(misskeyAdapter.readIsRepost(note)).toBe(true);
  });

  it("ノートの上の返信ヘッダはリノートとして読まない", () => {
    const note = renderNote({
      header: '<div><i class="ti ti-arrow-back-up"></i></div>',
    });

    expect(misskeyAdapter.readIsRepost(note)).toBe(false);
  });

  it("フッター自身のリノートボタンもリノートとして読まない", () => {
    const note = renderNote({
      body: '<footer><button class="_button"><i class="ti ti-repeat"></i></button></footer>',
    });

    expect(misskeyAdapter.readIsRepost(note)).toBe(false);
  });

  it("根の無いカードには false を返す", () => {
    const orphan = render("<article></article>").firstElementChild;
    if (!orphan) {
      throw new Error("描画した article が無い");
    }
    orphan.remove();

    expect(misskeyAdapter.readIsRepost(orphan)).toBe(false);
  });
});

// リアクションもいいねと同じく読者1人につき1つだが、インスタンスの規模は X と
// 桁が違うので、しきい値は Misskey 自身の2つの数と比べる。
describe("しきい値が数えるもの", () => {
  it("リアクション＝Misskey 自身の2つの数と比べる", () => {
    expect(misskeyAdapter.reactionLabels).toBe(REACTION_LABELS);
    expect(misskeyAdapter.reactionLabels).not.toBe(xAdapter.reactionLabels);
    expect(misskeyAdapter.thresholdKeys).toBe(MISSKEY_REACTION_THRESHOLDS);
    expect(misskeyAdapter.thresholdKeys).not.toBe(xAdapter.thresholdKeys);
  });
});
