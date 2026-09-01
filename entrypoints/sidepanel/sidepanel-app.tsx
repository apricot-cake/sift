import { Settings as SettingsIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
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
  type PeriodMode,
  type PeriodUnit,
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
import { Textarea } from "../options/components/ui/textarea.tsx";

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
        if (pageChanged) {
          void browser.tabs
            .sendMessage(previousPage.tabId, {
              type: TIMELINE_CONTROL.setFiltering,
              enabled: false,
            })
            .catch(() => {});
        }
        if (!panelInitialized.current && nextPage !== null) {
          void browser.tabs
            .sendMessage(nextPage.tabId, {
              type: TIMELINE_CONTROL.setFiltering,
              enabled: true,
            })
            .catch(() => {});
          setPageFilteringEnabled(true);
        } else if (pageChanged) {
          setPageFilteringEnabled(false);
        } else {
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
  const metricFilterEnabled =
    selectedSettings.kind === "metric"
      ? selectedSettings.minCountEnabled
      : selectedSettings.minReactionsEnabled;
  const filteringEnabled = manageAll || pageFilteringEnabled;

  const updateFiltering = (enabled: boolean): void => {
    const activePage = activePageRef.current;
    if (activePage === null) {
      return;
    }
    setPageFilteringEnabled(enabled);
    void browser.tabs
      .sendMessage(activePage.tabId, {
        type: TIMELINE_CONTROL.setFiltering,
        enabled,
      })
      .catch(() => setPageFilteringEnabled(false));
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
        className={`relative mx-auto px-5 py-6 ${manageAll ? "max-w-3xl" : "max-w-xl"}`}
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
          <SettingsGroup title={t("sidepanelCurrentPage")}>
            {!manageAll && !currentPageIsEditable && (
              <div className="p-5 text-sm leading-6 text-muted-foreground sm:px-6">
                {t("sidepanelStatusUnavailable")}
              </div>
            )}
            {!manageAll && currentPageIsEditable && (
              <SettingRow label={t("sidepanelFiltering")}>
                <Switch
                  checked={filteringEnabled}
                  disabled={!filteringIsAvailable}
                  onCheckedChange={updateFiltering}
                />
              </SettingRow>
            )}
            {!manageAll && currentPageIsEditable && !filteringIsAvailable && (
              <div className="p-5 text-sm leading-6 text-muted-foreground sm:px-6">
                {t("sidepanelStatusReloadRequired")}
              </div>
            )}
          </SettingsGroup>
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
        )}

        {!manageAll && (
          <fieldset
            className={`m-0 min-w-0 border-0 p-0 disabled:opacity-60 ${
              manageAll ? "md:col-start-2 md:row-start-1" : ""
            }`}
            disabled={!filteringEnabled || !currentPageIsEditable}
            hidden={!currentPageIsEditable}
          >
            <section
              className={manageAll ? "mt-12" : "mt-7"}
              aria-label={t("optionsSectionDisplayConditions")}
            >
              <div className="space-y-4">
                <Card>
                  <CardContent className="divide-y p-0">
                    <SettingRow
                      label={
                        selectedSettings.kind === "metric"
                          ? t("optionsViewsEnabled")
                          : t("optionsLikesEnabled")
                      }
                    >
                      <Switch
                        checked={metricFilterEnabled}
                        onCheckedChange={(value) =>
                          selectedSettings.kind === "metric"
                            ? updateMetricSetting("minCountEnabled", value)
                            : updateReactionSetting(
                                "minReactionsEnabled",
                                value,
                              )
                        }
                      />
                    </SettingRow>
                    {metricFilterEnabled && (
                      <>
                        <PeriodSetting
                          mode={selectedSettings.periodMode}
                          onModeChange={(value) =>
                            selectedSettings.kind === "metric"
                              ? updateMetricSetting("periodMode", value)
                              : updateReactionSetting("periodMode", value)
                          }
                          onUnitChange={(value) =>
                            selectedSettings.kind === "metric"
                              ? updateMetricSetting("periodUnit", value)
                              : updateReactionSetting("periodUnit", value)
                          }
                          onValueChange={(value) =>
                            selectedSettings.kind === "metric"
                              ? updateMetricSetting("periodValue", value)
                              : updateReactionSetting("periodValue", value)
                          }
                          unit={selectedSettings.periodUnit}
                          value={selectedSettings.periodValue}
                        />
                        {selectedSettings.kind === "metric" ? (
                          <NumberSetting
                            label={t("optionsMinViews")}
                            min={0}
                            onValueChange={(value) =>
                              updateMetricSetting("minCount", value)
                            }
                            suffix={t("optionsUnitViews")}
                            value={selectedSettings.minCount}
                          />
                        ) : (
                          <NumberSetting
                            label={t("optionsMinLikes")}
                            min={0}
                            onValueChange={(value) =>
                              updateReactionSetting("minReactions", value)
                            }
                            value={selectedSettings.minReactions}
                          />
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
                {selectedSettings.kind === "reactions" && (
                  <Card>
                    <CardContent className="divide-y p-0">
                      <SettingRow label={t("optionsMediaEnabled")}>
                        <Switch
                          checked={selectedSettings.mediaEnabled}
                          onCheckedChange={(value) =>
                            updateReactionSetting("mediaEnabled", value)
                          }
                        />
                      </SettingRow>
                      {selectedSettings.mediaEnabled && (
                        <SettingRow label={t("optionsMedia")}>
                          <Select
                            value={selectedSettings.mediaMode}
                            onValueChange={(value) =>
                              updateReactionSetting(
                                "mediaMode",
                                value as ReactionSiteSettings["mediaMode"],
                              )
                            }
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">
                                {t("optionsMediaAny")}
                              </SelectItem>
                              <SelectItem value="images">
                                {t("optionsMediaImages")}
                              </SelectItem>
                              <SelectItem value="video">
                                {t("optionsMediaVideo")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </SettingRow>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>

            {selectedSettings.kind === "reactions" && (
              <SettingsGroup
                title={t("optionsSectionExclude")}
                collapsible
                defaultOpen={manageAll}
                disabled={!filteringEnabled}
              >
                <SettingRow label={t("optionsKeywordsEnabled")}>
                  <Switch
                    checked={selectedSettings.excludedKeywordsEnabled}
                    onCheckedChange={(value) =>
                      updateReactionSetting("excludedKeywordsEnabled", value)
                    }
                  />
                </SettingRow>
                {selectedSettings.excludedKeywordsEnabled && (
                  <div className="p-5 sm:px-6">
                    <label
                      className="text-sm font-medium"
                      htmlFor="excluded-keywords"
                    >
                      {t("optionsExcludedKeywords")}
                    </label>
                    <Textarea
                      id="excluded-keywords"
                      className="mt-3"
                      placeholder={t("optionsExcludedKeywordsPlaceholder")}
                      value={selectedSettings.excludedKeywords}
                      onChange={(event) =>
                        updateReactionSetting(
                          "excludedKeywords",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </div>
                )}
                <SettingRow label={t("optionsHideReposts")}>
                  <Switch
                    checked={selectedSettings.hideReposts}
                    onCheckedChange={(value) =>
                      updateReactionSetting("hideReposts", value)
                    }
                  />
                </SettingRow>
              </SettingsGroup>
            )}
          </fieldset>
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
  const metricFilterEnabled =
    settings.kind === "metric"
      ? settings.minCountEnabled
      : settings.minReactionsEnabled;
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
      <div className="space-y-4">
        <Card>
          <CardContent className="divide-y p-0">
            <SettingRow
              label={
                settings.kind === "metric"
                  ? t("optionsViewsEnabled")
                  : t("optionsLikesEnabled")
              }
            >
              <Switch
                checked={metricFilterEnabled}
                onCheckedChange={(value) =>
                  settings.kind === "metric"
                    ? updateMetric("minCountEnabled", value)
                    : updateReaction("minReactionsEnabled", value)
                }
              />
            </SettingRow>
            {metricFilterEnabled && (
              <>
                <PeriodSetting
                  mode={settings.periodMode}
                  onModeChange={(value) =>
                    settings.kind === "metric"
                      ? updateMetric("periodMode", value)
                      : updateReaction("periodMode", value)
                  }
                  onUnitChange={(value) =>
                    settings.kind === "metric"
                      ? updateMetric("periodUnit", value)
                      : updateReaction("periodUnit", value)
                  }
                  onValueChange={(value) =>
                    settings.kind === "metric"
                      ? updateMetric("periodValue", value)
                      : updateReaction("periodValue", value)
                  }
                  unit={settings.periodUnit}
                  value={settings.periodValue}
                />
                {settings.kind === "metric" ? (
                  <NumberSetting
                    label={t("optionsMinViews")}
                    min={0}
                    onValueChange={(value) => updateMetric("minCount", value)}
                    suffix={t("optionsUnitViews")}
                    value={settings.minCount}
                  />
                ) : (
                  <NumberSetting
                    label={t("optionsMinLikes")}
                    min={0}
                    onValueChange={(value) =>
                      updateReaction("minReactions", value)
                    }
                    value={settings.minReactions}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>

        {settings.kind === "reactions" && (
          <>
            <Card>
              <CardContent className="divide-y p-0">
                <SettingRow label={t("optionsMediaEnabled")}>
                  <Switch
                    checked={settings.mediaEnabled}
                    onCheckedChange={(value) =>
                      updateReaction("mediaEnabled", value)
                    }
                  />
                </SettingRow>
                {settings.mediaEnabled && (
                  <SettingRow label={t("optionsMedia")}>
                    <Select
                      value={settings.mediaMode}
                      onValueChange={(value) =>
                        updateReaction(
                          "mediaMode",
                          value as ReactionSiteSettings["mediaMode"],
                        )
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">
                          {t("optionsMediaAny")}
                        </SelectItem>
                        <SelectItem value="images">
                          {t("optionsMediaImages")}
                        </SelectItem>
                        <SelectItem value="video">
                          {t("optionsMediaVideo")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>
                )}
              </CardContent>
            </Card>

            <SettingsGroup className="mt-0" title={t("optionsSectionExclude")}>
              <SettingRow label={t("optionsKeywordsEnabled")}>
                <Switch
                  checked={settings.excludedKeywordsEnabled}
                  onCheckedChange={(value) =>
                    updateReaction("excludedKeywordsEnabled", value)
                  }
                />
              </SettingRow>
              {settings.excludedKeywordsEnabled && (
                <div className="p-5 sm:px-6">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`excluded-keywords-${site}`}
                  >
                    {t("optionsExcludedKeywords")}
                  </label>
                  <Textarea
                    className="mt-3"
                    id={`excluded-keywords-${site}`}
                    onChange={(event) =>
                      updateReaction(
                        "excludedKeywords",
                        event.currentTarget.value,
                      )
                    }
                    placeholder={t("optionsExcludedKeywordsPlaceholder")}
                    value={settings.excludedKeywords}
                  />
                </div>
              )}
              <SettingRow label={t("optionsHideReposts")}>
                <Switch
                  checked={settings.hideReposts}
                  onCheckedChange={(value) =>
                    updateReaction("hideReposts", value)
                  }
                />
              </SettingRow>
            </SettingsGroup>
          </>
        )}
      </div>
    </section>
  );
}

function SettingsGroup({
  children,
  className,
  collapsible = false,
  defaultOpen = false,
  description,
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  description?: string;
  disabled?: boolean;
  title: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  if (collapsible) {
    return (
      <details
        className={`mt-7 ${className ?? ""}`}
        data-settings-group=""
        onToggle={(event) =>
          setOpen(disabled ? false : event.currentTarget.open)
        }
        open={open}
      >
        <summary
          aria-disabled={disabled}
          className={`text-sm font-medium text-muted-foreground ${
            disabled
              ? "pointer-events-none cursor-not-allowed"
              : "cursor-pointer"
          }`}
        >
          {title}
        </summary>
        <Card className="mt-3">
          <CardContent className="divide-y p-0">{children}</CardContent>
        </Card>
      </details>
    );
  }
  return (
    <section
      className={`mt-7 ${className ?? ""}`}
      aria-label={title}
      data-settings-group=""
    >
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      {description && (
        <p className="mb-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      <Card>
        <CardContent className="divide-y p-0">{children}</CardContent>
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

function NumberSetting({
  label,
  min,
  onValueChange,
  suffix,
  value,
}: {
  label: string;
  min: number;
  onValueChange: (value: number) => void;
  suffix?: string;
  value: number;
}): React.JSX.Element {
  return (
    <SettingRow label={label}>
      <div className="flex items-center gap-2">
        <Input
          className="w-24 text-right tabular-nums"
          type="number"
          inputMode="numeric"
          min={min}
          step={1}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const nextValue = event.currentTarget.valueAsNumber;
            if (Number.isSafeInteger(nextValue)) {
              onValueChange(Math.max(min, nextValue));
            }
          }}
        />
        {suffix && (
          <span className="text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
    </SettingRow>
  );
}

function PeriodSetting({
  mode,
  onModeChange,
  onUnitChange,
  onValueChange,
  unit,
  value,
}: {
  mode: PeriodMode;
  onModeChange: (value: PeriodMode) => void;
  onUnitChange: (value: PeriodUnit) => void;
  onValueChange: (value: number) => void;
  unit: PeriodUnit;
  value: number;
}): React.JSX.Element {
  return (
    <fieldset className="m-0 border-0 px-5 pb-5 sm:px-6" data-period-setting="">
      <legend className="mb-3 w-full px-0 pb-0 pt-5 text-sm font-medium">
        {t("optionsPostTiming")}
      </legend>
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            className="size-4 accent-primary"
            type="radio"
            name="filter-period"
            value="all"
            checked={mode === "all"}
            onChange={() => onModeChange("all")}
          />
          {t("optionsAllPosts")}
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            className="size-4 accent-primary"
            type="radio"
            name="filter-period"
            value="limited"
            checked={mode === "limited"}
            onChange={() => onModeChange("limited")}
          />
          {t("optionsSpecifyPeriod")}
        </label>
        {mode === "limited" && (
          <div className="ml-6 flex items-center gap-2">
            <Input
              className="w-24 text-right tabular-nums"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={value}
              aria-label={t("optionsPeriodValue")}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const nextValue = event.currentTarget.valueAsNumber;
                if (Number.isSafeInteger(nextValue)) {
                  onValueChange(Math.max(1, nextValue));
                }
              }}
            />
            <Select
              value={unit}
              onValueChange={(nextUnit) => onUnitChange(nextUnit as PeriodUnit)}
            >
              <SelectTrigger
                className="min-w-28 flex-1"
                aria-label={t("optionsPeriodUnit")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">{t("optionsUnitHours")}</SelectItem>
                <SelectItem value="day">{t("optionsUnitDays")}</SelectItem>
                <SelectItem value="week">{t("optionsUnitWeeks")}</SelectItem>
                <SelectItem value="month">{t("optionsUnitMonths")}</SelectItem>
                <SelectItem value="year">{t("optionsUnitYears")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </fieldset>
  );
}
