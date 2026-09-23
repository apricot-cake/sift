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

  it("ショートのパスからIDを読む", () => {
    const video = renderVideo(
      '<a class="shortsLockupViewModelHostEndpoint" href="/shorts/xyz789">動画</a>',
    );

    expect(youtubeAdapter.readPostId?.(video)).toBe("xyz789");
  });

  it("動画リンクが無ければ null を返す", () => {
    expect(youtubeAdapter.readPostId?.(renderVideo())).toBeNull();
  });
});

describe("YouTube の動画を見つける", () => {
  it("通常動画とショートを見つける", () => {
    const page = render(`
      <ytd-video-renderer></ytd-video-renderer>
      <ytd-rich-grid-media></ytd-rich-grid-media>
      <yt-lockup-view-model></yt-lockup-view-model>
      <ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model>
    `);

    expect(youtubeAdapter.getPostCards(page)).toHaveLength(4);
    expect(youtubeAdapter.hasPostCards(page)).toBe(true);
  });

  it("同じ項目に入れ子になったショートを一度だけ見つける", () => {
    const page = render(`
      <ytd-rich-item-renderer>
        <ytm-shorts-lockup-view-model-v2>
          <ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model>
        </ytm-shorts-lockup-view-model-v2>
      </ytd-rich-item-renderer>
    `);

    expect(youtubeAdapter.getPostCards(page)).toHaveLength(1);
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
    "/results",
    "/feed/subscriptions",
    "/@sift/videos",
    "/@sift/shorts",
    "/@sift/streams",
    "/@sift/live",
    "/@sift/search",
    "/channel/UC123/videos",
    "/channel/UC123/shorts/",
    "/channel/UC123/streams",
    "/channel/UC123/live",
    "/c/sift/videos",
    "/c/sift/live",
    "/c/sift/streams",
    "/user/sift/shorts",
    "/user/sift/live/",
    "/user/sift/streams",
    "/user/sift/search/",
  ])("%s を対象にする", (pathname) => {
    expect(isYouTubeFilterPage(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/@sift",
    "/@sift/featured",
    "/feed/history",
    "/feed/playlists",
    "/playlist",
    "/shorts/abc",
    "/watch",
  ])("%s を対象外にする", (pathname) => {
    expect(isYouTubeFilterPage(pathname)).toBe(false);
  });

  it("対象ページでも動画が無ければ操作対象にしない", () => {
    expect(
      youtubeAdapter.isTimelineAvailable(render(""), {
        pathname: "/results",
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

describe("YouTube の再生回数を読む", () => {
  it("検索結果の再生回数を読む", () => {
    const video = renderVideo(`
      <div id="metadata-line">
        <span class="inline-metadata-item">1.4万回視聴</span>
        <span class="inline-metadata-item">12時間前</span>
      </div>
    `);

    expect(youtubeAdapter.readMetricCount(video)).toBe(14000);
  });

  it("ショートの再生回数を読む", () => {
    const short = render(`
      <ytm-shorts-lockup-view-model>
        <div class="shortsLockupViewModelHostMetadataSubhead">72万回視聴</div>
      </ytm-shorts-lockup-view-model>
    `).firstElementChild;
    if (!short) {
      throw new Error("ショートのカードが無い");
    }

    expect(youtubeAdapter.readMetricCount(short)).toBe(720000);
  });

  it("チャンネルの動画一覧から再生回数を読む", () => {
    const video = render(`
      <yt-lockup-view-model>
        <span class="ytContentMetadataViewModelMetadataText">1.8万回視聴</span>
        <span class="ytContentMetadataViewModelMetadataText">1日前</span>
      </yt-lockup-view-model>
    `).firstElementChild;
    if (!video) {
      throw new Error("動画カードが無い");
    }

    expect(youtubeAdapter.readMetricCount(video)).toBe(18000);
  });

  it("再生回数のないライブ配信は判定不能にする", () => {
    const live = renderVideo(`
      <div id="metadata-line">
        <span class="inline-metadata-item">123 watching</span>
      </div>
    `);

    expect(youtubeAdapter.readMetricCount(live)).toBeNaN();
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

  it("画面上のメンバー限定バッジを読む", () => {
    const video = renderVideo(`
      <ytd-badge-supported-renderer>メンバー限定</ytd-badge-supported-renderer>
    `);

    expect(youtubeAdapter.readIsMembersOnly?.(video)).toBe(true);
  });

  it("アクセシブルな英語のメンバー限定バッジを読む", () => {
    const video = renderVideo(
      '<yt-badge-shape aria-label="Members only"></yt-badge-shape>',
    );

    expect(youtubeAdapter.readIsMembersOnly?.(video)).toBe(true);
  });

  it("一覧セルの兄弟要素にあるメンバー限定ラベルを読む", () => {
    const page = render(`
      <ytd-rich-item-renderer>
        <yt-lockup-view-model></yt-lockup-view-model>
        <span>メンバー限定</span>
      </ytd-rich-item-renderer>
    `);
    const video = page.querySelector("yt-lockup-view-model");
    if (!video) {
      throw new Error("動画カードが無い");
    }

    expect(youtubeAdapter.readIsMembersOnly?.(video)).toBe(true);
  });

  it("バッジ以外の動画タイトルはメンバー限定として扱わない", () => {
    const video = renderVideo('<a id="video-title">Members only Q&A</a>');

    expect(youtubeAdapter.readIsMembersOnly?.(video)).toBe(false);
  });
});
