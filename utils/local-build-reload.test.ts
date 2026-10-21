import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const nativeMessaging = vi.hoisted(() => ({
  sendNativeMessage:
    vi.fn<(host: string, message: unknown) => Promise<unknown>>(),
  sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
  reload: vi.fn(),
  get: vi.fn<(key: string) => Promise<Record<string, unknown>>>(),
  set: vi.fn<(value: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendNativeMessage: nativeMessaging.sendNativeMessage,
      sendMessage: nativeMessaging.sendMessage,
      reload: nativeMessaging.reload,
    },
    storage: {
      local: { get: nativeMessaging.get, set: nativeMessaging.set },
    },
  },
}));

import {
  buildToReload,
  CHECK_LOCAL_BUILD,
  checkPanelBuild,
  RELOAD_ATTEMPT_KEY,
  RELOAD_HOST_NAME,
} from "./local-build-reload.ts";

let checkLocalBuild: typeof import("./local-build-reload.ts").checkLocalBuild;

describe("操作時のローカルビルド確認", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    ({ checkLocalBuild } = await import("./local-build-reload.ts"));
    nativeMessaging.sendNativeMessage.mockResolvedValue({
      type: "build-available",
      build: "current",
    });
    nativeMessaging.get.mockResolvedValue({});
    nativeMessaging.set.mockResolvedValue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("現在と異なる未試行のbuildだけを受け入れる", () => {
    expect(
      buildToReload(
        { type: "build-available", build: "next" },
        "current",
        undefined,
      ),
    ).toBe("next");
    expect(
      buildToReload(
        { type: "build-available", build: "current" },
        "current",
        undefined,
      ),
    ).toBeNull();
    expect(
      buildToReload(
        { type: "build-available", build: "next" },
        "current",
        "next",
      ),
    ).toBeNull();
  });

  test.each([
    null,
    {},
    { type: "other", build: "next" },
    { type: "build-available", build: "" },
    { type: "build-available", build: null },
  ])("無効な応答はリロードしない: %j", (message) => {
    expect(buildToReload(message, "current", undefined)).toBeNull();
  });

  test("操作ごとに単発で確認し、現在のビルドなら続行する", async () => {
    expect(await checkLocalBuild("current")).toBe(true);
    expect(nativeMessaging.sendNativeMessage).toHaveBeenCalledExactlyOnceWith(
      RELOAD_HOST_NAME,
      { type: "get-build" },
    );
    expect(nativeMessaging.reload).not.toHaveBeenCalled();
    expect(await checkLocalBuild("current")).toBe(true);
    expect(nativeMessaging.sendNativeMessage).toHaveBeenCalledTimes(2);
  });

  test("試行済みIDを保存してからリロードし、操作を中止する", async () => {
    nativeMessaging.sendNativeMessage.mockResolvedValue({
      type: "build-available",
      build: "next",
    });
    let saved!: () => void;
    nativeMessaging.set.mockReturnValue(
      new Promise<void>((resolve) => {
        saved = resolve;
      }),
    );
    const checking = checkLocalBuild("current");
    await vi.waitFor(() =>
      expect(nativeMessaging.set).toHaveBeenCalledWith({
        [RELOAD_ATTEMPT_KEY]: "next",
      }),
    );
    expect(nativeMessaging.reload).not.toHaveBeenCalled();
    saved();
    expect(await checking).toBe(false);
    expect(nativeMessaging.reload).toHaveBeenCalledTimes(1);
  });

  test("同時の確認は通信とリロードを共有する", async () => {
    let respond!: (value: unknown) => void;
    nativeMessaging.sendNativeMessage.mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    const first = checkLocalBuild("current");
    const second = checkLocalBuild("current");
    expect(second).toBe(first);
    expect(nativeMessaging.sendNativeMessage).toHaveBeenCalledTimes(1);
    respond({ type: "build-available", build: "next" });
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(nativeMessaging.reload).toHaveBeenCalledTimes(1);
  });

  test("同じ配備への試行が残っていればリロードを繰り返さない", async () => {
    nativeMessaging.sendNativeMessage.mockResolvedValue({
      type: "build-available",
      build: "next",
    });
    nativeMessaging.get.mockResolvedValue({ [RELOAD_ATTEMPT_KEY]: "next" });
    expect(await checkLocalBuild("current")).toBe(true);
    expect(nativeMessaging.reload).not.toHaveBeenCalled();
  });

  test("リロード開始後に旧contextが残っていても次の操作を止める", async () => {
    nativeMessaging.sendNativeMessage.mockResolvedValue({
      type: "build-available",
      build: "next",
    });
    expect(await checkLocalBuild("current")).toBe(false);
    expect(await checkLocalBuild("current")).toBe(false);
    expect(nativeMessaging.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(nativeMessaging.reload).toHaveBeenCalledTimes(1);
  });

  test("リロード呼び出しに失敗した場合は次の操作で確認を再開する", async () => {
    nativeMessaging.sendNativeMessage.mockResolvedValue({
      type: "build-available",
      build: "next",
    });
    nativeMessaging.get
      .mockResolvedValueOnce({})
      .mockResolvedValue({ [RELOAD_ATTEMPT_KEY]: "next" });
    nativeMessaging.reload.mockImplementationOnce(() => {
      throw new Error("Reload failed");
    });
    expect(await checkLocalBuild("current")).toBe(true);
    expect(await checkLocalBuild("current")).toBe(true);
    expect(nativeMessaging.sendNativeMessage).toHaveBeenCalledTimes(2);
    expect(nativeMessaging.reload).toHaveBeenCalledTimes(1);
  });

  test("Host接続失敗時は続行し、次の操作で再確認する", async () => {
    nativeMessaging.sendNativeMessage.mockRejectedValueOnce(
      new Error("Host not found"),
    );
    expect(await checkLocalBuild("current")).toBe(true);
    expect(await checkLocalBuild("current")).toBe(true);
    expect(nativeMessaging.sendNativeMessage).toHaveBeenCalledTimes(2);
    expect(nativeMessaging.reload).not.toHaveBeenCalled();
  });

  test("試行の保存に失敗したらリロードしない", async () => {
    nativeMessaging.sendNativeMessage.mockResolvedValue({
      type: "build-available",
      build: "next",
    });
    nativeMessaging.set.mockRejectedValue(new Error("Storage unavailable"));
    expect(await checkLocalBuild("current")).toBe(true);
    expect(nativeMessaging.reload).not.toHaveBeenCalled();
  });

  test("ストア版のパネルは問い合わせを増やさない", async () => {
    vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
    expect(await checkPanelBuild()).toBe(true);
    expect(nativeMessaging.sendMessage).not.toHaveBeenCalled();
  });

  test("ローカル版のパネルはworkerが続行を許可した場合だけ操作する", async () => {
    vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
    nativeMessaging.sendMessage
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("Worker reloading"));
    expect(await checkPanelBuild()).toBe(true);
    expect(nativeMessaging.sendMessage).toHaveBeenCalledWith({
      type: CHECK_LOCAL_BUILD,
    });
    expect(await checkPanelBuild()).toBe(false);
    expect(await checkPanelBuild()).toBe(false);
  });
});
