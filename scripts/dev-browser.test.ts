import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const source = fs.readFileSync(
  path.join(import.meta.dirname, "dev-browser.ts"),
  "utf8",
);

describe("開発用Chromeプロファイル", () => {
  test("自動選択ポートで起動し、拡張機能の読み込みはChromeに任せる", () => {
    expect(source).not.toContain("const CDP_PORT");
    expect(source).toContain('const PROFILE_DIRECTORY = "Default";');
    expect(source).toContain("--profile-directory=$" + "{PROFILE_DIRECTORY}");
    expect(source).toContain('"--remote-debugging-port=0"');
    expect(source).not.toContain('"Extensions.loadUnpacked"');
    expect(source).not.toContain('"Extensions.getExtensions"');
  });

  test("背面でも描画とタイマーを維持する", () => {
    expect(source).toContain("--disable-backgrounding-occluded-windows");
    expect(source).toContain("--disable-background-timer-throttling");
    expect(source).toContain("--disable-renderer-backgrounding");
  });
});
