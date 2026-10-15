import type { Page } from "puppeteer-core";
import { expect, it, type RunnerTask, vi } from "vitest";
import {
  acquireCasePage,
  completeInitialLoad,
  type LiveSession,
  releaseCasePage,
} from "../e2e/live.ts";

function setup() {
  const page = {
    setCacheEnabled: vi.fn().mockResolvedValue(undefined),
    isClosed: () => false,
    close: vi.fn().mockResolvedValue(undefined),
    once: vi.fn(),
  };
  const session = {
    coldSites: new Set<string>(),
    context: { newPage: vi.fn().mockResolvedValue(page) },
    loadGuard: {
      budget: { assert: vi.fn() },
      watch: vi.fn().mockResolvedValue(undefined),
      assertPage: vi.fn().mockResolvedValue(undefined),
      beginCase: vi.fn(),
    },
  } as unknown as LiveSession;
  const task = { meta: {} } as RunnerTask;
  return { page, session, task };
}

it("文書イベントではキャッシュを戻さず、一覧の準備完了後だけ戻す", async () => {
  const { page, session, task } = setup();
  const { page: acquired } = await acquireCasePage(session, "https://bsky.app");
  expect(page.setCacheEnabled.mock.calls).toEqual([[false]]);
  expect(page.once).not.toHaveBeenCalled();
  expect(session.coldSites.size).toBe(0);
  await completeInitialLoad(session, acquired, task, "ready");
  expect(page.setCacheEnabled.mock.calls).toEqual([[false], [true]]);
  expect(session.coldSites.has("bluesky")).toBe(true);
  expect(task.meta.liveEvidence).toEqual([
    {
      name: "initialization-cache",
      data: {
        site: "bluesky",
        cacheDisabledDuringInitialization: true,
        state: "ready",
        cacheRestored: true,
      },
    },
  ]);
  expect((await acquireCasePage(session, "https://bsky.app")).reused).toBe(
    true,
  );
  await completeInitialLoad(
    session,
    acquired,
    { meta: {} } as RunnerTask,
    "ready",
  );
  expect(page.setCacheEnabled).toHaveBeenCalledTimes(2);
});

it("失敗した初期化を代表確認済みに数えず、次のページで再確認する", async () => {
  const { page, session } = setup();
  await acquireCasePage(session, "https://bsky.app");
  await releaseCasePage(session, "https://bsky.app", false);
  expect(session.coldSites.size).toBe(0);
  await acquireCasePage(session, "https://bsky.app");
  expect(page.setCacheEnabled.mock.calls).toEqual([[false], [false]]);
});

it("別のページの完了通知ではキャッシュ無効を解除しない", async () => {
  const { page, session, task } = setup();
  await acquireCasePage(session, "https://bsky.app");
  await expect(
    completeInitialLoad(session, {} as Page, task, "ready"),
  ).rejects.toThrow("検証対象と一致しません");
  expect(page.setCacheEnabled.mock.calls).toEqual([[false]]);
});
