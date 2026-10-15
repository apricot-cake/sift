import {
  type Browser,
  type CDPSession,
  type Protocol,
  ProtocolError,
} from "puppeteer-core";
import { callFunction } from "./cdp-call.ts";

export const workerCommandTimeout = 5000;

/** 再起動した service worker を公開 CDP API で取得する。 */
export async function getExtensionWorker(
  browser: Browser,
  extensionId: string,
  timeout = 10000,
  previousTargetId?: string,
): Promise<ExtensionWorker> {
  const root = await browser.target().createCDPSession();
  let session: CDPSession | undefined;
  let removeContextListeners: (() => void) | undefined;
  const currentTarget = async (id: string) => {
    const { targetInfos } = await root.send("Target.getTargets", undefined, {
      timeout: workerCommandTimeout,
    });
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
          const { targetInfo } = await probe.send(
            "Target.getTargetInfo",
            undefined,
            { timeout: workerCommandTimeout },
          );
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
    const { targetInfo } = await session.send(
      "Target.getTargetInfo",
      undefined,
      { timeout: workerCommandTimeout },
    );
    if (!(await currentTarget(targetInfo.targetId)))
      throw new Error("選択した service worker は既に終了しています。");
    // enable は既存contextを通知する。既定の評価先には依存しない。
    const contexts = new Map<
      number,
      Protocol.Runtime.ExecutionContextDescription
    >();
    const created = ({
      context,
    }: Protocol.Runtime.ExecutionContextCreatedEvent) =>
      contexts.set(context.id, context);
    const destroyed = ({
      executionContextId,
    }: Protocol.Runtime.ExecutionContextDestroyedEvent) =>
      contexts.delete(executionContextId);
    const cleared = () => contexts.clear();
    session.on("Runtime.executionContextCreated", created);
    session.on("Runtime.executionContextDestroyed", destroyed);
    session.on("Runtime.executionContextsCleared", cleared);
    const contextSession = session;
    removeContextListeners = () => {
      contextSession.off("Runtime.executionContextCreated", created);
      contextSession.off("Runtime.executionContextDestroyed", destroyed);
      contextSession.off("Runtime.executionContextsCleared", cleared);
    };
    await session.send("Runtime.enable", undefined, {
      timeout: workerCommandTimeout,
    });
    const matching = [...contexts.values()].filter(
      (context) =>
        context.origin.startsWith(`chrome-extension://${extensionId}/`) &&
        context.name === "" &&
        context.auxData?.isDefault !== false &&
        context.uniqueId,
    );
    if (matching.length !== 1)
      throw new Error(
        `拡張機能workerの実行contextを一意に特定できません（${matching.length}件）`,
      );
    const context = matching[0];
    if (!context) throw new Error("拡張機能workerの実行contextがありません");
    return new ExtensionWorker(
      targetInfo.targetId,
      session,
      root,
      context.uniqueId,
      () => contexts.get(context.id)?.uniqueId === context.uniqueId,
      removeContextListeners,
    );
  } catch (error) {
    removeContextListeners?.();
    if (session && !session.detached) await session.detach().catch(() => {});
    await root.detach().catch(() => {});
    throw error;
  }
}

export class ExtensionWorker {
  readonly targetId: string;
  private session: CDPSession;
  private root: CDPSession;
  private uniqueContextId: string;
  private contextAvailable: () => boolean;
  private removeContextListeners: () => void;

  constructor(
    targetId: string,
    session: CDPSession,
    root: CDPSession,
    uniqueContextId: string,
    contextAvailable: () => boolean,
    removeContextListeners: () => void,
  ) {
    this.targetId = targetId;
    this.session = session;
    this.root = root;
    this.uniqueContextId = uniqueContextId;
    this.contextAvailable = contextAvailable;
    this.removeContextListeners = removeContextListeners;
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
    if (!this.contextAvailable())
      throw new Error("拡張機能workerの実行contextが失効しました");
    if (typeof fn === "string") {
      const result = await this.session.send(
        "Runtime.evaluate",
        {
          expression: fn,
          awaitPromise: true,
          returnByValue: true,
          uniqueContextId: this.uniqueContextId,
        },
        { timeout: workerCommandTimeout },
      );
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    return await callFunction(
      this.session,
      fn.toString(),
      args,
      workerCommandTimeout,
      this.uniqueContextId,
    );
  }

  async dispose(): Promise<void> {
    this.removeContextListeners();
    try {
      if (!this.session.detached) await this.session.detach();
    } finally {
      if (!this.root.detached) await this.root.detach();
    }
  }
}
