import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { isXSupportedHomeTimeline, xAdapter } from "./x.ts";

// X は投稿を、区切り線と周囲の余白も持つセルで包んでいて、投稿そのものはその
// セルの中の article。
function renderTimeline(...posts: string[]): HTMLElement {
  return render(
    posts
      .map(
        (post) =>
          `<div data-testid="cellInnerDiv"><article data-testid="tweet">${post}</article></div>`,
      )
      .join(""),
  );
}

function renderPost(inner = ""): Element {
  const card = renderTimeline(inner).querySelector("article");
  if (!card) {
    throw new Error("描画したタイムラインに投稿カードが無い");
  }
  return card;
}

describe("投稿を見つける", () => {
  it("画面にある投稿を全部見つける", () => {
    const timeline = renderTimeline(
      "<span>first</span>",
      "<span>second</span>",
    );

    expect(xAdapter.getPostCards(timeline)).toHaveLength(2);
    expect(xAdapter.hasPostCards(timeline)).toBe(true);
  });

  it("引用投稿は外側の投稿と別の読み込みとして数えない", () => {
    const timeline = renderTimeline(`
      <span>outer</span>
      <article data-testid="tweet"><span>quoted</span></article>
    `);

    const posts = xAdapter.getPostCards(timeline);

    expect(posts).toHaveLength(1);
    expect(posts[0]?.textContent).toContain("outer");
  });

  it("投稿が並んでいない画面では1件も見つけない", () => {
    const page = render('<div data-testid="primaryColumn">settings</div>');

    expect(xAdapter.getPostCards(page)).toEqual([]);
    expect(xAdapter.hasPostCards(page)).toBe(false);
  });

  it("Home のフォロー中は投稿の描き直し中でも操作できる", () => {
    const page = render(`
      <div data-testid="ScrollSnap-List" role="tablist">
        <div role="tab" aria-selected="false">おすすめ</div>
        <div role="tab" aria-selected="true">フォロー中</div>
      </div>
    `);

    expect(xAdapter.isTimelineAvailable(page, { pathname: "/home" })).toBe(
      true,
    );
  });

  it("Home のおすすめは対象外", () => {
    const page = render(`
      <div data-testid="ScrollSnap-List" role="tablist">
        <div role="tab" aria-selected="true">For you</div>
        <div role="tab" aria-selected="false">Following</div>
      </div>
    `);

    expect(isXSupportedHomeTimeline(page)).toBe(false);
    expect(xAdapter.isTimelineAvailable(page, { pathname: "/home" })).toBe(
      false,
    );
  });

  it("Home のピン留めリストも対象", () => {
    const page = render(`
      <div data-testid="ScrollSnap-List" role="tablist">
        <div role="tab" aria-selected="false">おすすめ</div>
        <div role="tab" aria-selected="false">フォロー中</div>
        <div role="tab" aria-selected="true">開発ニュース</div>
      </div>
    `);

    expect(isXSupportedHomeTimeline(page)).toBe(true);
    expect(xAdapter.isTimelineAvailable(page, { pathname: "/home" })).toBe(
      true,
    );
  });

  it("Home の選択状態をまだ読めない間は対象外", () => {
    const page = render(`
      <div data-testid="ScrollSnap-List" role="tablist">
        <div role="tab">おすすめ</div>
        <div role="tab">フォロー中</div>
      </div>
    `);

    expect(isXSupportedHomeTimeline(page)).toBe(false);
  });

  it("投稿のない他の画面は操作できない", () => {
    const page = render('<div data-testid="primaryColumn">settings</div>');

    expect(xAdapter.isTimelineAvailable(page, { pathname: "/settings" })).toBe(
      false,
    );
  });
});

describe("隠される単位", () => {
  it("投稿を包むセル＝隠しても隙間が残らない", () => {
    const timeline = renderTimeline("");
    const cell = timeline.firstElementChild;
    const card = cell?.firstElementChild;
    if (!cell || !card) {
      throw new Error("描画したタイムラインにセルが無い");
    }

    expect(xAdapter.findPostCell(card)).toBe(cell);
  });

  it("セルが無ければ投稿そのものに落ちる", () => {
    const card = render(
      '<article data-testid="tweet"></article>',
    ).firstElementChild;
    if (!card) {
      throw new Error("描画した投稿にカードが無い");
    }

    expect(xAdapter.findPostCell(card)).toBe(card);
  });
});

describe("いいね数を読む", () => {
  // 画面に出ている文字は「1.1万」に丸められていて、しきい値と比べようがない。
  // 正確な数を持っているのは読み上げ用のラベルの方。
  it("隣の丸めた文字より、読み上げ用ラベルを優先する", () => {
    const card = renderPost(
      '<button data-testid="like" aria-label="11788 件のいいね。いいねする"><span>1.1万</span></button>',
    );

    expect(xAdapter.readMetricCount(card)).toBe(11788);
  });

  it("ボタンにラベルが無ければ、画面の文字に落ちる", () => {
    const card = renderPost('<button data-testid="like"> 1,234 </button>');

    expect(xAdapter.readMetricCount(card)).toBe(1234);
  });

  // 既にいいね済みの投稿はもう一方の testid を持つが、数え方は同じ。
  it("いいね済みの投稿も読む", () => {
    const card = renderPost(
      '<button data-testid="unlike" aria-label="1,234 件のいいね。いいねを取り消す"></button>',
    );

    expect(xAdapter.readMetricCount(card)).toBe(1234);
  });

  it("いいねボタン自体が無ければ 0 を返す", () => {
    expect(xAdapter.readMetricCount(renderPost())).toBe(0);
  });
});

describe("投稿IDを読む", () => {
  it("時刻のリンクから固定の投稿IDを読む", () => {
    const card = renderPost(
      '<a href="/example/status/123456789"><time datetime="2026-08-01T12:00:00.000Z"></time></a>',
    );

    expect(xAdapter.readPostId?.(card)).toBe("123456789");
  });

  it("時刻を持つ投稿リンクが無ければ null を返す", () => {
    const card = renderPost('<a href="/example/status/123456789">詳細</a>');

    expect(xAdapter.readPostId?.(card)).toBeNull();
  });
});

// 画像と動画は分けたままにする＝1つの答えにまとめるのは利用者のメディア設定の
// 仕事で、このアダプターが当てるものではない。
describe("メディアを読む", () => {
  it("添付された画像を読む", () => {
    const card = renderPost(
      '<div data-testid="tweetPhoto"><img src="/media/1.jpg"></div>',
    );

    expect(xAdapter.readMedia(card)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  // 画像が testid 付きの入れ物ではなくリンクとして描かれている投稿＝投稿詳細の
  // 画面が使っている形。
  it("パーマリンクの内側にある画像も読む", () => {
    const card = renderPost(
      '<a href="/example/status/1/photo/1"><img src="/media/1.jpg"></a>',
    );

    expect(xAdapter.readMedia(card)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("動画を読む", () => {
    const card = renderPost(
      '<div data-testid="videoPlayer"><video></video></div>',
    );

    expect(xAdapter.readMedia(card)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
  });

  it("メディアの無い投稿は無しとして読む", () => {
    expect(xAdapter.readMedia(renderPost("<span>text only</span>"))).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });
});

describe("返信を読む", () => {
  it("投稿ヘッダーと本文の間にある返信先の行を読む", () => {
    const card = renderPost(`
      <div>
        <div data-testid="User-Name">投稿者</div>
        <div><a href="/reply-target">返信先</a></div>
        <div><div data-testid="tweetText">本文</div></div>
      </div>
    `);

    expect(xAdapter.readIsReply?.(card)).toBe(true);
  });

  it("本文内のメンションを返信先として読まない", () => {
    const card = renderPost(`
      <div>
        <div data-testid="User-Name">投稿者</div>
        <div data-testid="tweetText"><a href="/mentioned">@mentioned</a></div>
      </div>
    `);

    expect(xAdapter.readIsReply?.(card)).toBe(false);
  });

  it("本文が無い画像だけの返信も読む", () => {
    const card = renderPost(`
      <div>
        <div data-testid="User-Name">投稿者</div>
        <div><a href="/reply-target">返信先</a></div>
        <div><div data-testid="tweetPhoto"><img src="/photo.jpg"></div></div>
      </div>
    `);

    expect(xAdapter.readIsReply?.(card)).toBe(true);
  });
});

describe("引用投稿を読む", () => {
  it("外側と異なる投稿IDへのリンクを引用として読む", () => {
    const card = renderPost(`
      <a href="/author/status/100"><time datetime="2026-08-01"></time></a>
      <a href="/quoted/status/200">引用元</a>
    `);

    expect(xAdapter.readIsQuote?.(card)).toBe(true);
  });

  it("外側の投稿自身に属する画像リンクは引用として読まない", () => {
    const card = renderPost(`
      <a href="/author/status/100"><time datetime="2026-08-01"></time></a>
      <a href="/author/status/100/photo/1">画像</a>
    `);

    expect(xAdapter.readIsQuote?.(card)).toBe(false);
  });
});

describe("リポストを読む", () => {
  // リポストの矢印は socialContext の前にあり、文言はリポストした人のプロフィール
  // へのリンクの中に入る。表示言語が違っても、この構造は変わらない。
  it.each([
    ["韓国語", "사용자님이 재게시했습니다"],
    ["中国語", "用户转帖了"],
  ])("%s のリポストを文言に依存せず読む", (_language, text) => {
    const card = renderPost(`
      <div>
        <div><svg aria-hidden="true"><path></path></svg></div>
        <div><a href="/reposter"><span data-testid="socialContext">${text}</span></a></div>
      </div>
    `);

    expect(xAdapter.readIsRepost(card)).toBe(true);
  });

  // 固定ポストも socialContext を使うが、これはプロフィールへのリンクには入らない。
  it("固定された投稿をリポストとして読まない", () => {
    const card = renderPost('<div data-testid="socialContext">固定</div>');

    expect(xAdapter.readIsRepost(card)).toBe(false);
  });

  it("ヘッダが無ければ false を返す", () => {
    expect(xAdapter.readIsRepost(renderPost())).toBe(false);
  });
});

describe("しきい値が数えるもの", () => {
  it("いいねのしきい値を使う", () => {
    expect(xAdapter.settingsKey).toBe("x");
  });
});
