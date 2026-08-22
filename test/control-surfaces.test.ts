import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readEntrypoint(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("抽出の操作入口", () => {
  it("アイコンのクリックでサイドパネルを開く", () => {
    const background = readEntrypoint("entrypoints/background.ts");

    expect(background).toContain("openPanelOnActionClick: true");
    expect(background).not.toContain("openOptionsPage");
  });

  it("タイムライン内の空状態からフィルターを調整できる", () => {
    const content = readEntrypoint("entrypoints/content/index.ts");

    expect(content).toContain("OPEN_LIVE_CONTROLS");
    expect(content).toContain("siftOpenLiveControls");
    expect(content).not.toContain('data-role="toggle-show-all"');
  });

  it("しきい値は直接打ち替えられる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain('inputMode="numeric"');
    expect(sidepanel).toContain("event.currentTarget.select()");
    expect(sidepanel).toContain('type="number"');
  });

  it("サイドパネルは現在タブへ追従し、他の設定は設定ページで管理する", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const options = readEntrypoint("entrypoints/options/main.tsx");

    expect(sidepanel).toContain("withSiteEnabled");
    expect(sidepanel).toContain("withSiteSettings");
    expect(sidepanel).toContain("siteSettingsKeyForControl");
    expect(sidepanel).toContain("browser.tabs.onActivated.addListener");
    expect(sidepanel).toContain("browser.runtime.openOptionsPage");
    expect(sidepanel).not.toContain("value={selectedSite}");
    expect(options).toContain("<SidepanelApp manageAll />");
  });

  it("サイドパネルで現在タブの URL を読める", () => {
    const config = readEntrypoint("wxt.config.ts");

    expect(config).toContain('"activeTab"');
  });

  it("サイドパネルのフッターからリポジトリを開ける", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain("href={REPOSITORY_URL}");
    expect(sidepanel).toContain('rel="noreferrer"');
    expect(sidepanel).toContain('target="_blank"');
  });
});
