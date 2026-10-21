import { expect, it, vi } from "vitest";
import { rethrowWithDiagnostics } from "./failure-diagnostics.ts";

it("診断用APIが失効しても一次例外を保ち、残りの証拠を保存する", async () => {
  const original = new Error("パネル幅が変わりません");
  const saved: { name: string; data: unknown }[] = [];
  await expect(
    rethrowWithDiagnostics(
      original,
      {
        navigation: () => ({ width: 1264 }),
        tabs: () => {
          throw new Error("実行contextが失効しました");
        },
        context: async () => {
          throw new Error("APIに接続できません");
        },
        artifact: () => ({ buildId: "candidate" }),
      },
      (name, data) => {
        saved.push({ name, data });
      },
    ),
  ).rejects.toBe(original);
  expect(saved.map(({ name }) => name)).toEqual([
    "failure-cause",
    "navigation",
    "failure-diagnostic-error",
    "failure-diagnostic-error",
    "artifact",
  ]);
  expect(saved[2]?.data).toEqual({
    name: "tabs",
    message: "Error: 実行contextが失効しました",
  });
});

it("証拠の保存自体が失敗しても、元の失敗を報告して残りの診断を試す", async () => {
  const original = new Error("一次失敗");
  const diagnose = vi.fn(async () => true);
  await expect(
    rethrowWithDiagnostics(original, { diagnose }, async () => {
      throw new Error("保存失敗");
    }),
  ).rejects.toBe(original);
  expect(diagnose).toHaveBeenCalledOnce();
});
