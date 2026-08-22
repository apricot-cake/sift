import type { WxtDevServer } from "wxt";

// WXT は content script のビルドが終わるたびに、対象サイトを開いている全タブを
// 再読み込みする。複数ファイルを続けて直すと、その数だけ実在するサイトへ再読み
// 込みを送ることになる。開発版の接続時だけ最新の content script を登録し、編集中
// の自動再読み込みは止める。WXT の再読み込み操作（既定は Alt+R）で extension が
// 起動し直されると接続イベントが再び来るため、その一度だけ最新ビルドを反映する。
export function requireExplicitContentScriptReload(server: WxtDevServer): void {
  const reloadContentScript = server.reloadContentScript.bind(server);
  let connectionInitialization = false;

  server.ws.on("wxt:background-initialized", () => {
    connectionInitialization = true;
    setTimeout(() => {
      connectionInitialization = false;
    }, 0);
  });

  server.reloadContentScript = (payload) => {
    if (connectionInitialization) {
      reloadContentScript(payload);
    }
  };
}
