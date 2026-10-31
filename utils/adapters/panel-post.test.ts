import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { isPanelPost } from "../panel-post.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { xAdapter } from "./x.ts";

function xPost(body: string): Element {
  const card = render(
    `<article data-testid="tweet">${body}</article>`,
  ).firstElementChild;
  if (!card) throw new Error("投稿がありません");
  return card;
}

function bskyPost(body: string): Element {
  const card = render(
    `<div data-testid="feedItem-by-alice.test">${body}</div>`,
  ).firstElementChild;
  if (!card) throw new Error("投稿がありません");
  return card;
}

describe("Xのパネル表示用投稿", () => {
  it("lazy画像のcurrentSrcがプレースホルダーでも安全なsrcを利用する", () => {
    const card = xPost(
      '<a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="tweetPhoto"><img loading="lazy" src="https://pbs.twimg.com/media/lazy.jpg" alt="写真"></div>',
    );
    const image = card.querySelector("img");
    if (!image) throw new Error("画像がありません");
    Object.defineProperty(image, "currentSrc", {
      value: "data:image/gif;base64,placeholder",
    });
    expect(xAdapter.readPost(card)?.images).toEqual([
      { url: "https://pbs.twimg.com/media/lazy.jpg", alt: "写真" },
    ]);
  });

  it("ブラウザーがsrcsetから選んだ安全なcurrentSrcを優先する", () => {
    const card = xPost(
      '<a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/small.jpg" srcset="https://pbs.twimg.com/media/large.jpg 2x"></div>',
    );
    const image = card.querySelector("img");
    if (!image) throw new Error("画像がありません");
    Object.defineProperty(image, "currentSrc", {
      value: "https://pbs.twimg.com/media/large.jpg",
    });
    expect(xAdapter.readPost(card)?.images[0]?.url).toBe(
      "https://pbs.twimg.com/media/large.jpg",
    );
  });

  it("投稿URL・作者・プレーンテキスト・本体画像と反応数を読み取る", () => {
    const card =
      xPost(`<div data-testid="User-Name"><a href="/alice">Alice</a><a href="/alice">@alice</a></div>
      <a href="https://twitter.com/alice/status/123?s=20"><time datetime="2026-10-25"></time></a>
      <div data-testid="tweetText">Hello <b>world</b> &lt;script&gt;</div>
      <div data-testid="Tweet-User-Avatar"><img src="https://pbs.twimg.com/profile_images/avatar.jpg"></div>
      <img src="https://abs.twimg.com/emoji/v2/emoji.svg">
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/image.jpg" alt="画像"></div>
      <button data-testid="like" aria-label="1,234 件のいいね"></button>`);
    const post = xAdapter.readPost(card);
    expect(post).toMatchObject({
      id: "123",
      url: "https://x.com/alice/status/123",
      author: "Alice",
      handle: "@alice",
      text: "Hello world <script>",
      metricCount: 1234,
      images: [{ url: "https://pbs.twimg.com/media/image.jpg", alt: "画像" }],
    });
    expect(isPanelPost(post)).toBe(true);
  });

  it("引用元の本文・画像・投稿リンクを本体として読まない", () => {
    const card =
      xPost(`<div role="link"><div data-testid="Tweet-User-Avatar"></div><div data-testid="User-Name"><a href="/quoted">Quoted</a><a href="/quoted">@quoted</a></div>
      <a href="/quoted/status/456"><time datetime="2026-10-24"></time></a>
      <div data-testid="tweetText">引用元</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quote.jpg"></div></div>
      <a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="User-Name"><a href="/alice">Alice</a><a href="/alice">@alice</a></div><div data-testid="tweetText">本人の本文</div>`);
    expect(xAdapter.readPost(card)).toMatchObject({
      id: "123",
      text: "本人の本文",
      author: "Alice",
      images: [],
      hasImage: false,
      hasVideo: false,
      metricCount: null,
      isQuote: true,
    });
  });

  it("引用元のアバターがなくても本人のID・本文・メディアを取り違えない", () => {
    const card = xPost(
      '<div role="link"><a href="/quoted/status/456"><time datetime="2026-10-24"></time></a><div data-testid="tweetText">引用元</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quote.jpg"></div><div data-testid="videoPlayer"><video></video></div></div><a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="tweetText">本人の本文</div><button data-testid="like" aria-label="10 likes"></button>',
    );
    expect(xAdapter.readPostId(card)).toBe("123");
    expect(xAdapter.readPost(card)).toMatchObject({
      id: "123",
      text: "本人の本文",
      hasImage: false,
      hasVideo: false,
      images: [],
      isQuote: true,
    });
  });

  it("本人の写真は残して引用元の動画だけを除く", () => {
    const card = xPost(
      '<a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/own.jpg"></div><div role="link"><a href="/quoted/status/456"><time datetime="2026-10-24"></time></a><div data-testid="videoPlayer"><video></video></div></div><button data-testid="like" aria-label="10 likes"></button>',
    );
    expect(xAdapter.readPost(card)).toMatchObject({
      id: "123",
      hasImage: true,
      hasVideo: false,
      images: [{ url: "https://pbs.twimg.com/media/own.jpg", alt: "" }],
      isQuote: true,
    });
  });

  it("文字と画像の上限を守り、重複や安全でない画像を除く", () => {
    const card =
      xPost(`<div data-testid="User-Name"><a>${"あ".repeat(120)}</a><a>@${"a".repeat(110)}</a></div>
      <a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="tweetText">${"字".repeat(600)}</div>
      <div data-testid="tweetPhoto"><img src="javascript:alert(1)"><img src="http://pbs.twimg.com/media/no.jpg"><img src="https://example.com/picture.jpg">
      ${Array.from({ length: 6 }, (_, i) => `<img src="https://pbs.twimg.com/media/${i}.jpg" alt="${"説明".repeat(300)}">`).join("")}</div>`);
    const post = xAdapter.readPost(card);
    expect(post?.text).toHaveLength(500);
    expect(post?.author).toHaveLength(100);
    expect(post?.handle).toHaveLength(100);
    expect(post?.images).toHaveLength(4);
    expect(post?.images[0]?.alt).toHaveLength(500);
    expect(isPanelPost(post)).toBe(true);
  });

  it("同じ画像URLを繰り返し受け取っても一枚にまとめる", () => {
    const card = xPost(
      '<a href="/alice/status/123"><time datetime="2026-10-25"></time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/image.jpg"><img src="https://pbs.twimg.com/media/image.jpg"></div>',
    );
    expect(xAdapter.readPost(card)?.images).toHaveLength(1);
  });

  it.each([
    "",
    '<a href="https://example.com/alice/status/123"><time datetime="2026-10-25"></time></a>',
    '<a href="javascript:alert(1)"><time datetime="2026-10-25"></time></a>',
  ])("正しい投稿URLがなければ除外する", (body) => {
    expect(xAdapter.readPost(xPost(body))).toBeNull();
  });
});

describe("Blueskyのパネル表示用投稿", () => {
  it.each(["button", 'div role="button"'])(
    "%s内の本体fullsize画像を読み、画像条件にも反映する",
    (wrapper) => {
      const tag = wrapper.split(" ")[0];
      const card = bskyPost(
        `<a href="/profile/alice.test/post/3abc">時刻</a><${wrapper}><img loading="lazy" src="https://cdn.bsky.app/img/feed_fullsize/plain/image.jpg" alt="写真"></${tag}>`,
      );
      const post = blueskyAdapter.readPost(card);
      expect(post).toMatchObject({
        hasImage: true,
        images: [
          {
            url: "https://cdn.bsky.app/img/feed_fullsize/plain/image.jpg",
            alt: "写真",
          },
        ],
      });
      expect(isPanelPost(post)).toBe(true);
    },
  );

  it("currentSrcだけが本体CDN URLになった画像も読み取る", () => {
    const card = bskyPost(
      '<a href="/profile/alice.test/post/3abc">時刻</a><button><img src="data:image/gif;base64,placeholder"></button>',
    );
    const image = card.querySelector("img");
    if (!image) throw new Error("画像がありません");
    Object.defineProperty(image, "currentSrc", {
      value: "https://cdn.bsky.app/img/feed_thumbnail/plain/selected.jpg",
    });
    expect(blueskyAdapter.readPost(card)).toMatchObject({
      hasImage: true,
      images: [
        { url: "https://cdn.bsky.app/img/feed_thumbnail/plain/selected.jpg" },
      ],
    });
  });

  it("ボタン内でもアバター・絵文字・外部カード・引用画像を本体写真としない", () => {
    const card = bskyPost(
      '<a href="/profile/alice.test/post/3abc">時刻</a><button><img src="https://cdn.bsky.app/img/avatar/plain/avatar.jpg"><img src="https://example.com/emoji.png"></button><a href="https://example.com"><div role="button"><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/external.jpg"></div></a><div data-testid="contentHider-post"><div role="link"><img data-testid="userAvatarImage"><button><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/quote.jpg"></button></div></div>',
    );
    expect(blueskyAdapter.readPost(card)).toMatchObject({
      images: [],
    });
  });

  it("引用写真だけの投稿は画像条件に含めず、表示画像にも混ぜない", () => {
    const card = bskyPost(
      '<a href="/profile/alice.test/post/3abc">時刻</a><div data-testid="contentHider-post"><div role="link"><img data-testid="userAvatarImage"><button><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/quote.jpg"></button></div></div>',
    );
    expect(blueskyAdapter.readMedia(card)).toMatchObject({ hasImage: false });
    expect(blueskyAdapter.readPost(card)).toMatchObject({
      hasImage: false,
      images: [],
    });
  });

  it("アバターや外部リンクカードはメディア条件にも含めない", () => {
    const card = bskyPost(
      '<a href="/profile/alice.test/post/3abc">時刻</a><button><img src="https://cdn.bsky.app/img/avatar/plain/avatar.jpg"><img src="https://example.com/emoji.png"></button><a href="https://example.com"><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/external.jpg"></a>',
    );
    expect(blueskyAdapter.readMedia(card)).toMatchObject({ hasImage: false });
    expect(blueskyAdapter.readPost(card)).toMatchObject({
      hasImage: false,
      images: [],
    });
  });

  it("引用のアバターが欠けても引用先URLや本文を本体として読まない", () => {
    const card = bskyPost(
      '<div data-testid="contentHider-post"><div role="link"><a href="/profile/quoted.test/post/quoted">引用</a><div data-testid="postText">引用元</div></div><a href="/profile/alice.test/post/3abc">本文時刻</a><div data-testid="postText">本人の本文</div></div>',
    );
    expect(blueskyAdapter.readPost(card)).toMatchObject({
      id: "alice.test:3abc",
      text: "本人の本文",
      isQuote: true,
    });
  });
  it("投稿本体を読み、アバター・外部カード・引用画像を除く", () => {
    const card =
      bskyPost(`<a href="/profile/alice.test"><img data-testid="userAvatarImage" src="https://cdn.bsky.app/img/avatar/plain/avatar.jpg"></a>
      <a href="/profile/alice.test">Alice</a><a href="/profile/alice.test">@alice.test</a>
      <a href="/profile/alice.test/post/3abc?foo=bar">投稿時刻</a>
      <div data-testid="postText">こんにちは <b>世界</b></div>
      <button><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/image.jpg" alt="説明"></button>
      <a href="https://example.com"><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/external.jpg"></a>
      <div data-testid="contentHider-post"><div role="link"><img data-testid="userAvatarImage"><a href="/profile/quoted.test/post/other">引用時刻</a><div data-testid="postText">引用元</div><button><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/quote.jpg"></button></div></div>
      <button data-testid="likeBtn" aria-label="いいねする（63,561件のいいね）"></button>`);
    const post = blueskyAdapter.readPost(card);
    expect(post).toMatchObject({
      id: "alice.test:3abc",
      url: "https://bsky.app/profile/alice.test/post/3abc",
      author: "Alice",
      handle: "@alice.test",
      text: "こんにちは 世界",
      images: [
        {
          url: "https://cdn.bsky.app/img/feed_thumbnail/plain/image.jpg",
          alt: "説明",
        },
      ],
      metricCount: 63561,
      isQuote: true,
    });
    expect(isPanelPost(post)).toBe(true);
  });

  it("検索のrole=linkカードからも欠損反応数をnullとして読む", () => {
    const root = render(
      '<div data-testid="searchScreen"><div role="link"><a href="/profile/alice.test/post/3abc">時刻</a><div data-testid="postText">検索結果</div></div></div>',
    );
    const card = blueskyAdapter.getPostCards(root)[0];
    if (!card) throw new Error("検索投稿がありません");
    expect(blueskyAdapter.readPost(card)).toMatchObject({
      id: "alice.test:3abc",
      text: "検索結果",
      metricCount: null,
    });
  });

  it.each([
    "",
    '<a href="https://example.com/profile/alice.test/post/3abc">投稿</a>',
    '<a href="http://bsky.app/profile/alice.test/post/3abc">投稿</a>',
  ])("正しい投稿URLがなければ除外する", (body) => {
    expect(blueskyAdapter.readPost(bskyPost(body))).toBeNull();
  });
});
