import {
  CalendarClock,
  Eye,
  Heart,
  Image,
  ListFilter,
  LockKeyhole,
  type LucideIcon,
  MessageCircle,
  Quote,
  Repeat2,
  TextCursorInput,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  shouldDisablePreviousFiltering,
  shouldEnableFiltering,
} from "../../utils/filter-activation.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../../utils/filter-context.ts";
import { t } from "../../utils/i18n.ts";
import {
  type MetricAggregationAge,
  metricAggregationScope,
} from "../../utils/metric-aggregation-scope.ts";
import { metricThresholdSuggestions } from "../../utils/metric-threshold-suggestions.ts";
import {
  defaults,
  type MetricSiteSettings,
  normalizeSettings,
  type PublicationAgeUnit,
  type ReactionSiteSettings,
  type Settings,
  type SiteSettingsKey,
  settingsFor,
  withSiteSettings,
  type YouTubeSiteSettings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import {
  isSidePanelTabId,
  isSidePanelTabRequest,
  SIDE_PANEL_TAB_STORAGE_KEY,
} from "../../utils/sidepanel-controls.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";
import { Button } from "./components/ui/button.tsx";
import { Card, CardContent } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";
import { Switch } from "./components/ui/switch.tsx";

export function SidepanelApp(): React.JSX.Element {
  const resetDialog = useRef<HTMLDialogElement>(null);
  const resetCancel = useRef<HTMLButtonElement>(null);
  const [resetAllSites, setResetAllSites] = useState(false);
  const [resetSite, setResetSite] = useState<SiteSettingsKey | null>(null);
  const [settings, setSettings] = useState<Settings>(
    normalizeSettings(defaults),
  );
  const [status, setStatus] = useState(t("optionsStatusLoading"));
  const [activeContext, setActiveContext] =
    useState<FilterContextResponse | null>(null);
  const [activeSite, setActiveSite] = useState<SiteSettingsKey | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteSettingsKey>("x");
  const followActiveContext = useRef(true);
  const settingsRef = useRef(settings);
  const activePageRef = useRef<{ tabId: number; pageKey: string } | null>(null);
  const panelTabId = useRef<number | null>(null);
  const panelInitialized = useRef(false);
  const initializedMinimums = useRef(new Set<SiteSettingsKey>());
  const [manualSites, setManualSites] = useState<
    Partial<Record<SiteSettingsKey, boolean>>
  >({});
  const [pageFilteringEnabled, setPageFilteringEnabled] = useState(false);
  const pageFilteringExpected = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const updateSettings = (storedSettings: Settings): void => {
      setSettings(normalizeSettings(storedSettings));
      setStatus("");
    };

    void settingsItem
      .getValue()
      .then(updateSettings)
      .catch(() => setStatus(t("optionsErrorLoadFailed")));

    return settingsItem.watch(updateSettings);
  }, []);

  useEffect(
    () => () => {
      const activePage = activePageRef.current;
      if (activePage !== null) {
        void browser.tabs
          .sendMessage(activePage.tabId, {
            type: TIMELINE_CONTROL.setFiltering,
            enabled: false,
          })
          .catch(() => {});
      }
    },
    [],
  );

  const saveSettings = (next: Settings): void => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    void settingsItem
      .setValue(normalized)
      .then(() => {
        updateFiltering(true);
      })
      .catch(() => setStatus(t("optionsErrorSaveFailed")));
  };

  const resetSettings = (): void => {
    if (!resetDialog.current?.open) return;
    if (!resetAllSites && resetSite === null) return;
    resetDialog.current.close();
    if (resetAllSites) {
      setManualSites({});
      saveSettings(defaults);
    } else if (resetSite !== null) {
      setManualSites((sites) => ({ ...sites, [resetSite]: false }));
      saveSettings(
        withSiteSettings(
          settingsRef.current,
          resetSite,
          settingsFor(defaults, resetSite),
        ),
      );
    }
  };

  useEffect(() => {
    const refreshActiveHost = async (forceSelection = false): Promise<void> => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      try {
        if (panelTabId.current === null && tab?.id !== undefined) {
          panelTabId.current = tab.id;
        }
        const panelTabMatches = panelTabId.current === tab?.id;
        if (!panelTabMatches) {
          const previousPage = activePageRef.current;
          if (previousPage !== null) {
            void browser.tabs
              .sendMessage(previousPage.tabId, {
                type: TIMELINE_CONTROL.setFiltering,
                enabled: false,
              })
              .catch(() => {});
          }
          activePageRef.current = null;
          pageFilteringExpected.current = false;
          setPageFilteringEnabled(false);
          setActiveContext(null);
          setActiveSite(null);
          return;
        }
        let context: FilterContextResponse | null = null;
        if (tab?.id !== undefined) {
          context = await browser.tabs
            .sendMessage(tab.id, { type: FILTER_CONTEXT_REQUEST })
            .then((response) =>
              isFilterContextResponse(response) ? response : null,
            )
            .catch(() => null);
        }
        const nextPage =
          tab?.id !== undefined && context?.timelineAvailable
            ? { tabId: tab.id, pageKey: context.pageKey }
            : null;
        const previousPage = activePageRef.current;
        const pageChanged =
          previousPage !== null &&
          (nextPage === null ||
            previousPage.tabId !== nextPage.tabId ||
            previousPage.pageKey !== nextPage.pageKey);
        if (
          previousPage !== null &&
          shouldDisablePreviousFiltering({
            pageChanged,
            previousTabId: previousPage.tabId,
            nextTabId: nextPage?.tabId ?? null,
          })
        ) {
          void browser.tabs
            .sendMessage(previousPage.tabId, {
              type: TIMELINE_CONTROL.setFiltering,
              enabled: false,
            })
            .catch(() => {});
        }
        if (
          context !== null &&
          !initializedMinimums.current.has(context.site)
        ) {
          initializedMinimums.current.add(context.site);
          try {
            const stored = normalizeSettings(await settingsItem.getValue());
            const siteSettings = settingsFor(stored, context.site);
            const next = withSiteSettings(
              stored,
              context.site,
              siteSettings.kind === "reactions"
                ? { ...siteSettings, minReactionsEnabled: false }
                : { ...siteSettings, minCountEnabled: false },
            );
            await settingsItem.setValue(next);
            setSettings(next);
          } catch (error) {
            initializedMinimums.current.delete(context.site);
            throw error;
          }
        }
        const enableFiltering = shouldEnableFiltering({
          contentFilteringEnabled: context?.filteringEnabled ?? false,
          hasNextPage: nextPage !== null,
          panelTabMatches,
          panelExpectedFiltering: pageFilteringExpected.current,
          panelInitialized: panelInitialized.current,
        });
        if (enableFiltering && nextPage !== null) {
          void browser.tabs
            .sendMessage(nextPage.tabId, {
              type: TIMELINE_CONTROL.setFiltering,
              enabled: true,
            })
            .catch(() => {});
          pageFilteringExpected.current = true;
          setPageFilteringEnabled(true);
        } else if (nextPage === null) {
          // 未接続や対象外ページへの一時的な遷移では、ユーザーの設定を変えない。
          setPageFilteringEnabled(false);
        } else {
          pageFilteringExpected.current = context?.filteringEnabled ?? false;
          setPageFilteringEnabled(context?.filteringEnabled ?? false);
        }
        if (nextPage !== null) {
          panelInitialized.current = true;
        }
        activePageRef.current = nextPage;
        setActiveContext(context);
        const site = context?.site ?? null;
        setActiveSite(site);
        if (site !== null && (forceSelection || followActiveContext.current)) {
          followActiveContext.current = true;
          setSelectedSite(site);
        }
      } catch {}
    };

    const handleTabActivated = () => void refreshActiveHost(true);
    const handleTabUpdated = (
      tabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
    ): void => {
      if (changeInfo.url !== undefined) {
        void browser.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab?.id === tabId) {
              void refreshActiveHost(true);
            }
          });
      }
    };
    const handlePanelTab = (message: unknown): void => {
      if (!isSidePanelTabRequest(message)) {
        return;
      }
      const previousPage = activePageRef.current;
      if (previousPage !== null && previousPage.tabId !== message.tabId) {
        void browser.tabs
          .sendMessage(previousPage.tabId, {
            type: TIMELINE_CONTROL.setFiltering,
            enabled: false,
          })
          .catch(() => {});
      }
      if (panelTabId.current !== message.tabId) {
        activePageRef.current = null;
        pageFilteringExpected.current = false;
        panelInitialized.current = false;
      }
      panelTabId.current = message.tabId;
      void refreshActiveHost(true);
    };
    void browser.storage.session
      .get(SIDE_PANEL_TAB_STORAGE_KEY)
      .then((stored) => {
        const tabId = stored[SIDE_PANEL_TAB_STORAGE_KEY];
        if (isSidePanelTabId(tabId)) {
          panelTabId.current = tabId;
        }
      })
      .catch(() => {})
      .finally(() => refreshActiveHost(true));
    const contextTimer = window.setInterval(() => {
      void refreshActiveHost();
    }, 750);
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.runtime.onMessage.addListener(handlePanelTab);
    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      browser.runtime.onMessage.removeListener(handlePanelTab);
      window.clearInterval(contextTimer);
    };
  }, []);

  const selectedSettings = settingsFor(settings, selectedSite);
  const manualActive = manualSites[selectedSite] === true;
  const manualMinimum =
    selectedSettings.manualMinimum ??
    (selectedSettings.kind === "metric"
      ? selectedSettings.minCount
      : selectedSettings.minReactions);
  const filteringEnabled = pageFilteringEnabled;

  const updateFiltering = (enabled: boolean): void => {
    const activePage = activePageRef.current;
    if (activePage === null) {
      return;
    }
    pageFilteringExpected.current = enabled;
    setPageFilteringEnabled(enabled);
    void browser.tabs
      .sendMessage(activePage.tabId, {
        type: TIMELINE_CONTROL.setFiltering,
        enabled,
      })
      .catch(() => {
        pageFilteringExpected.current = false;
        setPageFilteringEnabled(false);
      });
  };

  const saveSiteSettings = (
    site: SiteSettingsKey,
    nextSiteSettings:
      | ReactionSiteSettings
      | MetricSiteSettings
      | YouTubeSiteSettings,
  ): void => {
    saveSettings(withSiteSettings(settings, site, nextSiteSettings));
  };

  const updateReactionSetting = <Key extends keyof ReactionSiteSettings>(
    key: Key,
    value: ReactionSiteSettings[Key],
  ): void => {
    if (selectedSettings.kind === "reactions") {
      saveSiteSettings(selectedSite, { ...selectedSettings, [key]: value });
    }
  };

  const setManualMinimum = (value: number, enabled: boolean): void => {
    saveSiteSettings(
      selectedSite,
      selectedSettings.kind === "metric"
        ? {
            ...selectedSettings,
            manualMinimum: value,
            ...(enabled ? { minCount: value, minCountEnabled: true } : {}),
          }
        : {
            ...selectedSettings,
            manualMinimum: value,
            ...(enabled
              ? { minReactions: value, minReactionsEnabled: true }
              : {}),
          },
    );
  };

  const toggleManualMinimum = (enabled: boolean): void => {
    setManualSites((sites) => ({ ...sites, [selectedSite]: enabled }));
    if (enabled) setManualMinimum(manualMinimum, true);
    else
      saveSiteSettings(
        selectedSite,
        selectedSettings.kind === "metric"
          ? { ...selectedSettings, minCountEnabled: false }
          : { ...selectedSettings, minReactionsEnabled: false },
      );
  };

  const updateMetricSetting = <Key extends keyof MetricSiteSettings>(
    key: Key,
    value: MetricSiteSettings[Key],
  ): void => {
    if (selectedSettings.kind === "metric") {
      saveSiteSettings(selectedSite, { ...selectedSettings, [key]: value });
    }
  };

  const currentPageIsEditable = activeSite === selectedSite;
  const filteringIsAvailable =
    activeContext?.timelineAvailable === true &&
    activeContext.site === selectedSite;
  const pageIsUnsupported =
    !currentPageIsEditable ||
    (activeContext !== null && !activeContext.timelineAvailable);

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      data-sift-sidepanel=""
    >
      <div className="relative mx-auto flex min-h-screen max-w-xl flex-col p-6">
        <div data-filter-controls="">
          {pageIsUnsupported && activeSite !== "youtube" && (
            <div className="text-sm leading-6 text-muted-foreground">
              {t("sidepanelStatusUnavailable")}
            </div>
          )}
          {pageIsUnsupported && activeSite === "youtube" && (
            <div className="text-sm leading-6 text-muted-foreground">
              <p className="m-0">{t("sidepanelYouTubeUnsupportedTitle")}</p>
              <div className="mt-6">
                <p className="m-0 font-medium">
                  {t("sidepanelYouTubeSupportedPagesTitle")}
                </p>
                <ul className="mb-0 mt-3 list-disc space-y-1 pl-5">
                  <li>{t("sidepanelYouTubeSupportedSearchResults")}</li>
                  <li>{t("sidepanelYouTubeSupportedSubscriptions")}</li>
                  <li>{t("sidepanelYouTubeSupportedChannelVideos")}</li>
                  <li>{t("sidepanelYouTubeSupportedChannelSearch")}</li>
                </ul>
              </div>
            </div>
          )}
          {currentPageIsEditable && !pageIsUnsupported && (
            <fieldset
              className="m-0 min-w-0 space-y-7 border-0 p-0 disabled:opacity-60"
              disabled={!filteringIsAvailable}
            >
              <div>
                {selectedSettings.kind === "metric" ? (
                  <>
                    <section data-minimum-group="">
                      <h2 className="m-0 pb-3 text-sm font-medium">
                        <ItemLabel icon={Eye}>{t("optionsMinViews")}</ItemLabel>
                      </h2>
                      <MetricThresholdSuggestions
                        selectionEnabled={
                          !manualActive && selectedSettings.minCountEnabled
                        }
                        currentMinimum={selectedSettings.minCount}
                        metricCounts={activeContext?.metricCounts ?? []}
                        metricCreatedAtMs={
                          activeContext?.metricCreatedAtMs ?? []
                        }
                        onSelect={(minimum) => {
                          setManualSites((sites) => ({
                            ...sites,
                            [selectedSite]: false,
                          }));
                          saveSiteSettings(selectedSite, {
                            ...selectedSettings,
                            manualMinimum,
                            minCount: minimum,
                            minCountEnabled: true,
                          });
                        }}
                      >
                        <ThresholdSetting
                          enabled={
                            manualActive && selectedSettings.minCountEnabled
                          }
                          label={t("optionsManualMinimum")}
                          min={0}
                          onEnabledChange={toggleManualMinimum}
                          onValueChange={(value) =>
                            setManualMinimum(value, manualActive)
                          }
                          suffix={t("optionsUnitViews")}
                          value={manualMinimum}
                        />
                      </MetricThresholdSuggestions>
                    </section>
                    <section data-filter-section="">
                      <h2>
                        <ItemLabel icon={ListFilter}>
                          {t("optionsSectionExclude")}
                        </ItemLabel>
                      </h2>
                      <NewerVideosSetting
                        enabled={selectedSettings.hidePublishedWithinEnabled}
                        unit={selectedSettings.hidePublishedWithinUnit}
                        value={selectedSettings.hidePublishedWithinValue}
                        onChange={(
                          hidePublishedWithinEnabled,
                          hidePublishedWithinUnit,
                        ) =>
                          saveSiteSettings(selectedSite, {
                            ...selectedSettings,
                            hidePublishedWithinEnabled,
                            hidePublishedWithinUnit,
                          })
                        }
                        onValueChange={(value) =>
                          updateMetricSetting("hidePublishedWithinValue", value)
                        }
                      />
                      {selectedSite === "youtube" &&
                        isYouTubeSiteSettings(selectedSettings) && (
                          <MembersOnlySetting
                            enabled={selectedSettings.hideMembersOnly}
                            onEnabledChange={(value) =>
                              saveSiteSettings(selectedSite, {
                                ...selectedSettings,
                                hideMembersOnly: value,
                              })
                            }
                          />
                        )}
                    </section>
                  </>
                ) : (
                  <>
                    <section data-minimum-group="">
                      <h2 className="m-0 pb-3 text-sm font-medium">
                        <ItemLabel icon={Heart}>
                          {t("optionsMinLikes")}
                        </ItemLabel>
                      </h2>
                      <MetricThresholdSuggestions
                        kind="reactions"
                        selectionEnabled={
                          !manualActive && selectedSettings.minReactionsEnabled
                        }
                        currentMinimum={selectedSettings.minReactions}
                        metricCounts={activeContext?.metricCounts ?? []}
                        metricCreatedAtMs={
                          activeContext?.metricCreatedAtMs ?? []
                        }
                        onSelect={(minimum) => {
                          setManualSites((sites) => ({
                            ...sites,
                            [selectedSite]: false,
                          }));
                          saveSiteSettings(selectedSite, {
                            ...selectedSettings,
                            manualMinimum,
                            minReactions: minimum,
                            minReactionsEnabled: true,
                          });
                        }}
                      >
                        <ThresholdSetting
                          enabled={
                            manualActive && selectedSettings.minReactionsEnabled
                          }
                          label={t("optionsManualMinimum")}
                          min={0}
                          onEnabledChange={toggleManualMinimum}
                          onValueChange={(value) =>
                            setManualMinimum(value, manualActive)
                          }
                          value={manualMinimum}
                        />
                      </MetricThresholdSuggestions>
                    </section>
                  </>
                )}
                {selectedSettings.kind === "reactions" && (
                  <MediaSetting
                    enabled={selectedSettings.mediaEnabled}
                    mode={selectedSettings.mediaMode}
                    onChange={(mediaEnabled, mediaMode) =>
                      saveSiteSettings(selectedSite, {
                        ...selectedSettings,
                        mediaEnabled,
                        mediaMode,
                      })
                    }
                  />
                )}
              </div>

              {selectedSettings.kind === "reactions" && (
                <section data-filter-section="">
                  <h2>
                    <ItemLabel icon={ListFilter}>
                      {t("optionsSectionExclude")}
                    </ItemLabel>
                  </h2>
                  <SettingRow
                    icon={MessageCircle}
                    label={t("optionsHideReplies")}
                  >
                    <Switch
                      checked={selectedSettings.hideReplies}
                      onCheckedChange={(value) =>
                        updateReactionSetting("hideReplies", value)
                      }
                    />
                  </SettingRow>
                  <SettingRow icon={Quote} label={t("optionsHideQuotes")}>
                    <Switch
                      checked={selectedSettings.hideQuotes}
                      onCheckedChange={(value) =>
                        updateReactionSetting("hideQuotes", value)
                      }
                    />
                  </SettingRow>
                  <SettingRow icon={Repeat2} label={t("optionsHideReposts")}>
                    <Switch
                      checked={selectedSettings.hideReposts}
                      onCheckedChange={(value) =>
                        updateReactionSetting("hideReposts", value)
                      }
                    />
                  </SettingRow>
                </section>
              )}
            </fieldset>
          )}
        </div>

        {filteringEnabled && activeContext?.continuousLoadingWarning && (
          <Card className="mb-6 mt-3 border-amber-500/60 bg-amber-50/70 dark:bg-amber-950/20">
            <CardContent className="space-y-3 p-4 text-sm leading-6">
              <div>
                <p className="m-0 font-medium">
                  {t("continuousLoadingWarningTitle")}
                </p>
                <p className="m-0 mt-1 text-muted-foreground">
                  {t("continuousLoadingWarningDescription")}
                </p>
              </div>
              <Button className="w-full" onClick={() => updateFiltering(false)}>
                {t("continuousLoadingWarningDisable")}
              </Button>
            </CardContent>
          </Card>
        )}

        <footer className="mt-auto flex justify-end pt-8">
          <Button
            onClick={() => {
              setResetAllSites(false);
              setResetSite(activeSite);
              resetDialog.current?.showModal();
              resetCancel.current?.focus();
            }}
            variant="ghost"
            size="sm"
          >
            {t("optionsResetSettings")}
          </Button>
        </footer>

        <dialog
          ref={resetDialog}
          data-reset-dialog=""
          aria-labelledby="reset-title"
          aria-describedby="reset-description"
        >
          <h2 id="reset-title">{t("optionsResetSettings")}</h2>
          <p id="reset-description">
            {resetAllSites
              ? t("optionsResetConfirm")
              : resetSite === null
                ? t("optionsResetNoSite")
                : t("optionsResetSiteConfirm", {
                    site: {
                      x: "X",
                      bluesky: "Bluesky",
                      youtube: "YouTube",
                      niconico: "ニコニコ動画",
                    }[resetSite],
                  })}
          </p>
          <label className="mb-6 flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              checked={resetAllSites}
              onChange={(event) => setResetAllSites(event.target.checked)}
            />
            {t("optionsResetAllSites")}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              ref={resetCancel}
              variant="outline"
              onClick={() => resetDialog.current?.close()}
            >
              {t("optionsResetCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={resetSettings}
              disabled={!resetAllSites && resetSite === null}
            >
              {t("optionsResetAction")}
            </Button>
          </div>
        </dialog>

        {status && (
          <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
            {status}
          </p>
        )}
      </div>
    </main>
  );
}

function isYouTubeSiteSettings(
  settings: ReactionSiteSettings | MetricSiteSettings | YouTubeSiteSettings,
): settings is YouTubeSiteSettings {
  return "hideMembersOnly" in settings;
}

function ItemLabel({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

function SettingRow({
  children,
  label,
  icon,
}: {
  children: React.ReactNode;
  label: string;
  icon?: LucideIcon;
}): React.JSX.Element {
  return (
    <div
      className="flex min-h-16 flex-col items-stretch gap-3 p-5 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between min-[360px]:gap-5 sm:px-6"
      data-setting-row=""
    >
      <span className="min-w-0 text-sm">
        {icon ? <ItemLabel icon={icon}>{label}</ItemLabel> : label}
      </span>
      <div className="shrink-0 self-end min-[360px]:self-auto">{children}</div>
    </div>
  );
}

function ThresholdSetting({
  enabled,
  label,
  min,
  onEnabledChange,
  onValueChange,
  suffix,
  value,
}: {
  enabled: boolean;
  label: string;
  min: number;
  onEnabledChange: (value: boolean) => void;
  onValueChange: (value: number) => void;
  suffix?: string;
  value: number;
}): React.JSX.Element {
  const controls = (
    <div className="flex items-center gap-3">
      <EditableNumberInput
        ariaLabel={label}
        min={min}
        value={value}
        onValueChange={onValueChange}
      />
      {suffix && (
        <span className="text-sm text-muted-foreground">{suffix}</span>
      )}
      <Switch
        aria-label={label}
        checked={enabled}
        onCheckedChange={onEnabledChange}
      />
    </div>
  );
  return (
    <SettingRow icon={TextCursorInput} label={label}>
      {controls}
    </SettingRow>
  );
}

function MetricThresholdSuggestions({
  children,
  selectionEnabled,
  kind = "metric",
  currentMinimum,
  metricCounts,
  metricCreatedAtMs,
  onSelect,
}: {
  children: React.ReactNode;
  selectionEnabled: boolean;
  kind?: "metric" | "reactions";
  currentMinimum: number;
  metricCounts: readonly number[];
  metricCreatedAtMs: readonly number[];
  onSelect: (minimum: number) => void;
}): React.JSX.Element {
  const suggestions = metricThresholdSuggestions(metricCounts, currentMinimum);

  const formatter = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const scope = metricAggregationScope(metricCreatedAtMs, Date.now());

  function formatAge(age: MetricAggregationAge): string {
    const key =
      age.unit === "day"
        ? "sidepanelMinimumSuggestionAgeDays"
        : age.unit === "month"
          ? "sidepanelMinimumSuggestionAgeMonths"
          : "sidepanelMinimumSuggestionAgeYears";
    return t(key, { count: formatter.format(age.value) });
  }

  const scopeText = scope
    ? t(
        kind === "reactions"
          ? "sidepanelLikeSuggestionScope"
          : "sidepanelMinimumSuggestionScope",
        {
          count: formatter.format(metricCounts.length),
          oldest: formatAge(scope.oldest),
        },
      )
    : t(
        kind === "reactions"
          ? "sidepanelLikeSuggestionScopeWithoutDates"
          : "sidepanelMinimumSuggestionScopeWithoutDates",
        {
          count: formatter.format(metricCounts.length),
        },
      );

  return (
    <div data-threshold-suggestions="">
      <div className="flex flex-col gap-2">
        {suggestions.map((suggestion) => {
          const selected =
            selectionEnabled && suggestion.minimum === currentMinimum;
          return (
            <Button
              aria-pressed={selected}
              key={suggestion.minimum}
              onClick={() => onSelect(suggestion.minimum)}
              size="sm"
              className="justify-between"
              variant={selected ? "default" : "outline"}
            >
              <span>
                {formatter.format(suggestion.minimum)}
                {t(
                  kind === "reactions"
                    ? "sidepanelLikeSuggestionMinimumSuffix"
                    : "sidepanelMinimumSuggestionMinimumSuffix",
                )}
              </span>
              <span
                className={
                  selected
                    ? "text-primary-foreground/75"
                    : "text-muted-foreground"
                }
              >
                {formatter.format(suggestion.count)}
                {t(
                  kind === "reactions"
                    ? "sidepanelLikeSuggestionCountSuffix"
                    : "sidepanelMinimumSuggestionCountSuffix",
                )}
              </span>
            </Button>
          );
        })}
      </div>
      <div data-manual-minimum="">{children}</div>
      {suggestions.length > 0 && (
        <p className="mb-0 mt-3 text-xs leading-5 text-muted-foreground">
          {scopeText}
        </p>
      )}
    </div>
  );
}

function EditableNumberInput({
  ariaLabel,
  className = "w-24",
  disabled = false,
  min,
  onValueChange,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  min: number;
  onValueChange: (value: number) => void;
  value: number;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setDraft(String(value));
    }
  }, [value]);

  const commit = (): void => {
    editing.current = false;
    if (draft.trim() === "") {
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isSafeInteger(parsed)) {
      setDraft(String(value));
      return;
    }
    const nextValue = Math.max(min, parsed);
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
  };

  return (
    <Input
      aria-label={ariaLabel}
      className={`${className} text-right tabular-nums`}
      disabled={disabled}
      type="number"
      inputMode="numeric"
      min={min}
      step={1}
      value={draft}
      onFocus={(event) => {
        editing.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const rawValue = event.currentTarget.value;
        setDraft(rawValue);
        const nextValue = event.currentTarget.valueAsNumber;
        if (Number.isSafeInteger(nextValue) && nextValue >= min) {
          onValueChange(nextValue);
        }
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function MembersOnlySetting({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}): React.JSX.Element {
  const label = t("optionsHideMembersOnly");
  return (
    <SettingRow icon={LockKeyhole} label={label}>
      <Switch
        aria-label={label}
        checked={enabled}
        onCheckedChange={onEnabledChange}
      />
    </SettingRow>
  );
}

function NewerVideosSetting({
  enabled,
  onChange,
  onValueChange,
  unit,
  value,
}: {
  enabled: boolean;
  onChange: (enabled: boolean, unit: PublicationAgeUnit) => void;
  onValueChange: (value: number) => void;
  unit: PublicationAgeUnit;
  value: number;
}): React.JSX.Element {
  return (
    <fieldset
      data-publication-age=""
      aria-label={t("optionsHidePublishedWithin")}
    >
      <div
        className="flex items-center justify-between gap-2"
        data-setting-row=""
      >
        <span className="text-sm">
          <ItemLabel icon={CalendarClock}>
            {t("optionsHidePublishedWithin")}
          </ItemLabel>
        </span>
        <Switch
          className="shrink-0"
          aria-label={t("optionsHidePublishedWithin")}
          checked={enabled}
          onCheckedChange={(nextEnabled) => onChange(nextEnabled, unit)}
        />
      </div>
      <div
        className="flex min-w-0 flex-wrap items-center gap-1.5"
        data-publication-age-inputs=""
      >
        <span className="shrink-0 text-sm">
          {t("optionsPublicationAgePrefix")}
        </span>
        <EditableNumberInput
          ariaLabel={t("optionsPublicationAgeValue")}
          className="w-14 px-2"
          min={1}
          onValueChange={onValueChange}
          value={value}
        />
        <Select
          value={unit}
          onValueChange={(nextValue) =>
            onChange(enabled, nextValue as PublicationAgeUnit)
          }
        >
          <SelectTrigger
            aria-label={t("optionsPublicationAgeUnit")}
            className="w-auto min-w-16 gap-1 px-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hour">
              {t("optionsPublicationAgeHours")}
            </SelectItem>
            <SelectItem value="day">
              {t("optionsPublicationAgeDays")}
            </SelectItem>
            <SelectItem value="week">
              {t("optionsPublicationAgeWeeks")}
            </SelectItem>
            <SelectItem value="month">
              {t("optionsPublicationAgeMonths")}
            </SelectItem>
            <SelectItem value="year">
              {t("optionsPublicationAgeYears")}
            </SelectItem>
          </SelectContent>
        </Select>
        <span className="shrink-0 text-sm text-muted-foreground">
          {t("optionsHidePublishedWithinSuffix")}
        </span>
      </div>
    </fieldset>
  );
}

function MediaSetting({
  enabled,
  mode,
  onChange,
}: {
  enabled: boolean;
  mode: ReactionSiteSettings["mediaMode"];
  onChange: (enabled: boolean, mode: ReactionSiteSettings["mediaMode"]) => void;
}): React.JSX.Element {
  return (
    <section data-filter-section="">
      <h2>
        <ItemLabel icon={Image}>{t("optionsMedia")}</ItemLabel>
      </h2>
      <Select
        value={enabled ? mode : "none"}
        onValueChange={(nextMode) =>
          onChange(
            nextMode !== "none",
            nextMode === "none"
              ? mode
              : (nextMode as ReactionSiteSettings["mediaMode"]),
          )
        }
      >
        <SelectTrigger className="w-40" aria-label={t("optionsMedia")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("optionsMediaNone")}</SelectItem>
          <SelectItem value="any">{t("optionsMediaAny")}</SelectItem>
          <SelectItem value="images">{t("optionsMediaImages")}</SelectItem>
          <SelectItem value="video">{t("optionsMediaVideo")}</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}
