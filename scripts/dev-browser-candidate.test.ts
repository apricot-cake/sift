import type { BrowserContext, Worker } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { reloadCandidateWorker } from "./dev-browser-candidate.ts";

function worker(value: unknown, reload?: () => void) {
  return {
    url: () => "chrome-extension://sift/background.js",
    evaluate: vi.fn(async (expression: unknown) => {
      if (typeof expression === "string") {
        reload?.();
        return;
      }
      return value;
    }),
  } as unknown as Worker;
}
it("reload後の新workerの実ビルド値で成功を判定する", async () => {
  const next = worker("new");
  let workers: Worker[] = [];
  const old = worker("old", () => {
    workers = [next];
  });
  workers = [old];
  const context = {
    serviceWorkers: () => workers,
  } as unknown as BrowserContext;
  await reloadCandidateWorker(context, "sift", "new", 1000);
  expect(old.evaluate).toHaveBeenCalledWith("chrome.runtime.reload()");
});
it("開始イベントの前にworkerが未生成でも取得を待つ", async () => {
  const next = worker("new");
  let workers: Worker[] = [];
  const old = worker("old", () => {
    workers = [next];
  });
  const context = {
    serviceWorkers: () => workers,
    waitForEvent: vi.fn(async () => old),
  } as unknown as BrowserContext;
  await reloadCandidateWorker(context, "sift", "new", 1000);
  expect(context.waitForEvent).toHaveBeenCalledWith(
    "serviceworker",
    expect.objectContaining({ timeout: 1000 }),
  );
});
it.each(["old", undefined])(
  "新workerの値が候補と違う場合は失敗する: %s",
  async (value) => {
    const next = worker(value);
    let workers: Worker[] = [];
    const old = worker("old", () => {
      workers = [next];
    });
    workers = [old];
    const context = {
      serviceWorkers: () => workers,
    } as unknown as BrowserContext;
    await expect(
      reloadCandidateWorker(context, "sift", "new", 100),
    ).rejects.toThrow();
  },
);
it("reloadが実際に失敗した場合は照合へ進まない", async () => {
  const old = worker("old");
  vi.mocked(old.evaluate).mockRejectedValueOnce(Error("Not allowed"));
  const context = { serviceWorkers: () => [old] } as unknown as BrowserContext;
  await expect(
    reloadCandidateWorker(context, "sift", "new", 100),
  ).rejects.toThrow("Not allowed");
});
it("reloadによるworker再起動通知の後にも実ビルドを照合する", async () => {
  const next = worker("new");
  let workers: Worker[] = [];
  const old = worker("old");
  vi.mocked(old.evaluate).mockImplementationOnce(async () => {
    workers = [next];
    throw Error("Service worker restarted");
  });
  workers = [old];
  const context = {
    serviceWorkers: () => workers,
  } as unknown as BrowserContext;
  await reloadCandidateWorker(context, "sift", "new", 1000);
});
it("元workerだけが残る場合は旧コードを成功にしない", async () => {
  const old = worker("new");
  const context = { serviceWorkers: () => [old] } as unknown as BrowserContext;
  await expect(
    reloadCandidateWorker(context, "sift", "new", 100),
  ).rejects.toThrow();
});
