import type { Browser, CDPSession, Protocol, Target } from "puppeteer-core";
import { workerCommandTimeout } from "./browser-worker.ts";

export function diagnosticMessage(value: unknown): string {
  const firstLine = String(value).split("\n", 1)[0] ?? "";
  return firstLine
    .replace(/(?:https?|chrome-extension):\/\/\S+/g, "[URL]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 400);
}

/** 拡張機能workerのAPI失敗だけを取得し、ページや投稿のconsoleは収集しない。 */
export async function observeConnectionWorker(
  browser: Browser,
  extensionId: string,
  record: (kind: string, data: Record<string, unknown>) => void,
): Promise<() => Promise<void>> {
  const sessions = new Map<Target, CDPSession>();
  const observed = new WeakSet<Target>();
  const pending = new Set<Promise<void>>();
  let disposed = false;
  const matches = (target: Target) =>
    target.type() === "service_worker" &&
    target.url() === `chrome-extension://${extensionId}/background.js`;
  const observe = async (target: Target) => {
    if (!matches(target) || observed.has(target)) return;
    observed.add(target);
    let session: CDPSession | undefined;
    try {
      session = await target.createCDPSession();
      if (disposed) {
        await session.detach();
        return;
      }
      sessions.set(target, session);
      session.on("Runtime.consoleAPICalled", (event) => {
        if (
          event.type !== "error" ||
          event.args[0]?.value !== "sift のサイドパネルを開けなかった。"
        )
          return;
        const error = event.args[1];
        record("worker-open-error", {
          message: diagnosticMessage(error?.description ?? error?.value),
        });
      });
      session.on(
        "Runtime.exceptionThrown",
        ({ exceptionDetails }: Protocol.Runtime.ExceptionThrownEvent) => {
          record("worker-exception", {
            message: diagnosticMessage(
              exceptionDetails.exception?.description ?? exceptionDetails.text,
            ),
          });
        },
      );
      await session.send("Runtime.enable", undefined, {
        timeout: workerCommandTimeout,
      });
    } catch (error) {
      record("worker-observer-error", { message: diagnosticMessage(error) });
      if (session && !session.detached) await session.detach().catch(() => {});
    }
  };
  const created = (target: Target) => {
    if (!matches(target) || observed.has(target)) return;
    record("worker-created", {});
    const task = observe(target);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  const destroyed = (target: Target) => {
    if (matches(target)) record("worker-destroyed", {});
  };
  browser.on("targetcreated", created);
  browser.on("targetdestroyed", destroyed);
  await Promise.all(browser.targets().filter(matches).map(observe));
  return async () => {
    disposed = true;
    browser.off("targetcreated", created);
    browser.off("targetdestroyed", destroyed);
    await Promise.all(pending);
    for (const session of sessions.values())
      if (!session.detached) await session.detach().catch(() => {});
  };
}
