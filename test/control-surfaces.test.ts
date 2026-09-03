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

  it("ページ上に操作UIを追加しない", () => {
    const content = readEntrypoint("entrypoints/content/index.ts");
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(content).not.toContain("siftEmptyState");
    expect(content).not.toContain('createElement("button")');
    expect(sidepanel).not.toContain("timelineSafetyStop");
    expect(sidepanel).not.toContain("resumeLoading");
  });

  it("連続読み込みは停止せずサイドパネルから解除できる", () => {
    const content = readEntrypoint("entrypoints/content/index.ts");
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(content).toContain("continuousLoadingWarning");
    expect(content).not.toContain('adapter.id === "x"');
    expect(sidepanel).toContain("continuousLoadingWarningTitle");
    expect(sidepanel).toContain("updateFiltering(false)");
    expect(sidepanel).toContain('t("sidepanelStatusFilteringDisabled")');
    expect(sidepanel).toContain('t("sidepanelEnableFiltering")');
    expect(sidepanel).toContain("updateFiltering(true)");
    expect(sidepanel).toContain("!filteringIsAvailable || !filteringEnabled");
  });

  it("しきい値は全消ししてから直接打ち替えられる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain('inputMode="numeric"');
    expect(sidepanel).toContain("event.currentTarget.select()");
    expect(sidepanel).toContain('type="number"');
    expect(sidepanel).toContain("value={draft}");
    expect(sidepanel).toContain('draft.trim() === ""');
    expect(sidepanel).toContain("onBlur={commit}");
  });

  it("最低値は数値欄と同じ行のトグルで切り替える", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const start = sidepanel.indexOf("function ThresholdSetting");
    const end = sidepanel.indexOf("function EditableNumberInput", start);
    const thresholdSetting = sidepanel.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(thresholdSetting).toContain("<EditableNumberInput");
    expect(thresholdSetting).toContain("disabled={!enabled}");
    expect(thresholdSetting).toContain("<Switch");
    expect(sidepanel).not.toContain('t("optionsLikesEnabled")');
    expect(sidepanel).not.toContain('t("optionsViewsEnabled")');
  });

  it("コンテンツタイプはすべてと各種類を一つのプルダウンで選ぶ", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const start = sidepanel.indexOf("function MediaSetting");
    const mediaSetting = sidepanel.slice(start);

    expect(start).toBeGreaterThan(-1);
    expect(mediaSetting).toContain('<SelectItem value="none">');
    expect(mediaSetting).toContain('nextMode !== "none"');
    expect(mediaSetting).not.toContain("<Switch");
  });

  it("動画の公開時期は期間指定なしと各単位を一つのプルダウンで選ぶ", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const start = sidepanel.indexOf("function PublicationPeriodSetting");
    const end = sidepanel.indexOf("function MediaSetting", start);
    const periodSetting = sidepanel.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(periodSetting).toContain('<SelectItem value="all">');
    expect(periodSetting).toContain('nextValue !== "all"');
    expect(periodSetting).toContain('className="w-16"');
    expect(periodSetting).not.toContain("<Switch");
  });

  it("サイドパネルは現在タブへ追従し、他の設定は設定ページで管理する", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const options = readEntrypoint("entrypoints/options/main.tsx");

    expect(sidepanel).toContain("TIMELINE_CONTROL.setFiltering");
    expect(sidepanel).toContain("withSiteSettings");
    expect(sidepanel).toContain("setActiveSite(site)");
    expect(sidepanel).toContain(
      "disabled={!filteringIsAvailable || !filteringEnabled}",
    );
    expect(sidepanel).toContain(
      'data-sift-sidepanel={manageAll ? undefined : ""}',
    );
    expect(sidepanel).toContain("<h1");
    expect(sidepanel).toContain(">Sift</h1>");
    expect(sidepanel).toContain('manageAll ? "max-w-lg" : "max-w-xl"');
    expect(sidepanel).toContain("browser.tabs.onActivated.addListener");
    expect(sidepanel).toContain("shouldEnableFiltering");
    expect(sidepanel).toContain("pageFilteringExpected.current");
    expect(sidepanel).toContain("browser.runtime.openOptionsPage");
    expect(sidepanel).toContain('size="icon"');
    expect(sidepanel).toContain('variant="ghost"');
    expect(sidepanel).not.toContain("sidepanelCurrentPage");
    expect(sidepanel.indexOf('data-manage-settings=""')).toBeLessThan(
      sidepanel.indexOf("<fieldset"),
    );
    expect(sidepanel).not.toContain("value={selectedSite}");
    expect(options).toContain("<SidepanelApp manageAll />");
  });

  it("投稿形式の除外条件は折りたたまず常に表示する", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain('t("optionsHideReplies")');
    expect(sidepanel).toContain('t("optionsHideQuotes")');
    expect(sidepanel).toContain('t("optionsHideReposts")');
    expect(sidepanel).not.toContain("excludedKeywords");
    expect(sidepanel).not.toContain("optionsKeywords");
    expect(sidepanel).not.toContain("collapsible");
    expect(sidepanel).not.toContain("defaultOpen");
    expect(sidepanel).not.toContain("<details");
    expect(sidepanel).not.toContain("<summary");
  });

  it("サイドパネルの絞り込み項目をカードで囲わず一列に並べる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const marker = sidepanel.indexOf('data-filter-controls=""');
    const end = sidepanel.indexOf(
      "activeContext?.continuousLoadingWarning",
      marker,
    );
    const group = sidepanel.slice(marker, end);

    expect(marker).toBeGreaterThan(-1);
    expect(group).not.toContain("<Card");
    expect(group).not.toContain("<CardContent");
    expect(group).toContain(
      "disabled={!filteringIsAvailable || !filteringEnabled}",
    );
    expect(group).not.toContain('t("optionsSectionDisplayConditions")');
    expect(group).not.toContain('t("optionsSectionExclude")');
    expect(group).not.toContain("data-master-filter");
    expect(group).not.toContain("sidepanelFiltering");
    expect(group).not.toContain("divide-y");
    expect(group).not.toContain("<SettingsGroup");
  });

  it("設定ページは各サイトの設定を一枚のカードにまとめる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const start = sidepanel.indexOf("function SiteSettingsEditor");
    const end = sidepanel.indexOf("function SettingRow", start);
    const editor = sidepanel.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(editor.match(/<Card>/g) ?? []).toHaveLength(1);
    expect(editor).not.toContain('t("optionsSectionDisplayConditions")');
    expect(editor).not.toContain('t("optionsSectionExclude")');
    expect(editor).not.toContain("<SettingsGroup");
  });

  it("設定ページから全サイト設定を既定値へ戻せる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain('window.confirm(t("optionsResetConfirm"))');
    expect(sidepanel).toContain("saveSettings(defaults)");
    expect(sidepanel).toContain('t("optionsResetSettings")');
    expect(sidepanel).toContain('variant="destructive"');
  });

  it("ページ内の検出結果からサイトを選ぶ", () => {
    const config = readEntrypoint("wxt.config.ts");
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(config).not.toContain('"activeTab"');
    expect(sidepanel).toContain("context?.site ?? null");
  });

  it("設定ページの左ナビゲーションからリポジトリを開ける", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain("href={REPOSITORY_URL}");
    expect(sidepanel).toContain('rel="noreferrer"');
    expect(sidepanel).toContain('target="_blank"');
  });
});
