import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import { blueskyAdapter, timestampFromRecordKey } from "./bluesky.ts";
import { xAdapter } from "./x.ts";

const postHref = "/profile/example.bsky.social/post/3mqcze2d6k23e";
const recordKeyTime = Date.parse("2026-07-10T20:46:00.000Z");

const likeButton =
  '<button data-testid="likeBtn" aria-label="いいねする（63,561件のいいね）"><span>6万</span></button>';

// testid には投稿者のハンドルが入っているので、アダプターが当てるのはその前半。
// フィード・プロフィール・通知は1つ目の形を、投稿詳細の画面は2つ目の形を描く。
function renderFeed(...posts: string[]): HTMLElement {
  return render(
    posts
      .map(
        (post) =>
          `<div data-testid="feedItem-by-example.bsky.social">${post}</div>`,
      )
      .join(""),
  );
}

function renderPost(inner = ""): Element {
  const card = renderFeed(`${likeButton}${inner}`).firstElementChild;
  if (!card) {
    throw new Error("描画したフィードに投稿カードが無い");
  }
  return card;
}

describe("投稿を見つける", () => {
  it("フィードにある投稿を見つける", () => {
    const feed = renderFeed(likeButton, likeButton);

    expect(blueskyAdapter.getPostCards(feed)).toHaveLength(2);
    expect(blueskyAdapter.hasPostCards(feed)).toBe(true);
  });

  it("詳細の画面が自分で描く testid の投稿も見つける", () => {
    const screen = render(
      `<div data-testid="postThreadItem-by-example.bsky.social">${likeButton}</div>`,
    );

    expect(blueskyAdapter.getPostCards(screen)).toHaveLength(1);
  });

  // 通知の行は投稿カードと同じ testid を使い回している。無いのはいいねボタンの
  // 方で、読み取りから外れるのはそれが理由。
  it("同じ testid を使い回す通知の行は外す", () => {
    const notifications = renderFeed("<span>liked your post</span>");

    expect(blueskyAdapter.getPostCards(notifications)).toEqual([]);
    expect(blueskyAdapter.hasPostCards(notifications)).toBe(false);
  });

  it("投稿が並んでいない画面では1件も見つけない", () => {
    const page = render("<div>settings</div>");

    expect(blueskyAdapter.getPostCards(page)).toEqual([]);
    expect(blueskyAdapter.hasPostCards(page)).toBe(false);
  });
});

// X と違い、Bluesky は区切り線と周囲の余白をカードの内側に持っているので、
// 外側のセルを探しにいく必要が無い。
describe("隠される単位", () => {
  it("カードそのもの", () => {
    const card = renderPost();

    expect(blueskyAdapter.findPostCell(card)).toBe(card);
  });
});

describe("いいね数を読む", () => {
  // ボタンの隣の文字は「6万」に丸められていて、しきい値と比べようがない。
  // 正確な数を持っているのは読み上げ用のラベルの方。
  it("読み上げ用ラベルから正確な数を読む", () => {
    expect(blueskyAdapter.readReactionCount(renderPost())).toBe(63561);
  });

  it("いいねボタンが無ければ 0 を返す", () => {
    const row = renderFeed("<span>liked your post</span>").firstElementChild;
    if (!row) {
      throw new Error("描画したフィードに行が無い");
    }

    expect(blueskyAdapter.readReactionCount(row)).toBe(0);
  });
});

describe("投稿時刻を読む", () => {
  // Bluesky は <time datetime> を書かない。あるのはパーマリンクに付いた
  // 現地語の絶対時刻と、そのパーマリンクの経路に入っているレコードキー。
  it("Date.parse が解釈できるラベルを読む", () => {
    const card = renderPost(
      `<a href="${postHref}" aria-label="2026-08-01T12:00:00.000Z">1時間前</a>`,
    );

    expect(blueskyAdapter.readCreatedAt(card)).toBe(
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
  });

  // Bluesky が実際に書くラベルは現地語の絶対時刻で、Date.parse はこれを
  // 受け付けない＝実際に時刻を運んでいるのはレコードキーの方。
  it("Date.parse が拒むラベルではレコードキーに落ちる", () => {
    expect(Date.parse("2026年7月10日 20:46")).toBeNaN();
    const card = renderPost(
      `<a href="${postHref}" aria-label="2026年7月10日 20:46">1時間前</a>`,
    );

    expect(blueskyAdapter.readCreatedAt(card)).toBe(recordKeyTime);
  });

  // 詳細の画面が主題にしている投稿にはパーマリンクが無い＝そこがリンクの
  // 行き先だから。最初に来るのは自分の下位ページへのリンクで、ラベルは時刻では
  // なく動作、レコードキーは経路の途中に乗っている。勝つのは最初のリンクでは
  // なく、最初の「読めた」リンク。
  it("詳細の画面が先に置く下位ページのリンクから読む", () => {
    const card = renderPost(`
      <a href="${postHref}/reposted-by" aria-label="この投稿をリポストする"></a>
      <a href="${postHref}/liked-by" aria-label="この投稿をいいねする"></a>
    `);

    expect(blueskyAdapter.readCreatedAt(card)).toBe(recordKeyTime);
  });

  // 引用した投稿は、自分のパーマリンクの後ろに引用元のパーマリンクも持つ。
  it("引用元ではなく、引用した投稿自身の時刻を読む", () => {
    const card = renderPost(`
      <a href="${postHref}" aria-label="2026年7月10日 20:46"></a>
      <a href="/profile/quoted.bsky.social/post/3ms3mmsbt223e"></a>
    `);

    expect(blueskyAdapter.readCreatedAt(card)).toBe(recordKeyTime);
  });

  // どちらの読み方もできない場合＝投稿の判定自体は動き、「上昇中」だけが落ちる。
  it("キーがレコードキーでないリンクには NaN を返す", () => {
    const card = renderPost(
      '<a href="/profile/example.bsky.social/post/self"></a>',
    );

    expect(blueskyAdapter.readCreatedAt(card)).toBeNaN();
  });

  it("リンクを1本も持たない投稿には NaN を返す", () => {
    expect(blueskyAdapter.readCreatedAt(renderPost())).toBeNaN();
  });
});

describe("timestampFromRecordKey", () => {
  it("パーマリンクからキーを解く", () => {
    expect(timestampFromRecordKey(postHref)).toBe(recordKeyTime);
    expect(timestampFromRecordKey(`${postHref}?foo=1`)).toBe(recordKeyTime);
    expect(timestampFromRecordKey(`https://bsky.app${postHref}#anchor`)).toBe(
      recordKeyTime,
    );
  });

  // キーは /post/ の次の区画なので、その投稿自身の下位ページへのリンクも
  // パーマリンクと同じようにキーを運んでいる。
  it("下位ページのリンクからもキーを解く", () => {
    expect(timestampFromRecordKey(`${postHref}/reposted-by`)).toBe(
      recordKeyTime,
    );
  });

  // レコードキーが TID なのは慣習でしかないので、投稿の時刻としてありえない
  // ものは拒む＝長さ違い・字種の外・投稿のものになりえない時刻。
  it("投稿の時刻としてありえないものは拒む", () => {
    expect(timestampFromRecordKey("/post/tooshort")).toBeNaN();
    expect(timestampFromRecordKey("/post/3111111111111")).toBeNaN();
    expect(timestampFromRecordKey("")).toBeNaN();
    expect(timestampFromRecordKey(null)).toBeNaN();
    // "aaaaaaaaaaaaa" は 2190 年に解ける＝上限がそもそも要る理由。
    expect(timestampFromRecordKey("/post/aaaaaaaaaaaaa")).toBeNaN();
    // ネットワークが存在するより前の時刻。
    expect(timestampFromRecordKey("/post/3i5p64yyc222b")).toBeNaN();
  });

  // そして投稿は、それを読んでいる側の時計より先に立てない＝ずれの許容ぶんを
  // 超えては。
  it("時計のずれは許すが、それ以上は許さない", () => {
    expect(timestampFromRecordKey(postHref, recordKeyTime - 3600000)).toBeNaN();
    expect(timestampFromRecordKey(postHref, recordKeyTime - 60000)).toBe(
      recordKeyTime,
    );
  });
});

describe("メディアを読む", () => {
  it("投稿自身の画像を読む", () => {
    const card = renderPost(
      '<button><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/did/1@jpeg"></button>',
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  // 外部リンクカードのサムネイルは同じ経路から配られていて、見分けが付くのは
  // 何がそれを包んでいるかだけ＝ボタンではなくリンク。
  it("外部リンクカードのサムネイルはメディアとして読まない", () => {
    const card = renderPost(
      '<a href="https://example.com"><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/did/1@jpeg"></a>',
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });

  // 再生前の動画には <video> がそもそも無い＝サムネイルは CSS の背景。
  it("再生前の動画は、描かれている背景から読む", () => {
    const card = renderPost(
      '<div style="background-image: url(https://video.bsky.app/watch/did/cid/thumbnail.jpg)"></div>',
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
  });

  // GIF は Bluesky のメディアではなく、外部の埋め込みとして流れてくる。
  it("GIF は動画として読む", () => {
    const card = renderPost(
      '<video src="https://t.gifs.bsky.app/gif/1.mp4"></video>',
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
  });

  it("メディアの無い投稿は無しとして読む", () => {
    expect(
      blueskyAdapter.readMedia(renderPost("<span>text only</span>")),
    ).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });
});

describe("投稿本文を読む", () => {
  it("投稿本文とハッシュタグだけを読む", () => {
    const card = renderPost(
      '<div data-testid="postText">New trailer <a>#Spoiler</a></div><button>Like</button>',
    );

    expect(blueskyAdapter.readText(card)).toBe("New trailer #Spoiler");
  });
});

// リポストを示す testid も決まった語も無い＝ヘッダは読者の言語で「◯◯が
// リポストしました」と出る。言語をまたいで変わらないのは形の方＝リポストの
// ヘッダのプロフィールリンクはアイコンを包み、投稿者のプロフィールリンクは
// アバター画像を包む。
describe("リポストを読む", () => {
  it("アイコンを包むプロフィールリンクをリポストのヘッダとして読む", () => {
    const card = renderPost(
      '<a href="/profile/example.bsky.social"><svg></svg></a>',
    );

    expect(blueskyAdapter.readIsRepost(card)).toBe(true);
  });

  it("投稿者のリンクは、アイコンがあってもリポストとして読まない", () => {
    const card = renderPost(
      '<a href="/profile/example.bsky.social"><svg></svg><img src="/avatar.jpg"></a>',
    );

    expect(blueskyAdapter.readIsRepost(card)).toBe(false);
  });

  it("他のものを包むプロフィールリンクもリポストとして読まない", () => {
    const card = renderPost(
      '<a href="/profile/example.bsky.social"><div></div></a>',
    );

    expect(blueskyAdapter.readIsRepost(card)).toBe(false);
  });

  it("空のプロフィールリンクもリポストとして読まない", () => {
    const card = renderPost('<a href="/profile/example.bsky.social"></a>');

    expect(blueskyAdapter.readIsRepost(card)).toBe(false);
  });

  it("プロフィールリンクが無ければ false を返す", () => {
    expect(blueskyAdapter.readIsRepost(renderPost())).toBe(false);
  });
});

// Bluesky のいいねは X のいいねなので、しきい値とそれを名指しするメッセージは
// サービスごとに複製せず共有する。
describe("しきい値が数えるもの", () => {
  it("X が数えるいいねと同じもの＝同じ2つの数と比べる", () => {
    expect(blueskyAdapter.reactionLabels).toBe(xAdapter.reactionLabels);
    expect(blueskyAdapter.thresholdKeys).toBe(LIKE_THRESHOLDS);
  });
});
