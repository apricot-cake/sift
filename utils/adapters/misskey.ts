// Misskey。このファイルにあるのは全部 Misskey の画面の作り＝どの要素がノート
// で、判定の入力がそれぞれどこに書かれているか。判定そのものは filter-core.ts
// にあり、全サービスで共有している。
//
// Misskey は読み手に掴めるものをほとんど残さない。クラス名はビルドごとの
// ハッシュ（CSS Modules）で、古い版が持っていた data-cy-* 属性も無くなった。
// 安定して掴めるのは要素名・グローバルなユーティリティクラス `_button`・
// アバターの `_noSelect`・アイコンフォントのクラス `ti ti-*` だけ（#2 の
// Issue コメント第3節）。以下のセレクタは全部そのどれか。
//
// 対応先は misskey.io。リアクション総数・ノートの時刻・メディアの有無を DOM
// から読み、同じノートに対する API の答えと突き合わせている。
import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

// Misskey の画面の作りを1箇所に集めてあるので、インスタンス側の変更はここ1箇所
// の修正で済む。エクスポートしないのは、テストが与えるのはマークアップで、
// 読み取るのはこのファイルがそれに対して返す答えだから
// （utils/adapters/misskey.test.ts）。
const MISSKEY_SELECTORS = Object.freeze({
  // ノートは <div>（root）> <article> として描かれる。クライアント内で <article>
  // を使うのはここだけだが、インスタンス独自の追加が使う可能性はあるので、
  // カードと数えるにはノートの時刻も持っていることを条件にする。
  postCard: "article",
  createdAt: "time[title]",
  postLink: 'a[href*="/notes/"]',
  // リアクションのチップも、フッターの返信・リノート・リアクションのボタンも、
  // どれも `button._button`。見分けているのは下の readMetricCount()。
  reactionButton: "button._button",
  icon: 'i[class*="ti-"]',
  // リノートのヘッダのアイコン。フッターのリノートボタンにも出るので、
  // readIsRepost() は article より上だけを見る。
  repost: "i.ti-repeat",
  // アバターとその装飾。`_noSelect` はハッシュ化されないグローバルな
  // ユーティリティクラス。
  avatar: "._noSelect",
  // 再生前の動画は、ビルドによって <video> だったり、再生アイコンの下の
  // サムネイル <img> だったりする。クリックして初めて出る動画はそのどちらでもない。
  video: "video, i.ti-player-play, i.ti-movie",
  // 隠された画像が残すもの＝閲覧注意のファイル（種類までは分からない）か、
  // データセーバーが止めたファイルのプレースホルダ。
  hiddenMedia: "i.ti-photo, i.ti-eye-exclamation",
  postText: "._selectable",
  // クライアントが動く前の、サーバー応答のページに書き込まれている。
  application: 'meta[name="application-name"][content="Misskey"]',
  timelineHome: "button._button:has(i.ti-home)",
  timelineLocal: "button._button:has(i.ti-planet)",
  timelineGlobal: "button._button:has(i.ti-whirl)",
});

// 対応ホストのページが Misskey かどうかを、サーバーの HTML テンプレートにある
// application-name で確認する。
export function isMisskeyPage(page: ParentNode): boolean {
  return Boolean(page.querySelector(MISSKEY_SELECTORS.application));
}

// カスタム絵文字の alt。ローカル（":party:"）とリモート（":party@example:"）。
const EMOJI_SHORTCODE = /^:.+:$/;
// 画像ではなく文字として描かれる絵文字＝ネイティブ絵文字のリアクションがチップ
// の文字に残すものと、MkEmoji が img の alt に入れるもの。数字は意図的に落として
// いない（\p{Emoji_Component} だと数字まで持っていかれる）。
//
// \uFE0F（異体字セレクタ16）と \u200D（ゼロ幅接合子）は複数コードポイントの
// 絵文字を1つに繋ぎ止めているもので、ここでは意図的にコードポイント単位で外す＝
// 目的は絵文字を1つの書記素として一致させることではなく、絵文字の痕跡を残さない
// こと。1つの文字クラスにせず選択にしているのは、文字クラスの中の結合文字は
// どのみち単独で一致するうえ、直前の文字の一部であるかのように読めてしまうから。
const EMOJI_TEXT =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u200D|\s/gu;
// 絵文字を外したあとのリアクションチップの文字は、その数だけになる。
const COUNT_ONLY = /^\d[\d,]*$/;

const MISSKEY_SELECTED_TIMELINE_PATH =
  /^\/timeline\/(?:list\/[^/]+|antenna\/[^/]+)\/?$/;
const MISSKEY_NOTE_ID = /\/notes\/([^/?#]+)/;

export function isMisskeyFilterPage(pathname: string): boolean {
  return (
    pathname === "/search" || MISSKEY_SELECTED_TIMELINE_PATH.test(pathname)
  );
}

function isHomeTimelineSelected(root: ParentNode): boolean {
  const home = root.querySelector(MISSKEY_SELECTORS.timelineHome);
  const switcher = home?.parentElement;
  if (
    !home ||
    !switcher?.querySelector(MISSKEY_SELECTORS.timelineLocal) ||
    !switcher.querySelector(MISSKEY_SELECTORS.timelineGlobal)
  ) {
    return false;
  }

  // Misskey は選択中のタイムライン名だけを表示し、他の名前は inline の
  // display: none または width: 0 にする。クラス名はビルドごとに変わるため、
  // 固定のアイコンとこの表示状態を組み合わせてホームを判定する。
  const label = home.querySelector("i.ti-home + div") as HTMLElement | null;
  return (
    label !== null &&
    label.style.display !== "none" &&
    label.style.width !== "0px"
  );
}

function noteCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(MISSKEY_SELECTORS.postCard)).filter(
    (postCard) => postCard.querySelector(MISSKEY_SELECTORS.createdAt),
  );
}

// アバター・アバターの装飾・ロールバッジ・絵文字ではなく、ノートのメディアの
// 一部である画像なら true。Misskey はこれらに印を付けないので、`alt` に何を残す
// かで読む＝メディアはファイルのコメントか名前を持ち、それ以外は読める文字を
// 持たない。
function isNoteImage(image: Element): boolean {
  if (image.closest(MISSKEY_SELECTORS.avatar)) {
    return false;
  }

  // 動画のポスターフレームも <img> で、alt にファイル自身のコメントを持つ＝
  // 画像と同じく読める文字が入る。見分けているのは、同じ入れ物の中でその上に
  // 描かれる再生の操作子。
  if (image.parentElement?.querySelector(MISSKEY_SELECTORS.video)) {
    return false;
  }

  const alt = (image.getAttribute("alt") ?? "").trim();
  // 空か無い＝アバターの装飾・ロールバッジ・動画のサムネイル。
  if (alt === "" || EMOJI_SHORTCODE.test(alt)) {
    return false;
  }
  return alt.replace(EMOJI_TEXT, "") !== "";
}

// `:` の注釈ではなく `satisfies`。理由は x.ts を参照。
export const misskeyAdapter = Object.freeze({
  id: "misskey",
  // Misskey の固定ホストはアダプターの外で manifest に足すため、ここでは
  // 重ねて宣言しない。振り分けは selectAdapter() が行う。
  matches: Object.freeze([]),
  // Misskey のリアクションは、いいねと同じく1人1回。ただしインスタンスの規模が
  // X とは桁で違うので、専用のしきい値と比べる（#2 の Issue コメント第4節）。
  settingsKey: "misskey",

  getPostCards(root: ParentNode) {
    return noteCards(root);
  },

  hasPostCards(root: ParentNode) {
    return noteCards(root).length > 0;
  },

  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    const selectedPage =
      isMisskeyFilterPage(page.pathname) ||
      (page.pathname === "/" && isHomeTimelineSelected(root));
    return selectedPage && this.hasPostCards(root);
  },

  settingsScope(root: ParentNode, page: Pick<Location, "pathname">) {
    if (page.pathname === "/" && isHomeTimelineSelected(root)) {
      return { key: "home", kind: "home" } as const;
    }
    const listId = /^\/timeline\/list\/([^/]+)\/?$/.exec(page.pathname)?.[1];
    if (listId) {
      return { key: `list:${listId}`, kind: "list" } as const;
    }
    const antennaId = /^\/timeline\/antenna\/([^/]+)\/?$/.exec(
      page.pathname,
    )?.[1];
    return antennaId
      ? ({ key: `antenna:${antennaId}`, kind: "antenna" } as const)
      : null;
  },

  // 隠される単位は article ではなくノートの root＝リノートのヘッダと返信先の
  // ノートは article の外に描かれるので、article だけを隠すとそれらが残る。
  findPostCell(postCard: Element) {
    return postCard.parentElement ?? postCard;
  },

  readPostId(postCard: Element) {
    for (const link of postCard.querySelectorAll(MISSKEY_SELECTORS.postLink)) {
      const noteId = MISSKEY_NOTE_ID.exec(link.getAttribute("href") ?? "")?.[1];
      if (noteId) {
        return noteId;
      }
    }
    return null;
  },

  // Misskey はリアクションの総数をページに出さない。フッターに出せはするが、
  // それは設定を入れた利用者にだけ（`showReactionsCount`・既定は off）なので、
  // 常にあるのは絵文字ごとに1つずつのチップとその個別の数＝これを足し合わせる。
  //
  // 同じ `_button` クラスを持つフッターのボタンとの見分けは、中身で行う＝
  // フッターのボタンは必ず `ti-*` のアイコンから始まり、チップの文字は数だけ
  // （絵文字は画像か、ここで落とす文字）。長いノートの中の「もっと見る」も
  // `_button` だが、その文字は数ではなく言葉になる。
  //
  // チップは16種類で打ち切られる。これは Misskey 側の制限で、Sift が広げられる
  // 読み方ではない＝それより多くの種類が付いたノートは、描かれない尾の分だけ
  // ここでは少なく出る。
  readMetricCount(postCard: Element) {
    let total = 0;

    for (const button of postCard.querySelectorAll(
      MISSKEY_SELECTORS.reactionButton,
    )) {
      if (button.querySelector(MISSKEY_SELECTORS.icon)) {
        continue;
      }

      const text = (button.textContent ?? "").replace(EMOJI_TEXT, "");
      if (COUNT_ONLY.test(text)) {
        total += parseMetric(text);
      }
    }

    return total;
  },

  // Misskey は <time datetime> を書き出さない。あるのは要素の title に入った
  // 絶対時刻で、利用者のブラウザが要求するロケール向けに整形されている＝
  // Date.parse が理解できる利用者のページとそうでないページがある。理解できない
  // 場合も全期間の判定は動く。期間指定では、時刻を読めない投稿を隠さない。
  //
  // 日が先に来る形式（"5.8.2026, 17:44:21"）だけは、読めも落ちもしない唯一の
  // ケース＝Date.parse が月を先と解釈して何ヶ月も離れた日付を返す。その答えは
  // 期間指定では誤って期間外と判定するが、全期間の判定には影響しない。
  readCreatedAt(postCard: Element) {
    const title = postCard
      .querySelector(MISSKEY_SELECTORS.createdAt)
      ?.getAttribute("title");
    const timestamp = title ? Date.parse(title) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  },

  // 画像と動画は別々に返す＝どちらをメディアと数えるかは利用者の設定であって、
  // このサービスの作りの話ではない。クライアントがクリックの向こうに隠している
  // ファイルは画像として数える＝プレースホルダはファイルがあることは言うが種類は
  // 言わないし、メディアが無いと読んだノートはそのまま隠されてしまう。
  readMedia(postCard: Element) {
    const images = Array.from(postCard.querySelectorAll("img")).some(
      isNoteImage,
    );
    return {
      hasImage:
        images ||
        Boolean(postCard.querySelector(MISSKEY_SELECTORS.hiddenMedia)),
      hasVideo: Boolean(postCard.querySelector(MISSKEY_SELECTORS.video)),
    };
  },

  readText(postCard: Element) {
    return Array.from(postCard.querySelectorAll(MISSKEY_SELECTORS.postText))
      .filter((text) => text.closest(MISSKEY_SELECTORS.postCard) === postCard)
      .map((text) => text.textContent ?? "")
      .join(" ");
  },

  // リノートは、同じ root の中で article の上のヘッダとして描かれる。ヘッダの
  // 文字はローカライズされていて（「◯◯がリノート」）、それ自身の目印を持たない
  // ので、読むのはアイコンの方＝ただしフッターのリノートボタンが同じアイコンを
  // 使うため、article より前の要素だけを見る。
  //
  // 引用リノートはここではリノートではない＝投稿者自身の本文を伴い、通常の
  // ノートとして描かれる。それが hideReposts の対象から外れる理由。
  readIsRepost(postCard: Element) {
    const root = postCard.parentElement;
    if (!root) {
      return false;
    }

    for (const sibling of root.children) {
      if (sibling === postCard) {
        return false;
      }
      if (sibling.querySelector(MISSKEY_SELECTORS.repost)) {
        return true;
      }
    }

    return false;
  },
}) satisfies ServiceAdapter;
