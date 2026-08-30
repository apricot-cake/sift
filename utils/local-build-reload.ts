import { browser } from "wxt/browser";

export const RELOAD_HOST_NAME = "io.github.apricot_cake.sift.reload";
export const RELOAD_ATTEMPT_KEY = "sift.localBuildReload.attempted";

export function buildToReload(
  message: unknown,
  ownBuild: string,
  attemptedBuild: unknown,
): string | null {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== "build-available" ||
    !("build" in message) ||
    typeof message.build !== "string" ||
    message.build === "" ||
    message.build === ownBuild ||
    message.build === attemptedBuild
  ) {
    return null;
  }
  return message.build;
}

export function startLocalBuildReload(ownBuild: string): () => void {
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentPort: ReturnType<typeof browser.runtime.connectNative> | null =
    null;
  let queue = Promise.resolve();

  const connect = () => {
    if (stopped) return;
    const port = browser.runtime.connectNative(RELOAD_HOST_NAME);
    currentPort = port;

    port.onMessage.addListener((message: unknown) => {
      queue = queue
        .then(async () => {
          const stored = await browser.storage.local.get(RELOAD_ATTEMPT_KEY);
          const build = buildToReload(
            message,
            ownBuild,
            stored[RELOAD_ATTEMPT_KEY],
          );
          if (!build) return;

          // storage.local は runtime.reload() をまたぐ。同じスタンプでの試行は
          // 一度だけにし、出力先を取り違えた場合もリロードを繰り返さない。
          await browser.storage.local.set({ [RELOAD_ATTEMPT_KEY]: build });
          browser.runtime.reload();
        })
        .catch(() => {});
    });

    port.onDisconnect.addListener(() => {
      // lastError を読むと、接続できなかった試行もChromeの未処理エラーに
      // ならない。Host登録中などの一時的な失敗は次の再接続で回復する。
      void browser.runtime.lastError;
      if (currentPort === port) currentPort = null;
      if (!stopped) reconnectTimer = setTimeout(connect, 1000);
    });
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    currentPort?.disconnect();
    currentPort = null;
  };
}
