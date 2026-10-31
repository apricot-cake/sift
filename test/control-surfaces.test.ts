import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readPanelSource(): string {
  return (
    readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx") +
    "\n" +
    readEntrypoint("entrypoints/sidepanel/use-panel-connection.ts")
  );
}

function readEntrypoint(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("抽出の操作入口", () => {
  it("最低値の候補は数値だけにし、件数と数値入力の単位は残す", () => {
    const panel = readPanelSource();
    for (const [locale, likes] of [
      ["ja", "いいね"],
      ["en", " likes"],
    ]) {
      const messages = readEntrypoint(`locales/${locale}.yml`);
      expect(messages).toContain(
        `sidepanelLikeSuggestionMinimumSuffix: "${likes}"`,
      );
    }
    expect(panel).toContain(
      'suffix={t("sidepanelLikeSuggestionMinimumSuffix")}',
    );
    const candidates = panel.slice(
      panel.indexOf("{suggestions.map((suggestion)"),
    );
    const options = candidates.slice(0, candidates.indexOf("</SelectContent>"));
    expect(options).toContain("{formatter.format(suggestion.minimum)}");
    expect(options).not.toContain("SuggestionMinimumSuffix");
    expect(options).toContain('data-choice-count=""');
    expect(options).toContain("sidepanelLikeSuggestionCountSuffix");
  });
  it("SNSの除外スイッチに表示ラベルと同じ名前を付ける", () => {
    const panel = readPanelSource();
    for (const [label, setting] of [
      ["optionsHideReplies", "hideReplies"],
      ["optionsHideQuotes", "hideQuotes"],
      ["optionsHideReposts", "hideReposts"],
    ]) {
      expect(panel.replace(/\s+/g, " ")).toContain(
        `aria-label={t("${label}")} checked={selectedSettings.${setting}}`,
      );
    }
  });
  it("候補の選択は値と最低値トグルを同時に更新する", () => {
    const sidepanel = readPanelSource();
    expect(sidepanel).toMatch(
      /minReactions: minimum,\s*minReactionsEnabled: true/,
    );
    expect(sidepanel).toContain("setManualMinimum(value, true)");
    expect(sidepanel.replace(/\s+/g, " ")).toContain(
      "!manualActive && selectedSettings.minReactionsEnabled",
    );
  });
  it("ページ上に操作UIを追加しない", () => {
    const content = readEntrypoint("utils/content-runtime.ts");
    const sidepanel = readPanelSource();

    expect(content).not.toContain("siftEmptyState");
    expect(content).not.toContain('createElement("button")');
    expect(sidepanel).not.toContain("timelineSafetyStop");
    expect(sidepanel).not.toContain("resumeLoading");
  });

  it("しきい値は全消ししてから直接打ち替えられる", () => {
    const sidepanel = readPanelSource();

    expect(sidepanel).toContain('inputMode="numeric"');
    expect(sidepanel).toContain("event.currentTarget.select()");
    expect(sidepanel).toContain('type="number"');
    expect(sidepanel).toContain("value={draft}");
    expect(sidepanel).toContain('draft.trim() === ""');
    expect(sidepanel).toContain("onBlur={commit}");
  });

  it("最低値の数値入力はトグルを使わず選択する", () => {
    const sidepanel = readPanelSource();
    const start = sidepanel.indexOf("function ThresholdSetting");
    const end = sidepanel.indexOf("function EditableNumberInput", start);
    const thresholdSetting = sidepanel.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(thresholdSetting).toContain("<EditableNumberInput");
    expect(thresholdSetting).not.toContain("disabled={!enabled}");
    expect(thresholdSetting).not.toContain("<Switch");
    expect(thresholdSetting).toContain('data-custom-minimum=""');
    expect(sidepanel).not.toContain('t("optionsLikesEnabled")');
    expect(sidepanel).not.toContain('t("optionsViewsEnabled")');
  });

  it("コンテンツタイプはすべてと各種類を一つのプルダウンで選ぶ", () => {
    const sidepanel = readPanelSource();
    const start = sidepanel.indexOf("function MediaSetting");
    const mediaSetting = sidepanel.slice(start);

    expect(start).toBeGreaterThan(-1);
    expect(mediaSetting).toContain('<SelectItem value="none">');
    expect(mediaSetting).toContain('nextMode !== "none"');
    expect(mediaSetting).not.toContain("<Switch");
  });

  it("サイドパネルは所有タブに固定し、設定の操作入口を集約する", () => {
    const sidepanel = readPanelSource();

    expect(sidepanel).toContain("withSiteSettings");
    expect(sidepanel).toContain("setSelectedSite(site)");
    expect(sidepanel).toContain("disabled={!filteringIsAvailable}");
    expect(sidepanel).toContain('data-sift-sidepanel=""');
    expect(sidepanel).toContain("browser.tabs.onActivated.addListener");
    expect(sidepanel).toContain("isSidePanelTabRequest(message)");
    expect(sidepanel).toContain("sidePanelTabIdFromUrl");
    expect(sidepanel).toContain("message.tabId !== panelTabId.current");
    expect(sidepanel).not.toContain("browser.runtime.openOptionsPage");
    expect(sidepanel).not.toContain("manageAll");
    expect(sidepanel).toContain('variant="ghost"');
    expect(sidepanel).not.toContain("sidepanelCurrentPage");
    expect(sidepanel).not.toContain("data-manage-settings");
    expect(sidepanel).not.toContain("value={selectedSite}");
  });

  it("投稿と絞り込み条件をパネル内タブで分ける", () => {
    const sidepanel = readPanelSource();

    expect(sidepanel).toContain('t("optionsHideReplies")');
    expect(sidepanel).toContain('t("optionsHideQuotes")');
    expect(sidepanel).toContain('t("optionsHideReposts")');
    expect(sidepanel).not.toContain("excludedKeywords");
    expect(sidepanel).not.toContain("optionsKeywords");
    expect(sidepanel).not.toContain("collapsible");
    expect(sidepanel).not.toContain("defaultOpen");
    expect(sidepanel).not.toContain("<details");
    expect(sidepanel).toContain('role="tablist"');
    expect(sidepanel).toContain('role="tabpanel"');
    expect(sidepanel).not.toContain("<summary");
  });

  it("指定なし・候補・数値入力の順に並べ集計説明を末尾に置く", () => {
    const sidepanel = readPanelSource();
    expect(sidepanel.match(/<section data-minimum-group="">/g)).toHaveLength(1);
    expect(sidepanel.match(/<\/ReactionThresholdSuggestions>/g)).toHaveLength(
      1,
    );
    const suggestions = sidepanel.slice(
      sidepanel.indexOf("function ReactionThresholdSuggestions"),
      sidepanel.indexOf("function EditableNumberInput"),
    );
    expect(suggestions.indexOf("suggestions.map")).toBeLessThan(
      suggestions.indexOf('<SelectItem value="custom">'),
    );
    expect(suggestions.indexOf('<SelectItem value="custom">')).toBeLessThan(
      suggestions.indexOf("{scopeText}"),
    );
    expect(suggestions.indexOf('<SelectItem value="none">')).toBeLessThan(
      suggestions.indexOf("suggestions.map"),
    );
    expect(suggestions).toContain('data-minimum-picker=""');
    expect(suggestions).toContain(
      "minimumEnabled && !selectionEnabled && children",
    );
    expect(suggestions).toContain('value === "custom"');
    expect(suggestions).not.toContain("return null");
  });

  it("サイドパネルの絞り込み項目を一列に並べる", () => {
    const sidepanel = readPanelSource();
    const marker = sidepanel.indexOf('data-filter-controls=""');
    const end = sidepanel.indexOf("</fieldset>", marker);
    const group = sidepanel.slice(marker, end);

    expect(marker).toBeGreaterThan(-1);
    expect(group).not.toContain("<Card");
    expect(group).not.toContain("<CardContent");
    expect(group).toContain("disabled={!filteringIsAvailable}");
    expect(group).not.toContain('t("optionsSectionDisplayConditions")');
    expect(group.match(/t\("optionsSectionExclude"\)/g)).toHaveLength(1);
    expect(group).not.toContain("data-master-filter");
    expect(group).not.toContain("sidepanelFiltering");
    expect(group).not.toContain("divide-y");
    expect(group).not.toContain("<SettingsGroup");
  });

  it("パネルから全サイト設定を確認付きで既定値へ戻せる", () => {
    const sidepanel = readPanelSource();

    expect(sidepanel).not.toContain("window.confirm");
    expect(sidepanel).toContain("resetDialog.current?.showModal()");
    expect(sidepanel).toContain("resetCancel.current?.focus()");
    expect(sidepanel).toContain('aria-describedby="reset-description"');
    expect(sidepanel).toContain('variant="destructive"');
    expect(sidepanel).toContain("saveSettings(defaults)");
    expect(sidepanel).toContain('t("optionsResetSettings")');
    expect(sidepanel).toContain("setManualSites({})");
    expect(sidepanel).toContain("setResetAllSites(false)");
    expect(sidepanel).toContain("setResetSite(activeSite)");
    expect(sidepanel).toContain("settingsFor(defaults, resetSite)");
    expect(sidepanel).toContain("checked={resetAllSites}");
  });

  it("ページ内の検出結果からサイトを選ぶ", () => {
    const config = readEntrypoint("wxt.config.ts");
    const sidepanel = readPanelSource();

    expect(config).toContain('"activeTab"');
    expect(sidepanel).toContain("context?.site ?? null");
  });
});
