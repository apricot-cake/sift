// Weibo（微博・weibo.com）。このファイルにあるのは全部 Weibo の画面の作り＝どの
// 要素が投稿で、判定の入力がそれぞれどこに書かれているか。判定そのものは
// filter-core.ts にあり、全サービスで共有している。
//
// Weibo の PC 版は Vue 製で、クラス名の大半は CSS Modules のハッシュ
// （`_num_198pe_46` の形）＝ビルドごとに変わるので掴めない。掴めるのは要素名
// （`article` `header` `footer`）、デザインシステム "woo" のグローバルクラス
// （`woo-like-main` `woo-like-count` `woo-font--play` `woo-avatar-main`）、
// `wbpro-` 接頭辞のクラス（`wbpro-feed-content` `wbpro-scroller-item`）、
// `aria-label` と `title` 属性だけ。以下のセレクタは全部そのどれか。
//
// 2026-08-04 に、未ログインで描画される範囲＝推薦タイムラインと投稿詳細の実 DOM
// で確認した（#46）。ログインを求められる画面（ホーム・プロフィール）と、別ホスト
// の検索結果（s.weibo.com）はまだ見ていない。
//
// このアダプターはまだ ADAPTERS に載せていない。転送（转发）投稿の構造を確認
// できておらず readIsRepost() が書けていないため（#46 の「未決」）。載せるのは
// 実機で確認してから＝載せた時点で manifest の登録先も決まるが、対象にする画面
// もその未決の1つ。
import { normalizeDigits, parseMetric } from "../filter-core.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import type { ServiceAdapter } from "./types.ts";

// Weibo の画面の作りを1箇所に集めてあるので、Weibo 側の描き直しはここ1箇所の
// 修正で済む。エクスポートしないのは、テストが与えるのはマークアップで、
// 読み取るのはこのファイルがそれに対して返す答えだから
// （utils/adapters/weibo.test.ts）。
const WEIBO_SELECTORS = Object.freeze({
  postCard: "article",
  // 赞のボタン。投稿カードと数える条件にもしている＝`article` はこのページの中で
  // 投稿以外にも使われうる要素名で、それ自身は何も名乗らない。
  reactionButton: "button.woo-like-main",
  reactionCount: ".woo-like-count",
  // 投稿時刻を持つリンク。href の形には頼らない＝掴めると分かっているのは
  // `title` 属性の方で、それが時刻かどうかは値の形で見分ける（下の2つの正規表現）。
  timeLink: "a[title]",
  // 本文の器。アバターを本文の画像から分けている外側の境界。
  content: ".wbpro-feed-content",
  // 本文の器の中の画像ブロック。内側の境界＝カスタム絵文字とリンクカードの
  // サムネイルは器の中にあるが、このブロックの中には無い。
  picture: ".picture",
  // 再生前の動画に <video> は無い（Bluesky と同じ）。あるのはサムネイルと、
  // その上に重なる再生アイコン。
  video: "i.woo-font--play",
});

// 一覧のリンクの `title` に入っている形。タイムゾーンの表記は無い。
const ABSOLUTE_TIME = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/;
// 投稿詳細のリンクの文字。`title` が空になる代わりにこちらへ出る＝年が2桁で、
// 月と日のゼロ埋めも無い。
const SHORT_YEAR_TIME = /^(\d{2})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/;

function pad(value: string | undefined): string {
  return (value ?? "").padStart(2, "0");
}

// `YYYY-MM-DD HH:mm` と `YY-M-D HH:mm` の両方を、同じ1つの解釈へ落とす。
//
// スペース区切りのまま Date.parse へ渡さないのは、その形の解釈が実装依存だから
// ＝ECMAScript が定義しているのは `YYYY-MM-DDTHH:mm` の方で、そちらはタイム
// ゾーンの表記が無ければローカル時刻と決まっている。Weibo 側もローカル基準で
// 書き出している（同じ投稿の相対表記と、ブラウザのローカル時刻で整合した）ので、
// この解釈で一致する。
function parseWeiboTime(value: string): number {
  const text = normalizeDigits(value).trim();

  const absolute = ABSOLUTE_TIME.exec(text);
  if (absolute) {
    const [, year, month, day, hour, minute] = absolute;
    return Date.parse(`${year}-${month}-${day}T${pad(hour)}:${minute}`);
  }

  const shortYear = SHORT_YEAR_TIME.exec(text);
  if (shortYear) {
    const [, year, month, day, hour, minute] = shortYear;
    return Date.parse(
      `20${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${minute}`,
    );
  }

  return Number.NaN;
}

function postCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(WEIBO_SELECTORS.postCard)).filter(
    (postCard) => postCard.querySelector(WEIBO_SELECTORS.reactionButton),
  );
}

// `:` の注釈ではなく `satisfies`。理由は x.ts を参照。
export const weiboAdapter = Object.freeze({
  id: "weibo",
  matches: Object.freeze(["https://weibo.com/*"]),
  // しきい値が数える反応を、このサービスでは何と呼ぶか。赞は1人1回で X の
  // いいねと同じものなので、しきい値も共有する。
  thresholdKeys: LIKE_THRESHOLDS,

  getPostCards(root: ParentNode) {
    return postCards(root);
  },

  hasPostCards(root: ParentNode) {
    return postCards(root).length > 0;
  },

  // 隠される単位は投稿カードそのもの＝外側の `.wbpro-scroller-item` ではない。
  // 仮想スクローラーは自分の非表示を `display: none` で行い、高さの計算はその器
  // が居る前提で組まれているので、器ごと消すとスクロール位置が飛ぶ。
  findPostCell(postCard: Element) {
    return postCard;
  },

  // 1万以上は「1.2万」「115万」と丸められる。フッターの `aria-label`（转发・
  // 评论・赞の3つ組）も同じ丸め表記で、実数を持つ要素はどこにも無い＝丸めの誤差
  // は表示桁ぶんで最大 ±500 になる。既定のしきい値500の周辺はまだ丸めが始まらず
  // 実数で出る。
  readReactionCount(postCard: Element) {
    const count = postCard
      .querySelector(WEIBO_SELECTORS.reactionButton)
      ?.querySelector(WEIBO_SELECTORS.reactionCount);
    if (!count) {
      return 0;
    }

    // 反応が無い投稿は、数の代わりにラベルの文字（「赞」）が入る。parseMetric も
    // 数字を含まない文字列には0を返すが、それは数として読めなかった時の答えで
    // あって、0件だと読んだ答えではない。
    const text = normalizeDigits(count.textContent).trim();
    return /\d/.test(text) ? parseMetric(text) : 0;
  },

  // Weibo は <time datetime> を書き出さない。画面に出ている文字は一覧でも相対
  // 表記（「9小时前」「昨天 17:59」）で、絶対時刻はリンクの `title` にある。投稿
  // 詳細ではその `title` が空になり、代わりにリンクの文字が2桁年の絶対時刻に
  // なる＝だから同じリンクに対して両方を順に試す。
  //
  // 相対表記しか無い画面では読めないものとして NaN を返す。そのとき落ちるのは
  // 「上昇中」の判定だけで、通常の判定は動く（Bluesky・Misskey と同じ）。
  //
  // 却下した案 — 投稿 URL の末尾（mid）から復元する。Bluesky の record key と
  // 違い、Weibo の mid にタイムスタンプは埋まっておらず、復元の仕様も公開されて
  // いない。
  readCreatedAt(postCard: Element) {
    for (const link of postCard.querySelectorAll(WEIBO_SELECTORS.timeLink)) {
      const fromTitle = parseWeiboTime(link.getAttribute("title") ?? "");
      if (Number.isFinite(fromTitle)) {
        return fromTitle;
      }

      const fromText = parseWeiboTime(link.textContent ?? "");
      if (Number.isFinite(fromText)) {
        return fromText;
      }
    }

    return Number.NaN;
  },

  // 画像と動画は別々に返す＝どちらをメディアと数えるかは利用者の設定であって、
  // このサービスの作りの話ではない。
  //
  // Weibo はアバターもカスタム絵文字もリンクカードのアイコンも `img` で描く。
  // 本文の器の中、かつ画像ブロックの中に限ることで、この3つは自然に外れる＝
  // アバターは器の外に、絵文字とリンクカードは器の中だが画像ブロックの外に
  // 描かれる。
  readMedia(postCard: Element) {
    const content = postCard.querySelector(WEIBO_SELECTORS.content);
    if (!content) {
      return { hasImage: false, hasVideo: false };
    }

    return {
      hasImage: Boolean(
        content.querySelector(`${WEIBO_SELECTORS.picture} img`),
      ),
      hasVideo: Boolean(content.querySelector(WEIBO_SELECTORS.video)),
    };
  },

  readText(postCard: Element) {
    return postCard.querySelector(WEIBO_SELECTORS.content)?.textContent ?? "";
  },

  // まだ書けていない。Weibo の转发は元投稿を引用する形しか無く、hideReposts が
  // 外すべきなのはそのうちコメント無しのもの＝元投稿の器を持ち、自分の本文が無い
  // 投稿。判定を文言ではなく構造で行うのは、Weibo が简体・繁体・英語の表示切替を
  // 持つため。
  //
  // その構造を確認できていない＝未ログインの推薦タイムラインはオリジナル投稿しか
  // 出さない（#46 の「未決」）。ここで false を返しているのは「転送ではない」と
  // いう判断ではなく、判断を持っていないという意味。このアダプターを ADAPTERS へ
  // 載せていないのはそれが理由。
  readIsRepost(_postCard: Element) {
    return false;
  },
}) satisfies ServiceAdapter;
