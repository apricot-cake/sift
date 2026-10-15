// @vitest-environment node
import { launch } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { secureDevBrowserProfile } from "./dev-browser-profile.ts";
import {
  devBrowserProfile,
  launchDevBrowser,
  withDevBrowser,
} from "./managed-dev-browser.ts";

vi.mock("puppeteer-core", () => ({ launch: vi.fn() }));
vi.mock("./chrome-path.ts", () => ({ findChromePath: () => "chrome" }));
vi.mock("./dev-browser-profile.ts", () => ({
  secureDevBrowserProfile: vi.fn(),
}));

describe("起動元の pipe だけで管理する開発用 Chrome", () => {
  const start = vi.mocked(launch);
  const close = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SIFT_DEV_PROFILE", "test-profile");
    start.mockResolvedValue({ close } as unknown as Awaited<
      ReturnType<typeof launch>
    >);
  });
  afterEach(() => vi.unstubAllEnvs());
  test.each([true, false])(
    "自動・手動とも TCP を開かず、sandbox を無効にしない: %s",
    async (headless) => {
      await launchDevBrowser(headless);
      const options = start.mock.calls[0]?.[0];
      expect(options).toMatchObject({
        headless,
        pipe: true,
        enableExtensions: true,
        defaultViewport: null,
        userDataDir: devBrowserProfile(),
      });
      expect(
        options?.args?.some((arg) =>
          /remote-debugging|no-sandbox|disable-setuid-sandbox/.test(arg),
        ),
      ).toBe(false);
      expect(options?.ignoreDefaultArgs).toEqual(
        expect.arrayContaining(["--hide-scrollbars"]),
      );
      expect(options?.args).not.toContain("--hide-scrollbars");
      if (headless) expect(options?.args).toContain("--window-size=1280,720");
      if (headless)
        expect(options?.args).not.toContain("--restore-last-session");
      else expect(options?.args).toContain("--restore-last-session");
    },
  );
  test("成功後に所有ブラウザを閉じる", async () => {
    expect(
      await withDevBrowser(async (browser) => {
        expect(browser).toHaveProperty("close");
        return 7;
      }),
    ).toBe(7);
    expect(close).toHaveBeenCalledOnce();
  });
  test("Puppeteer の環境変数が追加する sandbox 無効化を除去する", async () => {
    const sdk =
      await vi.importActual<typeof import("puppeteer-core")>("puppeteer-core");
    vi.stubEnv("PUPPETEER_DANGEROUS_NO_SANDBOX", "true");
    await launchDevBrowser(true);
    const options = start.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    const defaults = await sdk.defaultArgs(options);
    expect(defaults).toContain("--no-sandbox");
    const ignored = options?.ignoreDefaultArgs;
    expect(Array.isArray(ignored)).toBe(true);
    const effective = defaults.filter(
      (arg) => !(ignored as string[]).includes(arg),
    );
    expect(effective).not.toContain("--no-sandbox");
    expect(effective).not.toContain("--disable-setuid-sandbox");
  });
  test("失敗後にも所有ブラウザを閉じる", async () => {
    await expect(
      withDevBrowser(async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(close).toHaveBeenCalledOnce();
  });
  test("旧セッション環境変数から外部 Chrome を採用しない", async () => {
    vi.stubEnv(
      "SIFT_DEV_BROWSER_SESSION",
      JSON.stringify({
        profile: devBrowserProfile(),
        endpoint: "ws://127.0.0.1:49152/devtools/browser/foreign",
      }),
    );
    await withDevBrowser(async () => 0);
    expect(start).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  test("不正な profile は Chrome 起動前に拒否する", async () => {
    vi.mocked(secureDevBrowserProfile).mockImplementationOnce(() => {
      throw new Error("unsafe profile");
    });
    await expect(withDevBrowser(async () => 0)).rejects.toThrow(
      "unsafe profile",
    );
    expect(start).not.toHaveBeenCalled();
  });
  test("中断済みなら Chrome を起動しない", async () => {
    const controller = new AbortController();
    controller.abort(new Error("interrupted"));
    await expect(
      withDevBrowser(async () => 0, controller.signal),
    ).rejects.toThrow("interrupted");
    expect(start).not.toHaveBeenCalled();
  });
  test("起動中の中断でも callback を実行せず Chrome を閉じる", async () => {
    const controller = new AbortController();
    start.mockImplementationOnce(async () => {
      controller.abort(new Error("interrupted"));
      return { close } as unknown as Awaited<ReturnType<typeof launch>>;
    });
    const run = vi.fn();
    await expect(withDevBrowser(run, controller.signal)).rejects.toThrow(
      "interrupted",
    );
    expect(run).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
