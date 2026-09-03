import { Settings as SettingsIcon } from "lucide-react";
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
  defaults,
  type MetricSiteSettings,
  normalizeSettings,
  type PublicationPeriodUnit,
  type ReactionSiteSettings,
  type Settings,
  type SiteSettingsKey,
  settingsFor,
  withSiteSettings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";
import { Button } from "../options/components/ui/button.tsx";
import { Card, CardContent } from "../options/components/ui/card.tsx";
import { Input } from "../options/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../options/components/ui/select.tsx";
import { Switch } from "../options/components/ui/switch.tsx";

const REPOSITORY_URL = "https://github.com/apricot-cake/sift";
const SITE_LABELS: Readonly<Record<SiteSettingsKey, string>> = Object.freeze({
  x: "X",
  bluesky: "Bluesky",
  youtube: "YouTube",
  niconico: "ニコニコ動画",
});
const SITE_KEYS = Object.freeze(Object.keys(SITE_LABELS) as SiteSettingsKey[]);
export function SidepanelApp({
  manageAll = false,
}: {
  manageAll?: boolean;
}): React.JSX.Element {
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
  const panelInitialized = useRef(false);
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
      if (!manageAll && activePage !== null) {
        void browser.tabs
          .sendMessage(activePage.tabId, {
            type: TIMELINE_CONTROL.setFiltering,
            enabled: false,
          })
          .catch(() => {});
      }
    },
    [manageAll],
  );

  const saveSettings = (next: Settings): void => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    void settingsItem
      .setValue(normalized)
      .catch(() => setStatus(t("optionsErrorSaveFailed")));
  };

  const resetSettings = (): void => {
    if (!window.confirm(t("optionsResetConfirm"))) {
      return;
    }
    saveSettings(defaults);
  };

  useEffect(() => {
    if (manageAll) {
      return;
    }
    const refreshActiveHost = async (forceSelection = false): Promise<void> => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      try {
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
          tab?.id !== undefined && context !== null
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
        const enableFiltering = shouldEnableFiltering({
          contentFilteringEnabled: context?.filteringEnabled ?? false,
          hasNextPage: nextPage !== null,
          hasPreviousPage: previousPage !== null,
          pageChanged,
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
          pageFilteringExpected.current = false;
          setPageFilteringEnabled(false);
        } else {
          pageFilteringExpected.current = context?.filteringEnabled ?? false;
          setPageFilteringEnabled(context?.filteringEnabled ?? false);
        }
        panelInitialized.current = true;
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
    void refreshActiveHost(true);
    const contextTimer = window.setInterval(() => {
      void refreshActiveHost();
    }, 750);
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      window.clearInterval(contextTimer);
    };
  }, [manageAll]);

  const selectedSettings = settingsFor(settings, selectedSite);
  const filteringEnabled = manageAll || pageFilteringEnabled;

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
    nextSiteSettings: ReactionSiteSettings | MetricSiteSettings,
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

  const updateMetricSetting = <Key extends keyof MetricSiteSettings>(
    key: Key,
    value: MetricSiteSettings[Key],
  ): void => {
    if (selectedSettings.kind === "metric") {
      saveSiteSettings(selectedSite, { ...selectedSettings, [key]: value });
    }
  };

  const currentPageIsEditable = manageAll || activeSite === selectedSite;
  const filteringIsAvailable =
    activeContext !== null && activeContext.site === selectedSite;

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      data-sift-sidepanel={manageAll ? undefined : ""}
    >
      <div
        className={`relative mx-auto px-5 py-6 ${manageAll ? "max-w-lg" : "max-w-xl"}`}
      >
        {manageAll && (
          <header className="mb-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg border bg-card shadow-sm">
                <img alt="" className="size-8" src="/icon-48.png" />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">Sift</h1>
            </div>
            <a
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
              href={REPOSITORY_URL}
              rel="noreferrer"
              target="_blank"
            >
              {t("optionsRepository")}
            </a>
          </header>
        )}
        {!manageAll && (
          <Button
            aria-label={t("sidepanelManageSettings")}
            className="absolute right-4 top-2 z-10"
            data-manage-settings=""
            onClick={() => void browser.runtime.openOptionsPage()}
            size="icon"
            title={t("sidepanelManageSettings")}
            variant="ghost"
          >
            <SettingsIcon className="size-4" aria-hidden="true" />
          </Button>
        )}

        {!manageAll && (
          <div className="mt-7" data-filter-controls="">
            {!currentPageIsEditable && (
              <div className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                {t("sidepanelStatusUnavailable")}
              </div>
            )}
            {currentPageIsEditable && (
              <>
                {!filteringIsAvailable && (
                  <div className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                    {t("sidepanelStatusReloadRequired")}
                  </div>
                )}
                {filteringIsAvailable && !filteringEnabled && (
                  <div className="space-y-3 px-3 py-2">
                    <p className="m-0 text-sm font-medium leading-6 text-muted-foreground">
                      {t("sidepanelStatusFilteringDisabled")}
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => updateFiltering(true)}
                      variant="outline"
                    >
                      {t("sidepanelEnableFiltering")}
                    </Button>
                  </div>
                )}
                <fieldset
                  className="m-0 min-w-0 space-y-7 border-0 p-0 disabled:opacity-60"
                  disabled={!filteringIsAvailable || !filteringEnabled}
                >
                  <div>
                    {selectedSettings.kind === "metric" ? (
                      <>
                        <ThresholdSetting
                          enabled={selectedSettings.minCountEnabled}
                          label={t("optionsMinViews")}
                          min={0}
                          onEnabledChange={(value) =>
                            updateMetricSetting("minCountEnabled", value)
                          }
                          onValueChange={(value) =>
                            updateMetricSetting("minCount", value)
                          }
                          suffix={t("optionsUnitViews")}
                          value={selectedSettings.minCount}
                        />
                        <PublicationPeriodSetting
                          enabled={selectedSettings.publishedWithinEnabled}
                          unit={selectedSettings.publishedWithinUnit}
                          value={selectedSettings.publishedWithinValue}
                          onChange={(
                            publishedWithinEnabled,
                            publishedWithinUnit,
                          ) =>
                            saveSiteSettings(selectedSite, {
                              ...selectedSettings,
                              publishedWithinEnabled,
                              publishedWithinUnit,
                            })
                          }
                          onValueChange={(value) =>
                            updateMetricSetting("publishedWithinValue", value)
                          }
                        />
                      </>
                    ) : (
                      <ThresholdSetting
                        enabled={selectedSettings.minReactionsEnabled}
                        label={t("optionsMinLikes")}
                        min={0}
                        onEnabledChange={(value) =>
                          updateReactionSetting("minReactionsEnabled", value)
                        }
                        onValueChange={(value) =>
                          updateReactionSetting("minReactions", value)
                        }
                        value={selectedSettings.minReactions}
                      />
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
                    <div>
                      <SettingRow label={t("optionsHideReplies")}>
                        <Switch
                          checked={selectedSettings.hideReplies}
                          onCheckedChange={(value) =>
                            updateReactionSetting("hideReplies", value)
                          }
                        />
                      </SettingRow>
                      <SettingRow label={t("optionsHideQuotes")}>
                        <Switch
                          checked={selectedSettings.hideQuotes}
                          onCheckedChange={(value) =>
                            updateReactionSetting("hideQuotes", value)
                          }
                        />
                      </SettingRow>
                      <SettingRow label={t("optionsHideReposts")}>
                        <Switch
                          checked={selectedSettings.hideReposts}
                          onCheckedChange={(value) =>
                            updateReactionSetting("hideReposts", value)
                          }
                        />
                      </SettingRow>
                    </div>
                  )}
                </fieldset>
              </>
            )}
          </div>
        )}

        {!manageAll &&
          filteringEnabled &&
          activeContext?.continuousLoadingWarning && (
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
                <Button
                  className="w-full"
                  onClick={() => updateFiltering(false)}
                >
                  {t("continuousLoadingWarningDisable")}
                </Button>
              </CardContent>
            </Card>
          )}

        {manageAll && (
          <div>
            <div className="space-y-12">
              {SITE_KEYS.map((site) => (
                <SiteSettingsEditor
                  key={site}
                  onSave={(next) => saveSiteSettings(site, next)}
                  settings={settingsFor(settings, site)}
                  site={site}
                />
              ))}
            </div>
            <div className="mt-12 flex justify-end pt-6">
              <Button onClick={resetSettings} variant="destructive">
                {t("optionsResetSettings")}
              </Button>
            </div>
          </div>
        )}

        {status && (
          <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
            {status}
          </p>
        )}
      </div>
    </main>
  );
}

function SiteSettingsEditor({
  onSave,
  settings,
  site,
}: {
  onSave: (settings: ReactionSiteSettings | MetricSiteSettings) => void;
  settings: ReactionSiteSettings | MetricSiteSettings;
  site: SiteSettingsKey;
}): React.JSX.Element {
  const updateReaction = <Key extends keyof ReactionSiteSettings>(
    key: Key,
    value: ReactionSiteSettings[Key],
  ): void => {
    if (settings.kind === "reactions") {
      onSave({ ...settings, [key]: value });
    }
  };
  const updateMetric = <Key extends keyof MetricSiteSettings>(
    key: Key,
    value: MetricSiteSettings[Key],
  ): void => {
    if (settings.kind === "metric") {
      onSave({ ...settings, [key]: value });
    }
  };

  return (
    <section aria-labelledby={`site-${site}`}>
      <h2
        className="mb-3 text-lg font-semibold tracking-tight text-foreground"
        id={`site-${site}`}
      >
        {SITE_LABELS[site]}
      </h2>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {settings.kind === "metric" ? (
              <>
                <ThresholdSetting
                  enabled={settings.minCountEnabled}
                  label={t("optionsMinViews")}
                  min={0}
                  onEnabledChange={(value) =>
                    updateMetric("minCountEnabled", value)
                  }
                  onValueChange={(value) => updateMetric("minCount", value)}
                  suffix={t("optionsUnitViews")}
                  value={settings.minCount}
                />
                <PublicationPeriodSetting
                  enabled={settings.publishedWithinEnabled}
                  unit={settings.publishedWithinUnit}
                  value={settings.publishedWithinValue}
                  onChange={(publishedWithinEnabled, publishedWithinUnit) =>
                    onSave({
                      ...settings,
                      publishedWithinEnabled,
                      publishedWithinUnit,
                    })
                  }
                  onValueChange={(value) =>
                    updateMetric("publishedWithinValue", value)
                  }
                />
              </>
            ) : (
              <ThresholdSetting
                enabled={settings.minReactionsEnabled}
                label={t("optionsMinLikes")}
                min={0}
                onEnabledChange={(value) =>
                  updateReaction("minReactionsEnabled", value)
                }
                onValueChange={(value) => updateReaction("minReactions", value)}
                value={settings.minReactions}
              />
            )}
            {settings.kind === "reactions" && (
              <MediaSetting
                enabled={settings.mediaEnabled}
                mode={settings.mediaMode}
                onChange={(mediaEnabled, mediaMode) =>
                  onSave({
                    ...settings,
                    mediaEnabled,
                    mediaMode,
                  })
                }
              />
            )}
          </div>

          {settings.kind === "reactions" && (
            <div className="pt-4">
              <div className="divide-y">
                <SettingRow label={t("optionsHideReplies")}>
                  <Switch
                    checked={settings.hideReplies}
                    onCheckedChange={(value) =>
                      updateReaction("hideReplies", value)
                    }
                  />
                </SettingRow>
                <SettingRow label={t("optionsHideQuotes")}>
                  <Switch
                    checked={settings.hideQuotes}
                    onCheckedChange={(value) =>
                      updateReaction("hideQuotes", value)
                    }
                  />
                </SettingRow>
                <SettingRow label={t("optionsHideReposts")}>
                  <Switch
                    checked={settings.hideReposts}
                    onCheckedChange={(value) =>
                      updateReaction("hideReposts", value)
                    }
                  />
                </SettingRow>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function SettingRow({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <div
      className="flex min-h-16 flex-col items-stretch gap-3 p-5 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between min-[360px]:gap-5 sm:px-6"
      data-setting-row=""
    >
      <span className="min-w-0 text-sm font-medium">{label}</span>
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
  return (
    <SettingRow label={label}>
      <div className="flex items-center gap-3">
        <EditableNumberInput
          disabled={!enabled}
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
    </SettingRow>
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

function PublicationPeriodSetting({
  enabled,
  onChange,
  onValueChange,
  unit,
  value,
}: {
  enabled: boolean;
  onChange: (enabled: boolean, unit: PublicationPeriodUnit) => void;
  onValueChange: (value: number) => void;
  unit: PublicationPeriodUnit;
  value: number;
}): React.JSX.Element {
  return (
    <SettingRow label={t("optionsPublicationPeriod")}>
      <div className="flex items-center gap-2">
        {enabled && (
          <EditableNumberInput
            ariaLabel={t("optionsPublicationPeriodValue")}
            className="w-16"
            min={1}
            onValueChange={onValueChange}
            value={value}
          />
        )}
        <Select
          value={enabled ? unit : "all"}
          onValueChange={(nextValue) =>
            onChange(
              nextValue !== "all",
              nextValue === "all" ? unit : (nextValue as PublicationPeriodUnit),
            )
          }
        >
          <SelectTrigger
            aria-label={t("optionsPublicationPeriodUnit")}
            className="w-36"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("optionsPublicationPeriodAll")}
            </SelectItem>
            <SelectItem value="hour">
              {t("optionsPublicationPeriodHours")}
            </SelectItem>
            <SelectItem value="day">
              {t("optionsPublicationPeriodDays")}
            </SelectItem>
            <SelectItem value="week">
              {t("optionsPublicationPeriodWeeks")}
            </SelectItem>
            <SelectItem value="month">
              {t("optionsPublicationPeriodMonths")}
            </SelectItem>
            <SelectItem value="year">
              {t("optionsPublicationPeriodYears")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </SettingRow>
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
    <SettingRow label={t("optionsMedia")}>
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
    </SettingRow>
  );
}
