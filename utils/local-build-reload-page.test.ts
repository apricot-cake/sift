import { describe, expect, test, vi } from "vitest";
import { startLocalBuildReloadForPage } from "./local-build-reload-page.ts";

describe("サイドパネルと自己リロード接続", () => {
  test("パネルを閉じたときに接続を終了する", async () => {
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const close = startLocalBuildReloadForPage(start);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("接続準備中にパネルが閉じた場合は、完成した接続を残さない", async () => {
    let finishStart: ((stop: () => void) => void) | undefined;
    const stop = vi.fn();
    const close = startLocalBuildReloadForPage(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    await vi.waitFor(() => expect(finishStart).toBeTypeOf("function"));

    close();
    finishStart?.(stop);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
});
