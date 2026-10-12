import { type Browser, type CDPSession, ProtocolError } from "puppeteer-core";
import { callFunction } from "./cdp-call.ts";

/** 再起動した service worker を公開 CDP API で取得する。 */
export async function getExtensionWorker(
  browser: Browser,
  extensionId: string,
  timeout = 10000,
  previousTargetId?: string,
): Promise<ExtensionWorker> {
  const root = await browser.target().createCDPSession();
  let session: CDPSession | undefined;
  const currentTarget = async (id: string) => {
    const { targetInfos } = await root.send("Target.getTargets");
    return targetInfos.some(
      (info) =>
        info.targetId === id &&
        info.targetId !== previousTargetId &&
        info.type === "service_worker" &&
        info.url === `chrome-extension://${extensionId}/background.js`,
    );
  };
  try {
    const target = await browser.waitForTarget(
      async (target) => {
        if (
          target.type() !== "service_worker" ||
          target.url() !== `chrome-extension://${extensionId}/background.js`
        )
          return false;
        let probe: CDPSession | undefined;
        try {
          // SDK に残った worker.client を再利用せず、現存 target に接続する。
          probe = await target.createCDPSession();
          const { targetInfo } = await probe.send("Target.getTargetInfo");
          return await currentTarget(targetInfo.targetId);
        } catch (error) {
          // 再読み込みで消えた target だけを除外し、現在の worker を待つ。
          if (
            error instanceof ProtocolError &&
            /No target with given id found|Target closed|Session closed/.test(
              error.message,
            )
          )
            return false;
          throw error;
        } finally {
          if (probe && !probe.detached) await probe.detach();
        }
      },
      { timeout },
    );
    session = await target.createCDPSession();
    const { targetInfo } = await session.send("Target.getTargetInfo");
    if (!(await currentTarget(targetInfo.targetId)))
      throw new Error("選択した service worker は既に終了しています。");
    // 自分で作成した session の Runtime 初期化が完了してから評価する。
    await session.send("Runtime.enable");
    return new ExtensionWorker(targetInfo.targetId, session, root);
  } catch (error) {
    if (session && !session.detached) await session.detach().catch(() => {});
    await root.detach().catch(() => {});
    throw error;
  }
}

export class ExtensionWorker {
  readonly targetId: string;
  private session: CDPSession;
  private root: CDPSession;

  constructor(targetId: string, session: CDPSession, root: CDPSession) {
    this.targetId = targetId;
    this.session = session;
    this.root = root;
  }

  async evaluate<Args extends unknown[], R>(
    fn: (...args: Args) => R,
    ...args: Args
  ): Promise<Awaited<R>>;
  async evaluate(expression: string): Promise<unknown>;
  async evaluate(
    fn: string | ((...args: never[]) => unknown),
    ...args: unknown[]
  ): Promise<unknown> {
    if (typeof fn === "string") {
      const result = await this.session.send("Runtime.evaluate", {
        expression: fn,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    return await callFunction(this.session, fn.toString(), args);
  }

  async dispose(): Promise<void> {
    try {
      if (!this.session.detached) await this.session.detach();
    } finally {
      if (!this.root.detached) await this.root.detach();
    }
  }
}
