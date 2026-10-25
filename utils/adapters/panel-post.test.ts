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
      metricCount: null,
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
