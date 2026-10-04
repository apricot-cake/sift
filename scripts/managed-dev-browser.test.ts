// @vitest-environment node

import { chromium } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";
import {
  assertDevBrowserProfile,
  secureDevBrowserProfile,
} from "./dev-browser-profile.ts";
import {
  devBrowserProfile,
  launchDevBrowser,
  readManagedDevBrowserEndpoint,
  withDevBrowser,
} from "./managed-dev-browser.ts";

vi.mock("@playwright/test", () => ({
  chromium: { launchPersistentContext: vi.fn() },
}));
vi.mock("./dev-browser-endpoint.ts", () => ({
  readDevBrowserEndpoint: vi.fn(),
}));
vi.mock("./chrome-path.ts", () => ({ findChromePath: () => "chrome" }));
vi.mock("./dev-browser-profile.ts", () => ({
  assertDevBrowserProfile: vi.fn(),
  secureDevBrowserProfile: vi.fn(),
}));

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

  test("自動検証はウィンドウを表示せず、通常のスクロールバーで検証する", async () => {
    await withDevBrowser(async () => 0);
    const options = launch.mock.calls[0]?.[1];
    expect(options).toMatchObject({ headless: true, viewport: null });
    expect(options?.args).toEqual(
      expect.arrayContaining([
        "--headless=new",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
      ]),
    );
    expect(options?.ignoreDefaultArgs).toEqual(
      expect.arrayContaining(["--headless", "--hide-scrollbars"]),
    );
    expect(options?.args).not.toContain("--hide-scrollbars");
    expect(options?.args?.some((arg) => arg.startsWith("--window-size="))).toBe(
      false,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  test("手動確認は可視ウィンドウを使い、CDP の TCP ポートを開かない", async () => {
    await launchDevBrowser(false);
    const options = launch.mock.calls[0]?.[1];
    expect(options).toMatchObject({ headless: false, viewport: null });
    expect(options?.args?.some((arg) => arg.startsWith("--headless"))).toBe(
      false,
    );
    expect(
      options?.args?.some((arg) => arg.startsWith("--remote-debugging-")),
    ).toBe(false);
    expect(options?.args?.some((arg) => arg.startsWith("--window-size="))).toBe(
      false,
    );
  });

  test("起動後の接続先確認が失敗してもブラウザを閉じる", async () => {
    read.mockReset().mockResolvedValue(null);
    await expect(withDevBrowser(async () => 0)).rejects.toThrow(
      "接続先を確認できません",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  test("不正な profile は endpoint probe と Chrome 起動の前に拒否する", async () => {
    vi.mocked(secureDevBrowserProfile).mockImplementationOnce(() => {
      throw new Error("unsafe profile");
    });
    await expect(withDevBrowser(async () => 0)).rejects.toThrow(
      "unsafe profile",
    );
    expect(read).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  test("読取接続は endpoint probe の前に profile を検査する", async () => {
    vi.mocked(assertDevBrowserProfile).mockImplementationOnce(() => {
      throw new Error("unsafe read profile");
    });
    await expect(readManagedDevBrowserEndpoint()).rejects.toThrow(
      "unsafe read profile",
    );
    expect(read).not.toHaveBeenCalled();
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
