// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Browser, Target } from "puppeteer-core";
import { expect, it, vi } from "vitest";
import {
  diagnosticMessage,
  observeConnectionWorker,
} from "./connection-diagnostics.ts";

it("失敗理由からURL・メール・スタックを省く", () => {
  expect(
    diagnosticMessage(
      "Error: Cannot access https://example.com/private?token=secret user@example.com\n    at hidden",
    ),
  ).toBe("Error: Cannot access [URL] [email]");
});

it("対象workerのopen失敗と破棄を記録し、他のconsoleを収集せず接続を解放する", async () => {
  const worker = new EventEmitter();
  const session = Object.assign(worker, {
    detached: false,
    send: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
  });
  const target = {
    type: () => "service_worker",
    url: () => "chrome-extension://sift/background.js",
    createCDPSession: vi.fn().mockResolvedValue(session),
  } as unknown as Target;
  const page = {
    type: () => "page",
    url: () => "https://example.com",
    createCDPSession: vi.fn(),
  };
  const browserEvents = new EventEmitter();
  const browser = Object.assign(browserEvents, {
    targets: () => [target, page],
  }) as unknown as Browser;
  const record = vi.fn();
  const dispose = await observeConnectionWorker(browser, "sift", record);
  worker.emit("Runtime.consoleAPICalled", {
    type: "error",
    args: [{ value: "投稿の内容" }],
  });
  expect(record).not.toHaveBeenCalled();
  worker.emit("Runtime.consoleAPICalled", {
    type: "error",
    args: [
      { value: "sift のサイドパネルを開けなかった。" },
      { description: "Error: Side panel is not enabled\n    at worker" },
    ],
  });
  browserEvents.emit("targetdestroyed", target);
  expect(record.mock.calls).toEqual([
    ["worker-open-error", { message: "Error: Side panel is not enabled" }],
    ["worker-destroyed", {}],
  ]);
  expect(page.createCDPSession).not.toHaveBeenCalled();
  await dispose();
  expect(session.detach).toHaveBeenCalledOnce();
  expect(browserEvents.listenerCount("targetcreated")).toBe(0);
  expect(browserEvents.listenerCount("targetdestroyed")).toBe(0);
});
