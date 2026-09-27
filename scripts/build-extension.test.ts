import path from "node:path";
import { describe, expect, test } from "vitest";
import { outputFor } from "./build-extension.ts";

describe("拡張機能ビルドの出力", () => {
  test("ローカルビルドは検証用候補へ出力する", () => {
    expect(outputFor("local")).toBe(
      path.resolve(
        import.meta.dirname,
        "..",
        ".output",
        "candidate",
        "chrome-mv3",
      ),
    );
  });

  test("ストア提出ビルドは共有出力を上書きしない", () => {
    expect(outputFor("store")).toBe(
      path.resolve(import.meta.dirname, "..", ".output", "store", "chrome-mv3"),
    );
  });
});
