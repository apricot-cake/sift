import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";
import {
  DEV_CONTENT_STARTED,
  DEV_FILTER_PASS,
  DEV_LINK_RELOAD_KEY,
  type DevLinkAction,
  type DevLinkMessage,
  decideDevLinkAction,
} from "../utils/dev-link.ts";
import {
  DEV_PING_ENDPOINT,
  DEV_SERVER_ORIGIN,
  ERROR_LOG_ENDPOINT,
} from "../utils/dev-server.ts";
import { drainErrorLog } from "../utils/error-drain.ts";
import { errorLogItem, startUncaughtReporting } from "../utils/error-log.ts";
import { isOpenLiveControlsRequest } from "../utils/live-controls.ts";
import { TIMELINE_CONTROL } from "../utils/timeline-controls.ts";

// このファイルは、開発時のエラーログの送り出しと dev-link の
// 追跡は開発ビルドでしか走らない＝Chrome がその情報を見せる相手は、画面を
// 見ている人だけで、他の誰でもないから。
//
//   - 捕まえ損ねた例外が届く先は chrome://extensions のエラー欄だけで、そこは
//     Chrome の外からは誰にも読めない。どの画面もそれを
//     browser.storage.local の環状バッファへ書き（utils/error-log.ts）、この
//     worker がそのバッファを開発サーバーのエンドポイント経由で
//     ~/.sift/extension-errors.log へ運び出す。
//   - 開発モードでは、content script はこの worker が開発サーバーへ繋がって
//     いる間しか存在しない（utils/dev-link.ts）。繋がっているかどうかも、
//     ページが実際にスクリプトを受け取ったかどうかも、同じファイルへ行く。
//
// なぜリリースビルドもこのファイルを持っているか＝`__SIFT_DEV__` はビルド時に
// 定数へ畳まれるので（wxt.config.ts が Vite の command で決める）、リリース
// ビルドではこの門より下は全部が到達不能になって落ちる。出荷されるのは
// 開発専用の半分については中身の無い worker。エラー報告の「集める側」はそれとは無関係に
// どのビルドでも生きている＝日常のブラウザでもバッファは埋まり続け、ただ開発
// ビルドがそれを読むまで送る相手がいないだけ。
//
// かつてこのファイルがやっていた、開いているタブへの content script の注入
// し直しは、今は WXT の開発モードがやっている。

// 開発サーバーへ、立っているかとどの世代かを訊く間隔。WXT がこの worker を
// 生かしておくために既に使っている間隔に合わせてあるので、これ自身が起床を
// 増やすことはない。
const DEV_LINK_INTERVAL_MS = 5000;

// この worker が、どの世代のサーバーのために既に自分を起動し直したか。session
// ストレージなので、それが記録する起動し直しより長生きし、次のブラウザの
// セッションの頃には消えている＝世代ごとに起動し直しは1回で、再起動の後は
// まっさら。
const devLinkReloadItem = storage.defineItem<string>(
  `session:${DEV_LINK_RELOAD_KEY}`,
);

export default defineBackground(() => {
  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;
  void sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  sidePanel?.onClosed?.addListener(() => {
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          void browser.tabs
            .sendMessage(tab.id, {
              type: TIMELINE_CONTROL.setFiltering,
              enabled: false,
            })
            .catch(() => {});
        }
      }
    });
  });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (isOpenLiveControlsRequest(message)) {
      if (sidePanel && sender.tab?.id !== undefined) {
        void sidePanel.open({ tabId: sender.tab.id });
        return;
      }
      const sidebarAction = (
        browser as unknown as { sidebarAction?: { open: () => Promise<void> } }
      ).sidebarAction;
      void sidebarAction?.open();
    }
  });

  if (!__SIFT_DEV__) {
    return;
  }

  startUncaughtReporting({
    target: globalThis,
    source: "background",
    filterToOwnCode: false,
  });

  const errorLogUrl = `${DEV_SERVER_ORIGIN}${ERROR_LOG_ENDPOINT}`;
  const postEntries = async (entries: unknown) => {
    const response = await fetch(errorLogUrl, {
      method: "POST",
      // text/plain にしておけばこれは単純リクエストのままなので、この送信が
      // プリフライトの応答に依存することはない。
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(entries),
    });
    if (!response.ok) {
      throw new Error(
        `開発時のエラーログが HTTP ${response.status} を返した。`,
      );
    }
  };

  const requestErrorLogDrain = () => {
    void drainErrorLog({ post: postEntries }).catch(() => {
      // 開発サーバーが落ちているかもしれない。記録はバッファに残る。
    });
  };

  // 開発時の覚え書きは例外と同じファイルへ行くので、`tail` 1つで、拡張機能が
  // 何をしているかと、それをする中で何が壊れたかの両方が見える。これは
  // バッファに溜めない＝誰も聞いていなかった覚え書きは、落ちていたサーバーに
  // ついての覚え書きであり、どのみち次の覚え書きがそう言う。
  const note = (message: string) => {
    void postEntries([
      {
        at: new Date().toISOString(),
        kind: "dev-link",
        source: "background",
        message,
      },
    ]).catch(() => {});
  };

  // どの画面からであれ、バッファに何かが書かれたことが送り出す理由になる。
  errorLogItem.watch(() => {
    requestErrorLogDrain();
  });
  requestErrorLogDrain();

  // content script が名乗り出たところ。ログの1行に値する＝実行時の登録が効いた
  // ことをブラウザの外から示す唯一の証拠だから。そしてリスナーにも値する＝
  // Chrome はこれを届けるために眠っている worker を起こすので、対象のページを
  // 開くことが、繋がりを取り戻せる手段の1つになる。
  browser.runtime.onMessage.addListener(
    (message: DevLinkMessage | undefined) => {
      if (message?.type === DEV_CONTENT_STARTED) {
        note(`content script が ${message.page} で起動した`);
      }
      if (message?.type === DEV_FILTER_PASS) {
        const { visible, matched, hidden } = message.counts;
        note(
          `フィルタ一巡: そのまま ${visible}・条件一致 ${matched}・非表示 ${hidden}`,
        );
      }
    },
  );

  // Chrome が worker を起こすのは、自分が聞いているイベントを届けるときだけ。
  // これが無いと、開発ビルドにはブラウザの起動時に worker を起こすものが無く、
  // 一度も走らない worker は一度も繋がらない＝そうしてプロファイル全体が、
  // どのページにも content script が無い状態になる（#31）。
  browser.runtime.onStartup.addListener(() => {});

  let bootAtStart: string | undefined;
  let isFirstProbe = true;
  let lastAction: DevLinkAction | undefined;

  const probeDevServer = async () => {
    try {
      const response = await fetch(`${DEV_SERVER_ORIGIN}${DEV_PING_ENDPOINT}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }
      const { boot, ready } = await response.json();
      return typeof boot === "string" ? { boot, ready: ready === true } : null;
    } catch {
      // 落ちているか、答えないか。どちらにせよ繋ぐ先が無い。
      return null;
    }
  };

  const checkDevLink = async () => {
    const probe = await probeDevServer();
    const [registered, reloadedForBoot] = await Promise.all([
      probe == null
        ? Promise.resolve([])
        : browser.scripting.getRegisteredContentScripts(),
      devLinkReloadItem.getValue(),
    ]);

    const boot = probe?.boot ?? null;
    const action = decideDevLinkAction({
      boot,
      ready: probe?.ready === true,
      isFirstProbe,
      bootAtStart,
      registeredCount: registered.length,
      reloadedForBoot: reloadedForBoot ?? undefined,
    });
    // まだビルドを書いていないサーバーは、この worker が繋がっているかについて
    // 何も教えてくれないので、最初の1回は使わないままにしておく。
    if (action !== "building") {
      isFirstProbe = false;
    }

    if (action === "adopt") {
      // decideDevLinkAction() が "adopt" を返すのは boot が null でないと
      // 確かめた後だけ（そうでなければ先に "server-down" を返す）＝ここの
      // 既定値は型を満たすためだけのもの。
      bootAtStart = boot ?? undefined;
    }
    if (action !== lastAction) {
      lastAction = action;
      note(`開発時の繋がり: ${action}（登録 ${registered.length} 件）`);
    }
    if (action === "reload") {
      // boot が null の間、decideDevLinkAction() は "reload" を返す前に必ず
      // "server-down" を返すので、この検査は起きうる場合ではなく型を満たす
      // ためのもの。
      if (boot !== null) {
        await devLinkReloadItem.setValue(boot);
      }
      browser.runtime.reload();
    }
  };

  const runDevLinkCheck = () => {
    void checkDevLink().catch(() => {
      // 拡張機能を起動し直すと、進行中のものは全部拒まれる。することは無い。
    });
  };

  runDevLinkCheck();
  setInterval(runDevLinkCheck, DEV_LINK_INTERVAL_MS);
});
