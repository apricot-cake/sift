import type {
  BrowserContext,
  CDPSession,
  Page,
  Protocol,
} from "puppeteer-core";
import { workerCommandTimeout } from "./browser-worker.ts";
import { callFunction } from "./cdp-call.ts";

/** workerの寿命に依存せず、同一拡張機能の公開APIを静的rendererから観測する。 */
export async function createExtensionApiContext(
  browserContext: BrowserContext,
  extensionId: string,
): Promise<ExtensionApiContext> {
  const page = await browserContext.newPage();
  let session: CDPSession | undefined;
  let removeListeners: (() => void) | undefined;
  try {
    const origin = `chrome-extension://${extensionId}`;
    await page.goto(`${origin}/manifest.json`, {
      waitUntil: "domcontentloaded",
      timeout: workerCommandTimeout,
    });
    session = await page.createCDPSession();
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
    const ownedSession = session;
    removeListeners = () => {
      ownedSession.off("Runtime.executionContextCreated", created);
      ownedSession.off("Runtime.executionContextDestroyed", destroyed);
      ownedSession.off("Runtime.executionContextsCleared", cleared);
    };
    await session.send("Runtime.enable", undefined, {
      timeout: workerCommandTimeout,
    });
    const matching = [...contexts.values()].filter(
      (context) =>
        (context.origin === origin ||
          context.origin.startsWith(`${origin}/`)) &&
        context.name === "" &&
        context.auxData?.isDefault !== false &&
        context.uniqueId,
    );
    if (matching.length !== 1)
      throw new Error(
        `拡張機能APIの実行contextを一意に特定できません（${matching.length}件）`,
      );
    const context = matching[0];
    if (!context) throw new Error("拡張機能APIの実行contextがありません");
    const contextAvailable = () =>
      contexts.get(context.id)?.uniqueId === context.uniqueId;
    // document/context の生成直後は、拡張APIの名前空間が未初期化の場合がある。
    // 副作用のある評価を再実行せず、同じcontextの初期化だけを期限内で待つ。
    const deadline = Date.now() + workerCommandTimeout;
    while (true) {
      if (page.isClosed() || !contextAvailable())
        throw new Error("拡張機能APIの実行contextが失効しました");
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error("拡張機能APIの初期化を5秒以内に確認できません");
      const result = await session.send(
        "Runtime.evaluate",
        {
          expression: `({
            extensionId: globalThis.chrome?.runtime?.id ?? null,
            ready: typeof globalThis.chrome?.storage?.sync?.get === "function" &&
              typeof globalThis.chrome?.tabs?.query === "function" &&
              typeof globalThis.chrome?.sidePanel?.getOptions === "function"
          })`,
          returnByValue: true,
          uniqueContextId: context.uniqueId,
        },
        { timeout: remaining },
      );
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      if (page.isClosed() || !contextAvailable())
        throw new Error("拡張機能APIの実行contextが失効しました");
      const state = result.result.value as {
        extensionId: string | null;
        ready: boolean;
      };
      if (state.extensionId !== null && state.extensionId !== extensionId)
        throw new Error("拡張機能APIの実行元IDが一致しません");
      if (state.extensionId === extensionId && state.ready === true) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))),
      );
    }
    return new ExtensionApiContext(
      page,
      session,
      context.uniqueId,
      contextAvailable,
      removeListeners,
    );
  } catch (error) {
    removeListeners?.();
    try {
      if (session && !session.detached) await session.detach().catch(() => {});
    } finally {
      await page.close().catch(() => {});
    }
    throw error;
  }
}

export class ExtensionApiContext {
  private page: Page;
  private session: CDPSession;
  private uniqueContextId: string;
  private contextAvailable: () => boolean;
  private removeListeners: () => void;
  constructor(
    page: Page,
    session: CDPSession,
    uniqueContextId: string,
    contextAvailable: () => boolean,
    removeListeners: () => void,
  ) {
    this.page = page;
    this.session = session;
    this.uniqueContextId = uniqueContextId;
    this.contextAvailable = contextAvailable;
    this.removeListeners = removeListeners;
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
    if (this.page.isClosed() || !this.contextAvailable())
      throw new Error("拡張機能APIの実行contextが失効しました");
    if (typeof fn !== "string")
      return await callFunction(
        this.session,
        fn.toString(),
        args,
        workerCommandTimeout,
        this.uniqueContextId,
      );
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

  async dispose(): Promise<void> {
    this.removeListeners();
    try {
      if (!this.session.detached) await this.session.detach();
    } finally {
      if (!this.page.isClosed()) await this.page.close();
    }
  }
}
