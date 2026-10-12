import fs from "node:fs";
import path from "node:path";
import { type Browser, ProtocolError } from "puppeteer-core";
import { getExtensionWorker } from "./browser-worker.ts";
import { artifactHash } from "./compatibility/artifact.ts";
import type { VerifiedCandidate } from "./compatibility/verification.ts";

/** 実行中のビルドを照合し、Chrome に残る旧ビルドだけを再読み込みする。 */
export async function installCandidateWorker(
  browser: Browser,
  output: string,
  buildId: string,
  timeout = 10000,
) {
  const root = await browser.target().createCDPSession();
  const { targetInfos: previousTargets } = await root
    .send("Target.getTargets")
    .finally(() => root.detach());
  const extensionId = await browser.installExtension(output);
  const previousTargetId = previousTargets.find(
    (target) =>
      target.type === "service_worker" &&
      target.url === `chrome-extension://${extensionId}/background.js`,
  )?.targetId;
  let next = await getExtensionWorker(
    browser,
    extensionId,
    timeout,
    previousTargetId,
  );
  try {
    const runningBuild = () =>
      next.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __SIFT_RUNNING_BUILD_ID__?: string;
            }
          ).__SIFT_RUNNING_BUILD_ID__ ?? null,
      );
    let actual = await runningBuild();
    if (actual !== buildId) {
      const previous = next;
      let reloadError: unknown;
      let workerError: unknown;
      // reload は worker 自身を終了するため、その応答より新 worker を待つ。
      const reload = previous
        .evaluate("chrome.runtime.reload()")
        .catch((error) => {
          reloadError = error;
        });
      try {
        next = await getExtensionWorker(
          browser,
          extensionId,
          timeout,
          previous.targetId,
        );
      } catch (error) {
        workerError = error;
      } finally {
        await previous.dispose();
        await reload;
      }
      if (
        reloadError &&
        !(
          reloadError instanceof ProtocolError &&
          /Target closed|Session closed/.test(reloadError.message)
        )
      )
        throw reloadError;
      if (workerError) throw workerError;
      actual = await runningBuild();
    }
    if (actual !== buildId)
      throw new Error("読み込んだ worker が候補ビルドと一致しません。");
    return { id: extensionId, worker: next };
  } catch (error) {
    await next.dispose().catch(() => {});
    throw error;
  }
}

export async function loadDevCandidate(browser: Browser) {
  const root = path.resolve(import.meta.dirname, "..");
  const candidate = JSON.parse(
    fs.readFileSync(path.join(root, ".output", "candidate.json"), "utf8"),
  ) as VerifiedCandidate;
  const expected = path.join(root, ".output", "candidate", "chrome-mv3");
  if (
    candidate.output !== expected ||
    artifactHash(expected) !== candidate.sha256
  )
    throw new Error("検証用成果物が作成時と一致しません");
  const { id, worker } = await installCandidateWorker(
    browser,
    expected,
    candidate.buildId,
  );
  if (artifactHash(expected) !== candidate.sha256) {
    await worker.dispose();
    throw new Error("読み込み中に検証用成果物が変更されました");
  }
  return { ...candidate, loaded: { id }, worker };
}
