import path from "node:path";
import { describe, expect, test } from "vitest";
import { outputFor } from "./build-extension.ts";

describe("拡張機能ビルドの出力", () => {
  test.each(["candidate", "local", "store"] as const)(
    "%s ビルドは種別ごとの出力先を使う",
    (kind) => {
      expect(outputFor(kind)).toBe(
        path.resolve(import.meta.dirname, "..", ".output", kind, "chrome-mv3"),
      );
    },
  );

  test("日常版ビルドは検証候補を上書きしない", () => {
    expect(outputFor("local")).not.toBe(outputFor("candidate"));
  });

  test("ストア提出ビルドは共有出力を上書きしない", () => {
    expect(outputFor("store")).toBe(
      path.resolve(import.meta.dirname, "..", ".output", "store", "chrome-mv3"),
    );
  });
});
