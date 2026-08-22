import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { weiboAdapter } from "./weibo.ts";
import { xAdapter } from "./x.ts";

// Weibo の投稿に掴めるものはほとんど無い＝クラス名の大半は CSS Modules の
// ハッシュで、ビルドごとに変わる。以下のマークアップが持っているのは、変わらない
// と分かっているものだけ＝要素名、"woo" のグローバルクラス、`wbpro-` 接頭辞の
// クラス、`title` 属性（2026-08-04 に未ログインで実測した範囲・#46）。
//
// 投稿は仮想スクローラーの器（`.wbpro-scroller-item`）の中の `article` として
// 描かれる。アバターは本文の器の外、カスタム絵文字とリンクカードのサムネイルは
// 器の中で画像ブロックの外に置かれる。
function renderScrollerItem({
  time = "2026-08-04 12:00",
  timeText = "9小时前",
  likes = "1.2万",
  content = "",
} = {}): HTMLElement {
  return render(`
    <div class="wbpro-scroller-item">
      <article>
        <header>
          <a href="/u/1" class="woo-avatar-main"><img src="avatar.jpg" alt=""></a>
          <a href="/1/Pabc" title="${time}">${timeText}</a>
        </header>
        <div class="wbpro-feed-content">${content}</div>
        <footer>
          <button class="woo-like-main"><span class="woo-like-count">${likes}</span></button>
        </footer>
      </article>
    </div>
  `);
}

function renderPost(
  options?: Parameters<typeof renderScrollerItem>[0],
): Element {
  const post = renderScrollerItem(options).querySelector("article");
  if (!post) {
    throw new Error("描画した投稿に article が無い");
  }
  return post;
}

const PICTURE = '<div class="picture"><img src="photo.jpg" alt=""></div>';
// 再生前の動画。<video> はまだ無く、サムネイルと再生アイコンだけが描かれる。
const UNPLAYED_VIDEO =
  '<div class="picture"><img src="cover.jpg" alt=""><i class="woo-font woo-font--play"></i></div>';

describe("投稿を見つける", () => {
  it("タイムラインに並ぶ投稿を見つける", () => {
    const timeline = render(
      `${renderScrollerItem().innerHTML}${renderScrollerItem().innerHTML}`,
    );

    expect(weiboAdapter.getPostCards(timeline)).toHaveLength(2);
    expect(weiboAdapter.hasPostCards(timeline)).toBe(true);
  });

  // `article` は Weibo の中で投稿だけのものとは限らない。投稿だと言えるのは
  // 赞のボタンを持っていることの方。
  it("赞のボタンを持たない article は投稿として数えない", () => {
    const page = render("<article><header>おすすめの話題</header></article>");

    expect(weiboAdapter.getPostCards(page)).toEqual([]);
    expect(weiboAdapter.hasPostCards(page)).toBe(false);
  });

  it("投稿が並んでいない画面では1件も見つけない", () => {
    const page = render("<div>設定</div>");

    expect(weiboAdapter.getPostCards(page)).toEqual([]);
    expect(weiboAdapter.hasPostCards(page)).toBe(false);
  });
});

describe("隠す単位", () => {
  // 仮想スクローラーの高さの計算は、この器が居る前提で組まれている＝器ごと
  // 消すとスクロール位置が飛ぶ。
  it("仮想スクローラーの器ではなく投稿カードそのものを返す", () => {
    const post = renderPost();

    expect(weiboAdapter.findPostCell(post)).toBe(post);
  });
});

describe("反応数を読む", () => {
  it("丸めが始まる前の数はそのまま読む", () => {
    expect(weiboAdapter.readMetricCount(renderPost({ likes: "523" }))).toBe(
      523,
    );
  });

  // 1万以上は丸められ、実数を持つ要素はどこにも無い。読めるのは表示桁までの値。
  it("1万以上の丸め表記を読む", () => {
    expect(weiboAdapter.readMetricCount(renderPost({ likes: "1.2万" }))).toBe(
      12000,
    );
    expect(weiboAdapter.readMetricCount(renderPost({ likes: "115万" }))).toBe(
      1150000,
    );
  });

  // 反応が無い投稿は、数の代わりにラベルの文字が入る。
  it("反応が無い投稿のラベル文字を0と読む", () => {
    expect(weiboAdapter.readMetricCount(renderPost({ likes: "赞" }))).toBe(0);
  });

  it("赞のボタンが無ければ0", () => {
    expect(weiboAdapter.readMetricCount(render("<article></article>"))).toBe(0);
  });
});

describe("投稿時刻を読む", () => {
  // タイムゾーンの表記は無く、Weibo 側はブラウザのローカル時刻で書き出している。
  it("一覧ではリンクの title にある絶対時刻を読む", () => {
    const post = renderPost({ time: "2026-08-04 12:00" });

    expect(weiboAdapter.readCreatedAt(post)).toBe(
      new Date(2026, 7, 4, 12, 0).getTime(),
    );
  });

  // 投稿詳細では title が空になり、代わりにリンクの文字が2桁年の絶対時刻になる。
  it("投稿詳細では2桁年のテキストを読む", () => {
    const post = renderPost({ time: "", timeText: "26-8-4 17:59" });

    expect(weiboAdapter.readCreatedAt(post)).toBe(
      new Date(2026, 7, 4, 17, 59).getTime(),
    );
  });

  // 読めなくても全期間の判定は動く。
  it("相対表記しか無ければ読めないものとして返す", () => {
    const post = renderPost({ time: "", timeText: "9小时前" });

    expect(weiboAdapter.readCreatedAt(post)).toBeNaN();
  });

  it("時刻ではない title のリンクを飛ばして読む", () => {
    const post = renderPost();
    post.insertAdjacentHTML(
      "afterbegin",
      '<a href="/u/1" title="山田太郎">山田太郎</a>',
    );

    expect(weiboAdapter.readCreatedAt(post)).toBe(
      new Date(2026, 7, 4, 12, 0).getTime(),
    );
  });
});

describe("メディアの有無を読む", () => {
  it("本文の画像ブロックにある画像を読む", () => {
    expect(weiboAdapter.readMedia(renderPost({ content: PICTURE }))).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  // 再生前の動画に <video> は無い。あるのは再生アイコンだけ。
  it("再生前の動画を再生アイコンから読む", () => {
    const media = weiboAdapter.readMedia(
      renderPost({ content: UNPLAYED_VIDEO }),
    );

    expect(media.hasVideo).toBe(true);
  });

  // アバターは本文の器の外、カスタム絵文字とリンクカードのサムネイルは器の中で
  // 画像ブロックの外にある＝どれも本文の画像ではない。
  it("アバター・カスタム絵文字・リンクカードのサムネイルをメディアと数えない", () => {
    const post = renderPost({
      content:
        'おはよう<img src="emoji.png" alt="[心]">' +
        '<a href="https://example.com"><img src="card.jpg" alt=""></a>',
    });

    expect(weiboAdapter.readMedia(post)).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });

  it("本文の器が無ければメディアも無い", () => {
    expect(weiboAdapter.readMedia(render("<article></article>"))).toEqual({
      hasImage: false,
      hasVideo: false,
    });
  });
});

describe("しきい値", () => {
  // 赞は1人1回で X のいいねと同じもの＝設定項目は増やさない。
  it("X と同じしきい値を使う", () => {
    expect(weiboAdapter.settingsKey).toBe("x");
    expect(weiboAdapter.settingsKey).toBe(xAdapter.settingsKey);
  });
});

describe("本文を読む", () => {
  it("投稿自身の本文とハッシュタグを読む", () => {
    expect(
      weiboAdapter.readText(
        renderPost({
          content: '新作の予告 <a href="/topic">#映画</a>',
        }),
      ),
    ).toBe("新作の予告 #映画");
  });
});
