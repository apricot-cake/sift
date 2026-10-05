import fs from "node:fs";
import path from "node:path";
import { type Browser, type BrowserContext, expect } from "@playwright/test";
import { artifactHash } from "./compatibility/artifact.ts";

/** 実際に再起動したworkerの値を確認し、ファイルの読出しだけで成功にしない。 */
export async function reloadCandidateWorker(
  context: BrowserContext,
  extensionId: string,
  buildId: string,
  timeout = 10000,
) {
  const url = `chrome-extension://${extensionId}/background.js`;
  const previous =
    context.serviceWorkers().find((worker) => worker.url() === url) ??
    (await context.waitForEvent("serviceworker", {
      predicate: (worker) => worker.url() === url,
      timeout,
    }));
  try {
    await previous.evaluate("chrome.runtime.reload()");
  } catch (error) {
    // reloadで元の実行コンテキストが失われる場合だけ、新workerの照合へ進む。
    if (
      !(error instanceof Error) ||
      !/Execution context was destroyed|Service worker restarted|Target closed|Target page, context or browser has been closed/.test(
        error.message,
      )
    )
      throw error;
  }
  await expect
    .poll(
      async () => {
        const worker = context
          .serviceWorkers()
          .find((worker) => worker !== previous && worker.url() === url);
        if (!worker) return null;
        return await worker
          .evaluate(
            () =>
              (
                globalThis as typeof globalThis & {
                  __SIFT_RUNNING_BUILD_ID__?: string;
                }
              ).__SIFT_RUNNING_BUILD_ID__ ?? null,
          )
          .catch(() => null);
      },
      {
        timeout,
        intervals: [50, 100, 250],
        message: "再読み込みしたworkerが候補ビルドと一致しません",
      },
    )
    .toBe(buildId);
}

export async function loadDevCandidate(browser: Browser) {
  const root = path.resolve(import.meta.dirname, "..");
  const candidate = JSON.parse(
    fs.readFileSync(path.join(root, ".output", "candidate.json"), "utf8"),
  );
  const expected = path.join(root, ".output", "candidate", "chrome-mv3");
  if (
    candidate.output !== expected ||
    artifactHash(expected) !== candidate.sha256
  )
    throw new Error("検証用成果物が作成時と一致しません");
  const client = await browser.newBrowserCDPSession();
  try {
    const loaded = await client.send("Extensions.loadUnpacked", {
      path: expected,
    });
    const context = browser.contexts()[0];
    if (!context) throw new Error("開発用Chromeのコンテキストがありません");
    await reloadCandidateWorker(context, loaded.id, candidate.buildId);
    if (artifactHash(expected) !== candidate.sha256)
      throw new Error("読み込み中に検証用成果物が変更されました");
    return { ...candidate, loaded };
  } finally {
    await client.detach();
  }
}
