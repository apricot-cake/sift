// @vitest-environment node

import { chromium } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";
import { secureDevBrowserProfile } from "./dev-browser-profile.ts";
import {
  devBrowserProfile,
  readManagedDevBrowserEndpoint,
  withDevBrowser,
} from "./managed-dev-browser.ts";

vi.mock("@playwright/test", () => ({
  chromium: { launchPersistentContext: vi.fn() },
}));
vi.mock("./dev-browser-endpoint.ts", () => ({
  readDevBrowserEndpoint: vi.fn(),
}));
vi.mock("./dev-browser-profile.ts", () => ({
  secureDevBrowserProfile: vi.fn(),
}));
vi.mock("./chrome-path.ts", () => ({ findChromePath: () => "chrome" }));

describe("検証中だけ有効な開発用 Chrome", () => {
  const read = vi.mocked(readDevBrowserEndpoint);
  const launch = vi.mocked(chromium.launchPersistentContext);
  const close = vi.fn();
  const endpoint = {
    url: "http://127.0.0.1:49152",
    webSocketDebuggerUrl: "ws://127.0.0.1:49152/devtools/browser/owned",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SIFT_DEV_BROWSER_SESSION", "");
    vi.stubEnv("SIFT_DEV_PROFILE", "test-profile");
    launch.mockResolvedValue({ close } as unknown as Awaited<
      ReturnType<typeof chromium.launchPersistentContext>
    >);
    read.mockResolvedValueOnce(null).mockResolvedValue(endpoint);
  });
  afterEach(() => vi.unstubAllEnvs());

  test("正常終了後に所有ブラウザを閉じ、セッションを破棄する", async () => {
    expect(
      await withDevBrowser(async () => {
        expect(await readManagedDevBrowserEndpoint()).toEqual(endpoint);
        return 7;
      }),
    ).toBe(7);
    expect(close).toHaveBeenCalledOnce();
    expect(process.env.SIFT_DEV_BROWSER_SESSION).toBeUndefined();
    expect(launch).toHaveBeenCalledWith(
      devBrowserProfile(),
      expect.objectContaining({ chromiumSandbox: true, viewport: null }),
    );
    expect(secureDevBrowserProfile).toHaveBeenCalledWith(devBrowserProfile());
    const secureOrder = vi.mocked(secureDevBrowserProfile).mock
      .invocationCallOrder[0];
    const probeOrder = read.mock.invocationCallOrder[0];
    if (secureOrder === undefined || probeOrder === undefined)
      throw new Error("権限補正と endpoint probe が実行されていません。");
    expect(secureOrder).toBeLessThan(probeOrder);
  });

  test("検証が失敗してもブラウザを閉じる", async () => {
    await expect(
      withDevBrowser(async () => {
        throw new Error("child failure");
      }),
    ).rejects.toThrow("child failure");
    expect(close).toHaveBeenCalledOnce();
    expect(process.env.SIFT_DEV_BROWSER_SESSION).toBeUndefined();
  });

  test("起動後の接続先確認が失敗してもブラウザを閉じる", async () => {
    read.mockReset().mockResolvedValue(null);
    await expect(withDevBrowser(async () => 0)).rejects.toThrow(
      "接続先を確認できません",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  test("常設された CDP を所有セッションとして流用しない", async () => {
    read.mockReset().mockResolvedValue(endpoint);
    const run = vi.fn();
    await expect(withDevBrowser(run)).rejects.toThrow("先に閉じてください");
    expect(launch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  test("子コマンドは所有ブラウザを閉じずに共有する", async () => {
    await withDevBrowser(async () => {
      await withDevBrowser(async () => 0);
      expect(close).not.toHaveBeenCalled();
    });
    expect(launch).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  test("中断済みなら Chrome の起動を始めない", async () => {
    const controller = new AbortController();
    const reason = new Error("interrupted startup");
    controller.abort(reason);
    const run = vi.fn();
    await expect(withDevBrowser(run, controller.signal)).rejects.toThrow(
      "interrupted startup",
    );
    expect(run).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  test.each([
    "",
    JSON.stringify({
      profile: "other",
      endpoint: endpoint.webSocketDebuggerUrl,
    }),
    JSON.stringify({
      profile: "test-profile",
      endpoint: "ws://127.0.0.1:49152/devtools/browser/other",
    }),
  ])("未管理または別セッションでは接続しない: %s", async (session) => {
    read.mockReset().mockResolvedValue(endpoint);
    vi.stubEnv("SIFT_DEV_BROWSER_SESSION", session);
    await expect(readManagedDevBrowserEndpoint()).rejects.toThrow(
      "管理中の開発用 Chrome がありません",
    );
  });
});
