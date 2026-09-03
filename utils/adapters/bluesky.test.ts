import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { blueskyAdapter, isBlueskySupportedHomeTimeline } from "./bluesky.ts";

const postHref = "/profile/example.bsky.social/post/3mqcze2d6k23e";

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

describe("投稿IDを読む", () => {
  it("投稿者とrecord keyを組み合わせる", () => {
    const card = renderPost(`<a href="${postHref}">投稿時刻</a>`);

    expect(blueskyAdapter.readPostId?.(card)).toBe(
      "example.bsky.social:3mqcze2d6k23e",
    );
  });

  it("投稿リンクが無ければ null を返す", () => {
    expect(blueskyAdapter.readPostId?.(renderPost())).toBeNull();
  });
});

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

describe("フィードの終端を読む", () => {
  it.each(["フィードの終わり", "End of feed"])(
    "%s を終端として読む",
    (label) => {
      const page = render(`
        <div data-testid="postsFeed-flatlist">
          <div><div dir="auto">${label}</div></div>
        </div>
      `);

      expect(blueskyAdapter.hasReachedTimelineEnd?.(page)).toBe(true);
    },
  );

  it("フィードの外にある同じ文言は終端として読まない", () => {
    const page = render('<div dir="auto">フィードの終わり</div>');

    expect(blueskyAdapter.hasReachedTimelineEnd?.(page)).toBe(false);
  });
});

describe("Home の対象フィード", () => {
  it("Following は投稿の描き直し中でも操作できる", () => {
    const page = render(`
      <div data-testid="homeScreenFeedTabs-selector-0">
        Following
        <div style="background-color: rgb(0, 96, 255)"></div>
      </div>
      <div data-testid="homeScreenFeedTabs-selector-1">開発</div>
    `);

    expect(isBlueskySupportedHomeTimeline(page)).toBe(true);
    expect(blueskyAdapter.isTimelineAvailable(page, { pathname: "/" })).toBe(
      true,
    );
  });

  it("ピン留めフィードも投稿の描き直し中に操作できる", () => {
    const page = render(`
      <div data-testid="homeScreenFeedTabs-selector-0">Following</div>
      <div data-testid="homeScreenFeedTabs-selector-1">
        開発
        <div style="background-color: rgb(0, 96, 255)"></div>
      </div>
    `);

    expect(isBlueskySupportedHomeTimeline(page)).toBe(true);
    expect(blueskyAdapter.isTimelineAvailable(page, { pathname: "/" })).toBe(
      true,
    );
  });

  it("選択状態をまだ読めない間は対象外", () => {
    const page = render(`
      <div data-testid="homeScreenFeedTabs-selector-0">Following</div>
      <div data-testid="homeScreenFeedTabs-selector-1">開発</div>
    `);

    expect(isBlueskySupportedHomeTimeline(page)).toBe(false);
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
    expect(blueskyAdapter.readMetricCount(renderPost())).toBe(63561);
  });

  it("いいねボタンが無ければ 0 を返す", () => {
    const row = renderFeed("<span>liked your post</span>").firstElementChild;
    if (!row) {
      throw new Error("描画したフィードに行が無い");
    }

    expect(blueskyAdapter.readMetricCount(row)).toBe(0);
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

describe("返信を読む", () => {
  it("親投稿から続く縦線を持つ投稿を返信として読む", () => {
    const card = renderPost(`
      <div style="width: 42px;">
        <div style="background-color: rgb(220, 226, 234); margin-bottom: 4px;"></div>
      </div>
    `);

    expect(blueskyAdapter.readIsReply?.(card)).toBe(true);
  });

  it("縦線の無い投稿を返信として読まない", () => {
    expect(blueskyAdapter.readIsReply?.(renderPost())).toBe(false);
  });
});

describe("引用投稿を読む", () => {
  it("本文内の引用カードを読む", () => {
    const card = renderPost(`
      <div data-testid="contentHider-post">
        <div role="link">
          <div data-testid="userAvatarImage"><img src="/quoted.jpg"></div>
        </div>
      </div>
    `);

    expect(blueskyAdapter.readIsQuote?.(card)).toBe(true);
  });

  it("外部リンクカードを引用として読まない", () => {
    const card = renderPost(`
      <div data-testid="contentHider-post">
        <a role="link" href="https://example.com">
          <img src="/preview.jpg">
        </a>
      </div>
    `);

    expect(blueskyAdapter.readIsQuote?.(card)).toBe(false);
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

// 反応の名前は同じでも母集団と分布が違うため、値はサイト別に持つ。
describe("しきい値が数えるもの", () => {
  it("Bluesky専用の2つの数と比べる", () => {
    expect(blueskyAdapter.settingsKey).toBe("bluesky");
  });
});
