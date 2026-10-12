// @vitest-environment node
import { type Browser, ProtocolError, type Target } from "puppeteer-core";
import { expect, it, vi } from "vitest";
import { getExtensionWorker } from "./browser-worker.ts";

const url = "chrome-extension://sift/background.js";
function session(targetId: string) {
  return {
    detached: false,
    send: vi.fn(async (method: string) => {
      if (method === "Target.getTargetInfo")
        return { targetInfo: { targetId, type: "service_worker", url } };
      return {};
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
}
function fixture(ids = ["new"], currentIds = ["new"]) {
  const current = currentIds.map((targetId) => ({
    targetId,
    type: "service_worker",
    url,
  }));
  const root = {
    detached: false,
    send: vi.fn().mockResolvedValue({ targetInfos: current }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const sessions: ReturnType<typeof session>[] = [];
  const targets = ids.map((id) => ({
    type: () => "service_worker",
    url: () => url,
    worker: vi.fn(() => {
      throw Error("cached worker client must not be used");
    }),
    createCDPSession: vi.fn(async () => {
      const created = session(id);
      sessions.push(created);
      return created;
    }),
  }));
  const waitForTarget = vi.fn(
    async (predicate: (target: Target) => Promise<boolean>) => {
      for (const target of targets)
        if (await predicate(target as unknown as Target)) return target;
      throw Error("target discovery timeout");
    },
  );
  const browser = {
    target: () => ({ createCDPSession: async () => root }),
    waitForTarget,
  } as unknown as Browser;
  return { browser, root, targets, sessions, waitForTarget };
}

it("SDKに残る旧targetをrootの現存集合で除外し、probeと所有sessionを別々に解放する", async () => {
  const { browser, root, targets, sessions } = fixture(
    ["stale", "old", "new"],
    ["old", "new"],
  );
  const worker = await getExtensionWorker(browser, "sift", 100, "old");
  expect(worker.targetId).toBe("new");
  expect(targets.every((target) => target.worker.mock.calls.length === 0)).toBe(
    true,
  );
  const owned = sessions.at(-1);
  expect(owned).toBeDefined();
  for (const probe of sessions.slice(0, -1))
    expect(probe.detach).toHaveBeenCalledOnce();
  expect(owned?.send).toHaveBeenCalledWith("Runtime.enable");
  expect(owned?.detach).not.toHaveBeenCalled();
  expect(root.detach).not.toHaveBeenCalled();
  await worker.dispose();
  expect(owned?.detach).toHaveBeenCalledOnce();
  expect(root.detach).toHaveBeenCalledOnce();
});

it.each([
  ["SDKtargetだけ存在", ["new"], []],
  ["旧IDしか存在しない", ["old"], ["old"]],
  ["SDKtargetなし", [], ["new"]],
])(
  "%s を接続成功にせずrootと作成済みprobeを解放する",
  async (_label, ids, current) => {
    const { browser, root, sessions } = fixture(ids, current);
    await expect(
      getExtensionWorker(browser, "sift", 100, "old"),
    ).rejects.toThrow("target discovery timeout");
    for (const probe of sessions) expect(probe.detach).toHaveBeenCalledOnce();
    expect(root.detach).toHaveBeenCalledOnce();
  },
);

it.each(["No target with given id found", "Target closed", "Session closed"])(
  "消滅済み候補のProtocolError %s だけを除外する",
  async (message) => {
    const { browser, root, targets, sessions } = fixture(["gone", "new"]);
    const gone = targets[0];
    if (!gone) throw Error("mock target missing");
    gone.createCDPSession.mockRejectedValueOnce(new ProtocolError(message));
    const worker = await getExtensionWorker(browser, "sift");
    expect(worker.targetId).toBe("new");
    await worker.dispose();
    for (const created of sessions)
      expect(created.detach).toHaveBeenCalledOnce();
    expect(root.detach).toHaveBeenCalledOnce();
  },
);

it.each([
  new Error("No target with given id found"),
  new ProtocolError("Runtime.evaluate timed out"),
  new ProtocolError("Access denied"),
])("消滅以外の失敗を隠さずrootを解放する: %s", async (error) => {
  const { browser, root, targets } = fixture();
  const target = targets[0];
  if (!target) throw Error("mock target missing");
  target.createCDPSession.mockRejectedValueOnce(error);
  await expect(getExtensionWorker(browser, "sift")).rejects.toBe(error);
  expect(root.detach).toHaveBeenCalledOnce();
});

it("選択後に現存集合から消えたworkerを返さずowned sessionとrootを解放する", async () => {
  const { browser, root, sessions } = fixture();
  root.send
    .mockResolvedValueOnce({
      targetInfos: [{ targetId: "new", type: "service_worker", url }],
    })
    .mockResolvedValue({ targetInfos: [] });
  await expect(getExtensionWorker(browser, "sift")).rejects.toThrow();
  for (const created of sessions) expect(created.detach).toHaveBeenCalledOnce();
  expect(root.detach).toHaveBeenCalledOnce();
});

it("owned Runtimeの初期化失敗を伝播し、probe・owned session・rootを解放する", async () => {
  const { browser, root, targets } = fixture();
  const probe = session("new"),
    owned = session("new");
  const original = owned.send.getMockImplementation();
  if (!original) throw Error("mock implementation missing");
  const error = new ProtocolError("Runtime.enable timed out");
  owned.send.mockImplementation(async (method) => {
    if (method === "Runtime.enable") throw error;
    return original(method);
  });
  const target = targets[0];
  if (!target) throw Error("mock target missing");
  target.createCDPSession
    .mockResolvedValueOnce(probe)
    .mockResolvedValueOnce(owned);
  await expect(getExtensionWorker(browser, "sift")).rejects.toBe(error);
  expect(probe.detach).toHaveBeenCalledOnce();
  expect(owned.detach).toHaveBeenCalledOnce();
  expect(root.detach).toHaveBeenCalledOnce();
});

it("owned workerの解放失敗でもrootを解放する", async () => {
  const { browser, root, sessions } = fixture();
  const worker = await getExtensionWorker(browser, "sift");
  const owned = sessions.at(-1);
  if (!owned) throw Error("owned session missing");
  owned.detach.mockRejectedValueOnce(Error("worker detach failed"));
  await expect(worker.dispose()).rejects.toThrow("worker detach failed");
  expect(root.detach).toHaveBeenCalledOnce();
});
