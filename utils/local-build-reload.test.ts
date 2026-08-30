import { beforeEach, describe, expect, test, vi } from "vitest";

const nativeMessaging = vi.hoisted(() => {
  const disconnect = vi.fn();
  const port = {
    disconnect,
    onDisconnect: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  };
  return {
    connectNative: vi.fn(() => port),
    disconnect,
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      connectNative: nativeMessaging.connectNative,
      reload: vi.fn(),
      lastError: undefined,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
    },
  },
}));

import { buildToReload, startLocalBuildReload } from "./local-build-reload.ts";

describe("ローカル配備後の自己リロード", () => {
  beforeEach(() => {
    nativeMessaging.connectNative.mockClear();
    nativeMessaging.disconnect.mockClear();
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

  test("プロトコル外の通知を拒む", () => {
    expect(buildToReload(null, "current", undefined)).toBeNull();
    expect(
      buildToReload({ type: "other", build: "next" }, "current", undefined),
    ).toBeNull();
    expect(
      buildToReload(
        { type: "build-available", build: "" },
        "current",
        undefined,
      ),
    ).toBeNull();
  });

  test("サイドパネルを閉じたときにNative Hostとの接続も閉じる", () => {
    const stop = startLocalBuildReload("current");

    expect(nativeMessaging.connectNative).toHaveBeenCalledTimes(1);
    stop();
    expect(nativeMessaging.disconnect).toHaveBeenCalledTimes(1);
  });
});
