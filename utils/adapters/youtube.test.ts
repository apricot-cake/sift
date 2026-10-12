import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import {
  isYouTubeFilterPage,
  publishedAtFromYouTubeText,
  youtubeAdapter,
} from "./youtube.ts";

function renderVideo(inner = ""): Element {
  const video = render(
    `<ytd-video-renderer>${inner}</ytd-video-renderer>`,
  ).firstElementChild;
  if (!video) {
    throw new Error("描画した動画カードが無い");
  }
  return video;
}

describe("動画IDを読む", () => {
  it("通常動画のクエリからIDを読む", () => {
    const video = renderVideo(
      '<a id="video-title" href="/watch?v=abc123">動画</a>',
    );

    expect(youtubeAdapter.readPostId?.(video)).toBe("abc123");
  });

  it("動画リンクが無ければ null を返す", () => {
    expect(youtubeAdapter.readPostId?.(renderVideo())).toBeNull();
  });
});

describe("YouTube の動画を見つける", () => {
  it("通常動画を拾い、投稿日時のないショートを拾わない", () => {
    const page = render(
      "<ytd-video-renderer></ytd-video-renderer><ytd-rich-grid-media></ytd-rich-grid-media><yt-lockup-view-model></yt-lockup-view-model><ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model>",
    );
    expect(youtubeAdapter.getPostCards(page)).toHaveLength(3);
    expect(youtubeAdapter.hasPostCards(page)).toBe(true);
    expect(
      youtubeAdapter.getPostCards(
        render(
          "<ytm-shorts-lockup-view-model-v2><ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model-v2>",
        ),
      ),
    ).toEqual([]);
  });
  it("ホームのグリッドでは外側の項目を隠す", () => {
    const page = render(`
      <ytd-rich-item-renderer>
        <ytd-rich-grid-media></ytd-rich-grid-media>
      </ytd-rich-item-renderer>
    `);
    const card = page.querySelector("ytd-rich-grid-media");
    if (!card) {
      throw new Error("動画カードが無い");
    }

    expect(youtubeAdapter.findPostCell(card)).toBe(page.firstElementChild);
  });
});

describe("YouTube の対象ページを選ぶ", () => {
  it.each([
    "/@sift/videos",
    "/@sift/streams",
    "/channel/UC123/videos",
    "/channel/UC123/streams",
    "/c/sift/videos",
    "/c/sift/streams",
    "/user/sift/streams",
  ])("%s を対象にする", (pathname) => {
    expect(isYouTubeFilterPage(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/results",
    "/feed/subscriptions",
    "/@sift/live",
    "/@sift",
    "/@sift/featured",
    "/feed/history",
    "/feed/playlists",
    "/playlist",
    "/shorts/abc",
    "/@sift/shorts",
    "/channel/UC123/shorts/",
    "/user/sift/shorts",
    "/@sift/search",
    "/watch",
  ])("%s を対象外にする", (pathname) => {
    expect(isYouTubeFilterPage(pathname)).toBe(false);
  });

  it("対象ページでも動画が無ければ操作対象にしない", () => {
    expect(
      youtubeAdapter.isTimelineAvailable(render(""), {
        pathname: "/@sift/videos",
      }),
    ).toBe(false);
  });

  it("対象外ページに動画カードがあっても操作対象にしない", () => {
    expect(
      youtubeAdapter.isTimelineAvailable(renderVideo(), { pathname: "/" }),
    ).toBe(false);
  });

  it.each([
    "/@sift",
    "/@sift/featured",
    "/channel/UC123",
    "/c/sift",
    "/user/sift",
  ])("動画グリッドがあるチャンネルホーム %s も対象にしない", (pathname) => {
    const page = render(`
      <ytd-rich-grid-renderer>
        <ytd-rich-item-renderer>
          <yt-lockup-view-model></yt-lockup-view-model>
        </ytd-rich-item-renderer>
      </ytd-rich-grid-renderer>
    `);

    expect(youtubeAdapter.isTimelineAvailable(page, { pathname })).toBe(false);
  });

  it("チャンネルのホームは動画カードがあっても対象にしない", () => {
    const page = render(`
      <ytd-shelf-renderer>
        <yt-lockup-view-model></yt-lockup-view-model>
      </ytd-shelf-renderer>
    `);

    expect(
      youtubeAdapter.isTimelineAvailable(page, { pathname: "/@sift" }),
    ).toBe(false);
  });
});

describe("YouTube の公開時期を読む", () => {
  const now = Date.parse("2026-09-02T12:00:00Z");

  it.each([
    ["12時間前", 12],
    ["12 hours ago", 12],
    ["12시간 전", 12],
    ["hace 12 horas", 12],
    ["há 12 horas", 12],
  ])("%s を公開時刻へ直す", (text, ageHours) => {
    expect(publishedAtFromYouTubeText(text, now)).toBe(
      now - ageHours * 3600000,
    );
  });

  it("一覧カードのメタデータから公開時期を読む", () => {
    const video = renderVideo(`
      <div id="metadata-line">
        <span class="inline-metadata-item">1.4万回視聴</span>
        <span class="inline-metadata-item">12時間前</span>
      </div>
    `);

    expect(youtubeAdapter.readCreatedAt?.(video)).toBeGreaterThan(0);
  });

  it("公開時期が無ければ判定不能にする", () => {
    expect(publishedAtFromYouTubeText("新着", now)).toBeNaN();
  });
});

describe("YouTube の動画情報を読む", () => {
  it("動画をメディアとして読む", () => {
    const video = renderVideo('<a id="video-title">新しい動画</a>');

    expect(youtubeAdapter.readMedia(video)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
    expect(youtubeAdapter.readIsRepost(video)).toBe(false);
  });
});
