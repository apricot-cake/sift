import path from "node:path";
import { describe, expect, test } from "vitest";
import { outputFor } from "./build-extension.ts";

describe("拡張機能ビルドの出力", () => {
  test("ローカル配備だけがChromeの共有出力へ直接書く", () => {
    expect(outputFor("local")).toBe(
      path.resolve(import.meta.dirname, "..", ".output", "chrome-mv3"),
    );
  });

  test("ストア提出ビルドは共有出力を上書きしない", () => {
    expect(outputFor("store")).toBe(
      path.resolve(import.meta.dirname, "..", ".output", "store", "chrome-mv3"),
    );
  });
});
