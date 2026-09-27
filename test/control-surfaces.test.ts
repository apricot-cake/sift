import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readEntrypoint(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("抽出の操作入口", () => {
  it("未接続や対象外では初期化を完了せず、有効化の意図も消さない", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    expect(sidepanel).toMatch(
      /if \(nextPage !== null\) \{\s*panelInitialized.current = true/,
    );
    const unavailable = sidepanel.slice(
      sidepanel.indexOf("} else if (nextPage === null) {"),
      sidepanel.indexOf(
        "} else {",
        sidepanel.indexOf("} else if (nextPage === null) {"),
      ),
    );
    expect(unavailable).not.toContain("pageFilteringExpected.current = false");
  });
  it("候補の選択は値と最低値トグルを同時に更新する", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    expect(sidepanel).toMatch(/minCount: minimum,\s*minCountEnabled: true/);
    expect(sidepanel).toMatch(
      /minReactions: minimum,\s*minReactionsEnabled: true/,
    );
    expect(sidepanel).toContain("setManualMinimum(value, manualActive)");
    expect(sidepanel).toContain(
      "!manualActive && selectedSettings.minCountEnabled",
    );
  });
  it("対応サイトのタブでだけアイコンからサイドパネルを開く", () => {
    const background = readEntrypoint("entrypoints/background.ts");
    const content = readEntrypoint("entrypoints/sift.ts");

    expect(background).toContain("browser.action.onClicked.addListener");
    expect(background).not.toContain("opensPanelDirectlyFromActionUrl");
    expect(background).toContain("const panelOpening = sidePanel?.open");
    expect(
      background.indexOf("const panelOpening = sidePanel?.open"),
    ).toBeLessThan(background.indexOf("await browser.scripting.insertCSS"));
    const actionHandler = background.slice(
      background.indexOf("async function openPanelForActiveTab"),
      background.indexOf("async function refreshOpenPanelForNavigation"),
    );
    expect(actionHandler.indexOf("const panelOpening")).toBeLessThan(
      actionHandler.search(/^\s*await /m),
    );
    expect(actionHandler.match(/sidePanel\?\.open\(/g)).toHaveLength(1);
    expect(background).toContain("sidePanel?.setOptions({ enabled: false })");
    expect(background).toContain("browser.runtime.onInstalled.addListener");
    expect(background).toContain("isSupportedSiteUrl(tab.url)");
    expect(background).toContain("browser.scripting.executeScript");
    expect(background).toContain("FILTER_CONTEXT_REQUEST");
    expect(background).toContain("readFilterContext(tab.id)");
    expect(background).toContain("FILTER_CONTEXT_RETRY_COUNT");
    expect(background).toContain("sidePanel?.onOpened.addListener");
    expect(background).toContain("SIDE_PANEL_CONTROL.setPanelTab");
    expect(background).toContain('path: "sidepanel.html"');
    expect(content).toContain("defineUnlistedScript");
    expect(background).not.toContain("openOptionsPage");
  });

  it("ページ上に操作UIを追加しない", () => {
    const content = readEntrypoint("utils/content-runtime.ts");
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(content).not.toContain("siftEmptyState");
    expect(content).not.toContain('createElement("button")');
    expect(sidepanel).not.toContain("timelineSafetyStop");
    expect(sidepanel).not.toContain("resumeLoading");
  });

  it("連続読み込みは停止せずサイドパネルから解除できる", () => {
    const content = readEntrypoint("utils/content-runtime.ts");
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(content).toContain("continuousLoadingWarning");
    expect(content).not.toContain('adapter.id === "x"');
    expect(sidepanel).toContain("continuousLoadingWarningTitle");
    expect(sidepanel).toContain("updateFiltering(false)");
    expect(sidepanel).not.toContain("sidepanelStatusFilteringDisabled");
    expect(sidepanel).not.toContain("sidepanelEnableFiltering");
    expect(sidepanel).toContain("updateFiltering(true)");
    expect(sidepanel).toContain("updateFiltering(true)");
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
    expect(thresholdSetting).not.toContain("disabled={!enabled}");
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

  it("動画の公開時期は指定期間以内を非表示にする", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    const start = sidepanel.indexOf("function NewerVideosSetting");
    const end = sidepanel.indexOf("function MediaSetting", start);
    const periodSetting = sidepanel.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(periodSetting).toContain('t("optionsHidePublishedWithin")');
    expect(periodSetting).toContain('className="w-14 px-2"');
    expect(periodSetting).toContain('className="w-auto min-w-16 gap-1 px-2"');
    const select = readEntrypoint(
      "entrypoints/sidepanel/components/ui/select.tsx",
    );
    expect(select).toContain('className="size-4 shrink-0 opacity-50"');
    expect(periodSetting).toContain('data-publication-age=""');
    expect(periodSetting).toContain('data-publication-age-inputs=""');
    expect(periodSetting.indexOf("<Switch")).toBeLessThan(
      periodSetting.indexOf("<EditableNumberInput"),
    );
    expect(periodSetting).not.toContain("disabled={!enabled}");
    expect(periodSetting).toContain(
      "onChange(enabled, nextValue as PublicationAgeUnit)",
    );
    expect(periodSetting).toContain("<Switch");
    expect(periodSetting).not.toContain('<SelectItem value="all">');
  });

  it("再生回数はラベルと回数の単位を表示する", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    expect(sidepanel).toContain('{t("optionsMinViews")}');
    expect(
      sidepanel.match(/label=\{t\("optionsManualMinimum"\)\}/g),
    ).toHaveLength(2);
    expect(sidepanel.match(/suffix=\{t\("optionsUnitViews"\)\}/g)).toHaveLength(
      1,
    );
    expect(sidepanel).not.toContain("optionsViewsPrefix");
  });

  it("YouTubeだけでメンバー限定動画を除外できる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain('t("optionsHideMembersOnly")');
    expect(sidepanel).toContain('selectedSite === "youtube"');
    expect(sidepanel).toContain("hideMembersOnly");
  });

  it("サイドパネルは現在タブへ追従し、設定の操作入口を集約する", () => {
    const background = readEntrypoint("entrypoints/background.ts");
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(sidepanel).toContain("TIMELINE_CONTROL.setFiltering");
    expect(sidepanel).toContain("withSiteSettings");
    expect(sidepanel).toContain("setActiveSite(site)");
    expect(sidepanel).toContain("disabled={!filteringIsAvailable}");
    expect(sidepanel).toContain('data-sift-sidepanel=""');
    expect(sidepanel).toContain("browser.tabs.onActivated.addListener");
    expect(sidepanel).toContain("shouldEnableFiltering");
    expect(sidepanel).toContain("isSidePanelTabRequest(message)");
    expect(sidepanel).toContain("SIDE_PANEL_TAB_STORAGE_KEY");
    expect(sidepanel).toContain("browser.storage.session");
    expect(sidepanel).toContain(".finally(() => refreshActiveHost(true))");
    expect(background).toContain(
      "const savedTab = browser.storage.session.set",
    );
    expect(
      background.indexOf("const savedTab = browser.storage.session.set"),
    ).toBeLessThan(background.indexOf("const panelOpening"));
    expect(background).toContain(
      "await Promise.all([savedTab, configured, panelOpening])",
    );
    expect(sidepanel).toContain("panelTabId.current = message.tabId");
    expect(sidepanel).toContain("pageFilteringExpected.current");
    expect(sidepanel).not.toContain("browser.runtime.openOptionsPage");
    expect(sidepanel).not.toContain("manageAll");
    expect(sidepanel).toContain('variant="ghost"');
    expect(sidepanel).not.toContain("sidepanelCurrentPage");
    expect(sidepanel).not.toContain("data-manage-settings");
    expect(sidepanel).not.toContain("value={selectedSite}");
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

  it("再生回数といいね数の候補・入力欄をまとめ、集計説明を末尾に置く", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");
    expect(sidepanel.match(/<section data-minimum-group="">/g)).toHaveLength(2);
    expect(sidepanel.match(/<\/MetricThresholdSuggestions>/g)).toHaveLength(2);
    const suggestions = sidepanel.slice(
      sidepanel.indexOf("function MetricThresholdSuggestions"),
      sidepanel.indexOf("function EditableNumberInput"),
    );
    expect(suggestions.indexOf("suggestions.map")).toBeLessThan(
      suggestions.indexOf('data-manual-minimum=""'),
    );
    expect(suggestions.indexOf('data-manual-minimum=""')).toBeLessThan(
      suggestions.indexOf("{scopeText}"),
    );
    expect(suggestions).not.toContain("return null");
  });

  it("サイドパネルの絞り込み項目を一列に並べる", () => {
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
    expect(group).toContain("disabled={!filteringIsAvailable}");
    expect(group).not.toContain('t("optionsSectionDisplayConditions")');
    expect(group.match(/t\("optionsSectionExclude"\)/g)).toHaveLength(2);
    expect(group).not.toContain("data-master-filter");
    expect(group).not.toContain("sidepanelFiltering");
    expect(group).not.toContain("divide-y");
    expect(group).not.toContain("<SettingsGroup");
  });

  it("パネルから全サイト設定を確認付きで既定値へ戻せる", () => {
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

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
    const sidepanel = readEntrypoint("entrypoints/sidepanel/sidepanel-app.tsx");

    expect(config).toContain('"activeTab"');
    expect(sidepanel).toContain("context?.site ?? null");
  });
});
