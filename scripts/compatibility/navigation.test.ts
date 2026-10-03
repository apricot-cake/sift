import { describe, expect, it, vi } from "vitest";
import { retryNameResolution } from "./navigation.ts";

describe("実機検証の名前解決失敗", () => {
  it("一時的な失敗を記録し、正常なページ応答を取り直す", async () => {
    const error = new Error("page.goto: net::ERR_NAME_NOT_RESOLVED");
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("page");
    const record = vi.fn().mockResolvedValue(undefined);
    expect(await retryNameResolution(navigate, record)).toBe("page");
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(error.message);
  });
  it("名前解決が再び失敗したら不合格にする", async () => {
    const error = new Error("page.goto: net::ERR_NAME_NOT_RESOLVED");
    const navigate = vi.fn().mockRejectedValue(error);
    await expect(retryNameResolution(navigate, async () => {})).rejects.toBe(
      error,
    );
    expect(navigate).toHaveBeenCalledTimes(2);
  });
  it("画面確認の失敗や他の通信エラーは再試行しない", async () => {
    const error = new Error("Timeout waiting for heading");
    const navigate = vi.fn().mockRejectedValue(error);
    const record = vi.fn();
    await expect(retryNameResolution(navigate, record)).rejects.toBe(error);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });
});
