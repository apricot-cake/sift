import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const source = fs.readFileSync(
  path.join(import.meta.dirname, "dev-browser.ts"),
  "utf8",
);

describe("開発用Chromeプロファイル", () => {
  test("日常用プロファイルと同じproductionビルドを読む", () => {
    expect(source).toContain('path.join(ROOT, ".output", "chrome-mv3")');
    expect(source).toContain('"Extensions.loadUnpacked"');
    expect(source).toContain('"Extensions.getExtensions"');
  });

  test("背面でも描画とタイマーを維持する", () => {
    expect(source).toContain("--disable-backgrounding-occluded-windows");
    expect(source).toContain("--disable-background-timer-throttling");
    expect(source).toContain("--disable-renderer-backgrounding");
  });
});
