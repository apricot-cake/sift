// 開発時の worker を開発サーバーへ繋いだままにするためのもの。
//
// なぜこれが要るか＝開発モードでは、WXT は content script を manifest へ入れない。
// ファイルはビルドするが `content_scripts` は書かず、スクリプトは実行時に登録
// する。しかもそれは、service worker が開発サーバーへ WebSocket を開いて名乗り
// 出たことへの応答としてしか行われない。その登録を行うものは他に無いので、
// 繋がっていない worker はそのまま「content script が存在しない」ことを意味し、
// ページは拡張機能が1つも載らないまま読み込まれる（#31）。
//
// worker のソケットは worker の起動時に一度だけ開かれ、二度と試されない。だから
// ありふれた2つのことが、この繋がりを恒久的に壊す。
//
//   - `npm run dev` より前にブラウザが開いていた＝ソケットは拒まれ、worker は
//     生きたまま（WXT が 5 秒ごとに API を叩いてそう保つ）二度と試さない
//   - 開発サーバーを起動し直した＝ソケットは閉じ、やはりそれを繋ぎ直すものが
//     無い
//
// 確実に繋ぎ直せる唯一の手段が worker を起動し直すことで、それをするのが
// `browser.runtime.reload()`。だから worker はその2つの状態を見張り、そこから
// 自分を起動し直して抜ける。それを見えるようにしているのがサーバーの boot id＝
// 「自分が起動したときに見た id」と「今立っている id」の対比。
//
// これを持っているのは開発ビルドだけ＝リリースからどう落とされるかは
// entrypoints/background.ts を参照。

// この worker が、どの世代のサーバーのために既に起動し直したか。記憶ではなく
// session ストレージなのは、起動し直すこと自体が記憶の消失だから＝これが無いと
// worker は戻ってきて同じ状態を見て、永久に起動し直し続ける。
export const DEV_LINK_RELOAD_KEY = "siftDevLinkReloadedBoot";

// content script が「自分は走った」と名乗るためのもの。登録が効いたことを
// Chrome の外から示す唯一の証拠であり、同時に、対象のページが読み込まれたときに
// 眠っている worker を起こすイベントも兼ねる。
export const DEV_CONTENT_STARTED = "sift:dev-content-started";

// content script がページ上で最初に完了させたフィルタの一巡。「スクリプトが
// 読み込まれた」と「スクリプトが仕事をした」は別の主張で、拡張機能が動いて
// いるかに答えるのは後者だけ＝だから数を一緒に出す。実行環境につき1回＝一巡
// 自体はタイムラインを変える描画のたびに走る。
export const DEV_FILTER_PASS = "sift:dev-filter-pass";

// content script が browser.runtime.sendMessage で background の worker へ送る
// 2つのメッセージ＝開発ビルドでその経路を通るのはこれだけ。
export interface DevContentStartedMessage {
  type: typeof DEV_CONTENT_STARTED;
  page: string;
}
export interface DevFilterPassMessage {
  type: typeof DEV_FILTER_PASS;
  counts: {
    visible: number;
    matched: number;
    hidden: number;
  };
}
export type DevLinkMessage = DevContentStartedMessage | DevFilterPassMessage;

export interface DevLinkProbe {
  // サーバーの世代。落ちていれば null
  boot: string | null;
  // ビルドがディスクへ書かれたか
  ready: boolean;
  // これが worker の最初の問い合わせか
  isFirstProbe: boolean;
  // worker の起動時に引き受けた世代
  bootAtStart?: string;
  // 今この時点で登録されている content script
  registeredCount: number;
  // 既にそのために起動し直した世代
  reloadedForBoot?: string;
}

export type DevLinkAction =
  | "server-down"
  | "building"
  | "adopt"
  | "linked"
  | "reload"
  | "waiting";

// worker から切り出してあるのは、意味のある場合分けがどれも「サーバーは立って
// いるか」「同じサーバーか」「もう試したか」の組み合わせだから＝ブラウザで
// 再現するのが最悪に面倒で、テストで書くのは何でもない形。
export function decideDevLinkAction({
  boot,
  ready,
  isFirstProbe,
  bootAtStart,
  registeredCount,
  reloadedForBoot,
}: DevLinkProbe): DevLinkAction {
  if (boot == null) {
    return "server-down";
  }

  // サーバーはビルドを書き終える前に応答する。中身が一瞬空の展開済み拡張機能を
  // 再読み込みするのは再試行ではない＝Chrome は拡張機能を降ろし、そのことを
  // ダイアログで人に伝える。待つ以外にすることは無い。
  if (!ready) {
    return "building";
  }

  // worker のソケットはついさっき、この同じサーバーに対して開かれた＝だから
  // 繋がっているか、応答にかかる1秒のうちに繋がる。
  if (isFirstProbe) {
    return "adopt";
  }

  if (boot === bootAtStart && registeredCount > 0) {
    return "linked";
  }

  // サーバーの世代ごとに起動し直しは1回。戻ってきても直っていないなら別の何かが
  // おかしいのであって、繰り返してもそれを隠すだけ。
  if (reloadedForBoot === boot) {
    return "waiting";
  }

  return "reload";
}
