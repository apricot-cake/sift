// @vitest-environment node
import { type Browser, ProtocolError } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";
import { type ExtensionWorker, getExtensionWorker } from "./browser-worker.ts";
import { installCandidateWorker } from "./dev-browser-candidate.ts";

vi.mock("./browser-worker.ts", () => ({ getExtensionWorker: vi.fn() }));
function fixture(targetInfos: unknown[] = []) {
  const root = {
    send: vi.fn().mockResolvedValue({ targetInfos }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const installExtension = vi.fn().mockResolvedValue("sift");
  const browser = {
    target: () => ({ createCDPSession: async () => root }),
    installExtension,
  } as unknown as Browser;
  return { browser, root, installExtension };
}
function worker(buildId: unknown, targetId = "new") {
  return {
    targetId,
    evaluate: vi.fn().mockResolvedValue(buildId),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExtensionWorker;
}
afterEach(() => vi.resetAllMocks());

it.each([
  ["初回読み込み", [], undefined],
  [
    "既存拡張の更新",
    [
      {
        targetId: "wrong-type",
        type: "page",
        url: "chrome-extension://sift/background.js",
      },
      {
        targetId: "other",
        type: "service_worker",
        url: "chrome-extension://other/background.js",
      },
      {
        targetId: "old",
        type: "service_worker",
        url: "chrome-extension://sift/background.js",
      },
    ],
    "old",
  ],
])(
  "%s: 公開install APIが作ったworkerの実ビルド値を照合し、追加reloadを行わない",
  async (_label, targets, previousId) => {
    const { browser, root, installExtension } = fixture(targets);
    const next = worker("candidate");
    vi.mocked(getExtensionWorker).mockResolvedValueOnce(next);
    const verified = await installCandidateWorker(
      browser,
      "candidate-output",
      "candidate",
    );
    expect(verified).toEqual({ id: "sift", worker: next });
    expect(root.send).toHaveBeenCalledExactlyOnceWith("Target.getTargets");
    expect(root.detach).toHaveBeenCalledOnce();
    expect(installExtension).toHaveBeenCalledExactlyOnceWith(
      "candidate-output",
    );
    const snapshotOrder = root.send.mock.invocationCallOrder[0];
    const releaseOrder = root.detach.mock.invocationCallOrder[0];
    const installOrder = installExtension.mock.invocationCallOrder[0];
    if (
      snapshotOrder === undefined ||
      releaseOrder === undefined ||
      installOrder === undefined
    )
      throw Error("mock call order missing");
    expect(snapshotOrder).toBeLessThan(installOrder);
    expect(releaseOrder).toBeLessThan(installOrder);
    expect(getExtensionWorker).toHaveBeenCalledExactlyOnceWith(
      browser,
      "sift",
      10000,
      previousId,
    );
    expect(next.evaluate).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(next.evaluate)
        .mock.calls.every(([evaluation]) => typeof evaluation === "function"),
    ).toBe(true);
    expect(next.dispose).not.toHaveBeenCalled();
    await verified.worker.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
  },
);

it.each(["stale"])(
  "新targetの実workerも候補と一致しなければ両workerを解放する: %s",
  async (buildId) => {
    const { browser } = fixture();
    const previous = worker("old-build", "installed");
    const next = worker(buildId);
    vi.mocked(getExtensionWorker)
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(next);
    await expect(
      installCandidateWorker(browser, "output", "candidate"),
    ).rejects.toThrow("一致しません");
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(previous.dispose).toHaveBeenCalledOnce();
  },
);

it("初期化前のnullではreloadせず、同じworkerのビルドID設置を待つ", async () => {
  const { browser } = fixture();
  const next = worker("candidate");
  vi.mocked(next.evaluate).mockResolvedValueOnce(null);
  vi.mocked(getExtensionWorker).mockResolvedValueOnce(next);
  expect(await installCandidateWorker(browser, "output", "candidate")).toEqual({
    id: "sift",
    worker: next,
  });
  expect(next.evaluate).toHaveBeenCalledTimes(2);
  expect(getExtensionWorker).toHaveBeenCalledOnce();
  expect(next.evaluate).not.toHaveBeenCalledWith("chrome.runtime.reload()");
});

it("reload後のworkerも初期化を待ってから照合する", async () => {
  const { browser } = fixture();
  const previous = worker("old-build", "installed");
  const next = worker("candidate");
  vi.mocked(next.evaluate).mockResolvedValueOnce(null);
  vi.mocked(getExtensionWorker)
    .mockResolvedValueOnce(previous)
    .mockResolvedValueOnce(next);
  expect(await installCandidateWorker(browser, "output", "candidate")).toEqual({
    id: "sift",
    worker: next,
  });
  expect(next.evaluate).toHaveBeenCalledTimes(2);
  expect(previous.evaluate).toHaveBeenCalledWith("chrome.runtime.reload()");
});

it("初期化されないworkerは時間上限で失敗し、reloadへ進まない", async () => {
  const { browser } = fixture();
  const next = worker(null);
  vi.mocked(getExtensionWorker).mockResolvedValueOnce(next);
  await expect(
    installCandidateWorker(browser, "output", "candidate", 20),
  ).rejects.toThrow("初期化を確認できません。expected=candidate, actual=null");
  expect(next.evaluate).not.toHaveBeenCalledWith("chrome.runtime.reload()");
  expect(next.dispose).toHaveBeenCalledOnce();
});

it("読み込み前のsnapshot取得に失敗したらrootを解放しinstallしない", async () => {
  const { browser, root, installExtension } = fixture();
  const error = Error("snapshot failed");
  root.send.mockRejectedValueOnce(error);
  await expect(
    installCandidateWorker(browser, "output", "candidate"),
  ).rejects.toBe(error);
  expect(root.detach).toHaveBeenCalledOnce();
  expect(installExtension).not.toHaveBeenCalled();
  expect(getExtensionWorker).not.toHaveBeenCalled();
});

it("install失敗時はworker取得へ進まず既にsnapshot sessionを解放している", async () => {
  const { browser, root, installExtension } = fixture();
  const error = Error("Extensions.loadUnpacked failed");
  installExtension.mockRejectedValueOnce(error);
  await expect(
    installCandidateWorker(browser, "output", "candidate"),
  ).rejects.toBe(error);
  expect(root.detach).toHaveBeenCalledOnce();
  expect(getExtensionWorker).not.toHaveBeenCalled();
});

it("読み込み後workerを取得できなければ成功にしない", async () => {
  const { browser, root } = fixture();
  const error = Error("worker timeout");
  vi.mocked(getExtensionWorker).mockRejectedValueOnce(error);
  await expect(
    installCandidateWorker(browser, "output", "candidate"),
  ).rejects.toBe(error);
  expect(root.detach).toHaveBeenCalledOnce();
});

it("実ビルド値の取得失敗時はworkerを解放し元のエラーを返す", async () => {
  const { browser } = fixture();
  const next = worker("candidate"),
    error = Error("Runtime.evaluate timed out");
  vi.mocked(next.evaluate).mockRejectedValueOnce(error);
  vi.mocked(next.dispose).mockRejectedValueOnce(Error("detach failed"));
  vi.mocked(getExtensionWorker).mockResolvedValueOnce(next);
  await expect(
    installCandidateWorker(browser, "output", "candidate"),
  ).rejects.toBe(error);
  expect(next.dispose).toHaveBeenCalledOnce();
});

it.each(["Target closed", "Session closed"])(
  "self-terminating reload の応答が pending のままでも新workerを取得し、所有session解放後の %s を許容する",
  async (message) => {
    const { browser } = fixture();
    const previous = worker("old-build", "installed");
    const next = worker("candidate", "reloaded");
    let rejectReload: ((error: Error) => void) | undefined;
    let disposed = false;
    vi.mocked(previous.evaluate)
      .mockResolvedValueOnce("old-build")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectReload = reject;
          }),
      );
    vi.mocked(previous.dispose).mockImplementation(async () => {
      disposed = true;
      if (!rejectReload) throw Error("reload was not issued before disposal");
      rejectReload(new ProtocolError(message));
    });
    vi.mocked(getExtensionWorker)
      .mockResolvedValueOnce(previous)
      .mockImplementationOnce(async () => {
        expect(disposed).toBe(false);
        expect(rejectReload).toBeDefined();
        return next;
      });
    const verified = await installCandidateWorker(
      browser,
      "output",
      "candidate",
    );
    expect(verified).toEqual({ id: "sift", worker: next });
    expect(previous.evaluate).toHaveBeenLastCalledWith(
      "chrome.runtime.reload()",
    );
    expect(getExtensionWorker).toHaveBeenLastCalledWith(
      browser,
      "sift",
      10000,
      "installed",
    );
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
    await next.dispose();
  },
);

it.each([
  new ProtocolError("Access denied"),
  new ProtocolError("Runtime.evaluate timed out"),
  new Error("Target closed"),
])("reload の消滅通知以外を隠さず新workerも解放する: %s", async (error) => {
  const { browser } = fixture();
  const previous = worker("old-build", "installed");
  const next = worker("candidate", "reloaded");
  vi.mocked(previous.evaluate)
    .mockResolvedValueOnce("old-build")
    .mockRejectedValueOnce(error);
  vi.mocked(getExtensionWorker)
    .mockResolvedValueOnce(previous)
    .mockResolvedValueOnce(next);
  await expect(
    installCandidateWorker(browser, "output", "candidate"),
  ).rejects.toBe(error);
  expect(previous.dispose).toHaveBeenCalledOnce();
  expect(next.dispose).toHaveBeenCalledOnce();
});

it("条件付きreload後に新targetを取得できなければ成功にしない", async () => {
  const { browser } = fixture();
  const previous = worker("old-build", "installed");
  const error = Error("new worker timeout");
  vi.mocked(getExtensionWorker)
    .mockResolvedValueOnce(previous)
    .mockRejectedValueOnce(error);
  await expect(
    installCandidateWorker(browser, "output", "candidate"),
  ).rejects.toBe(error);
  expect(previous.dispose).toHaveBeenCalled();
});
