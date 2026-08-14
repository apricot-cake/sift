import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readEntrypoint(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("抽出の操作入口", () => {
  it("有効・無効はポップアップだけで切り替える", () => {
    const popup = readEntrypoint("entrypoints/popup/index.html");
    const options = readEntrypoint("entrypoints/options/index.html");

    expect(popup).toContain('data-role="toggle-filtering"');
    expect(options).not.toContain('data-role="site-list"');
  });

  it("タイムライン内の空状態から設定を開ける", () => {
    const content = readEntrypoint("entrypoints/content/index.ts");

    expect(content).toContain("OPEN_OPTIONS_PAGE");
    expect(content).not.toContain('data-role="toggle-show-all"');
  });

  it("ポップアップは content script の応答を待たずに状態を読む", () => {
    const popup = readEntrypoint("entrypoints/popup/main.ts");

    expect(popup).toContain("settingsItem.getValue()");
    expect(popup).not.toContain("browser.tabs.sendMessage");
  });
});
