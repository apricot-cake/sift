import { describe, expect, it } from "vitest";
import {
  FILTER_CONTEXT_REQUEST,
  isFilterContextRequest,
  isFilterContextResponse,
} from "./filter-context.ts";
import { isPanelPost, POST_COLLECTION_LIMIT } from "./panel-post.ts";

const post = {
  id: "123",
  url: "https://x.com/alice/status/123",
  author: "Alice",
  handle: "@alice",
  text: "本文",
  images: [],
  metricCount: null,
};
const response = {
  site: "x",
  pageTitle: "X",
  pageKey: "https://x.com/home",
  timelineAvailable: true,
  posts: [post],
  collectedCount: 1,
  collectionTruncated: false,
};

describe("パネルの投稿メッセージ契約", () => {
  it("読み取りと明示リセットを受け入れ、不正なreset型を拒否する", () => {
    expect(isFilterContextRequest({ type: FILTER_CONTEXT_REQUEST })).toBe(true);
    expect(
      isFilterContextRequest({ type: FILTER_CONTEXT_REQUEST, reset: true }),
    ).toBe(true);
    expect(
      isFilterContextRequest({ type: FILTER_CONTEXT_REQUEST, reset: false }),
    ).toBe(true);
    expect(
      isFilterContextRequest({ type: FILTER_CONTEXT_REQUEST, reset: "true" }),
    ).toBe(false);
  });
  it("新しい応答だけを受け入れる", () => {
    expect(isFilterContextResponse(response)).toBe(true);
    expect(
      isFilterContextResponse({ ...response, filteringEnabled: false }),
    ).toBe(false);
    expect(
      isFilterContextResponse({ ...response, continuousLoadingWarning: false }),
    ).toBe(false);
    const {
      posts: _posts,
      collectedCount: _count,
      collectionTruncated: _truncated,
      ...old
    } = response;
    expect(
      isFilterContextResponse({
        ...old,
        filteringEnabled: false,
        continuousLoadingWarning: false,
      }),
    ).toBe(false);
  });
  it.each([-1, 1.5, POST_COLLECTION_LIMIT + 1, Number.NaN, Infinity])(
    "不正な収集件数%sを拒否する",
    (count) => {
      expect(
        isFilterContextResponse({ ...response, collectedCount: count }),
      ).toBe(false);
    },
  );
  it("表示件数が収集件数を超える応答や不正な上限フラグを拒否する", () => {
    expect(isFilterContextResponse({ ...response, collectedCount: 0 })).toBe(
      false,
    );
    expect(
      isFilterContextResponse({ ...response, collectionTruncated: "false" }),
    ).toBe(false);
    expect(isFilterContextResponse({ ...response, posts: [{}] })).toBe(false);
    expect(
      isFilterContextResponse({
        ...response,
        collectedCount: POST_COLLECTION_LIMIT,
        collectionTruncated: true,
      }),
    ).toBe(true);
  });
});

describe("パネル投稿の安全な値", () => {
  it("未知の反応数をnull、0件を0として受け入れる", () => {
    expect(isPanelPost(post)).toBe(true);
    expect(isPanelPost({ ...post, metricCount: 0 })).toBe(true);
  });
  it.each([-1, 1.5, Number.NaN, Infinity, undefined])(
    "不正な反応数%sを拒否する",
    (metricCount) => {
      expect(isPanelPost({ ...post, metricCount })).toBe(false);
    },
  );
  it.each([
    "javascript:alert(1)",
    "http://x.com/alice/status/123",
    "https://x.com.evil.test/alice/status/123",
    "https://alice:secret@x.com/alice/status/123",
    "https://x.com/alice/status/123?tracking=1",
  ])("不正な投稿URL%sを拒否する", (url) => {
    expect(isPanelPost({ ...post, url })).toBe(false);
  });
  it("文字長と画像枚数、画像URLを制限する", () => {
    expect(isPanelPost({ ...post, text: "字".repeat(501) })).toBe(false);
    expect(isPanelPost({ ...post, author: "字".repeat(101) })).toBe(false);
    expect(isPanelPost({ ...post, handle: "字".repeat(101) })).toBe(false);
    const image = { url: "https://pbs.twimg.com/media/image.jpg", alt: "説明" };
    expect(isPanelPost({ ...post, images: [image] })).toBe(true);
    expect(isPanelPost({ ...post, images: Array(5).fill(image) })).toBe(false);
    expect(
      isPanelPost({
        ...post,
        images: [
          { ...image, url: "https://pbs.twimg.com/profile_images/avatar.jpg" },
        ],
      }),
    ).toBe(false);
    expect(
      isPanelPost({
        ...post,
        images: [
          { ...image, url: "https://cdn.bsky.app/img/avatar/plain/avatar.jpg" },
        ],
      }),
    ).toBe(false);
    expect(
      isPanelPost({
        ...post,
        images: [{ ...image, url: "data:image/svg+xml,unsafe" }],
      }),
    ).toBe(false);
  });
});
