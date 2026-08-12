import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const popupStyles = readFileSync(
  resolve(process.cwd(), "entrypoints/popup/style.css"),
  "utf8",
);

describe("popup のスタイルシート", () => {
  it("操作できないボタンを通常の操作と区別して描く", () => {
    expect(popupStyles).toMatch(/\.popup button:disabled\s*\{/);
    expect(popupStyles).toMatch(/cursor:\s*not-allowed;/);
    expect(popupStyles).toMatch(/background:\s*var\(--subtle-background\);/);
  });
});
