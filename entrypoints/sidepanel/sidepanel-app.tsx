import { Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../../utils/filter-context.ts";
import { t } from "../../utils/i18n.ts";
import {
  defaults,
  hasSourceSettings,
  normalizeSettings,
  type PeriodMode,
  type PeriodUnit,
  type ReactionSiteSettings,
  type Settings,
  type SettingsScopeKind,
  type SiteSettingsKey,
  settingsFor,
  sourceSettingsFor,
  withoutSourceSettings,
  withSiteSettings,
  withSourceSettings,
  type YouTubeSiteSettings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { siteSettingsKeyForControl } from "../../utils/site-controls.ts";
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
  misskey: "Misskey",
  youtube: "YouTube",
});
function cleanPageTitle(title: string): string {
  return title
    .replace(/\s+(?:\/|—|\|)\s+(?:X|Bluesky|Misskey(?:\.io)?|YouTube).*$/u, "")
    .trim();
}

function contextLabel(context: FilterContextResponse): string {
  if (context.scopeKind === "following") {
    return t("sidepanelScopeFollowing");
  }
  if (context.scopeKind === "home") {
    return t("sidepanelScopeHome");
  }
  const kindLabels: Readonly<
    Record<Exclude<SettingsScopeKind, "following" | "home">, string>
  > = {
    list: t("sidepanelScopeList"),
    feed: t("sidepanelScopeFeed"),
    antenna: t("sidepanelScopeAntenna"),
  };
  const kind = context.scopeKind;
  if (kind === null) {
    return t("sidepanelSiteDefault");
  }
  const title = cleanPageTitle(context.pageTitle);
  return title === "" ? kindLabels[kind] : `${kindLabels[kind]}: ${title}`;
}

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
  const [selectedSite, setSelectedSite] = useState<SiteSettingsKey>("x");
  const [selectedScopeKey, setSelectedScopeKey] = useState<string | null>(null);
  const statusTimer = useRef<number | null>(null);
  const followActiveContext = useRef(true);
  const settingsRef = useRef(settings);
  const activePageRef = useRef<{ tabId: number; pageKey: string } | null>(null);
  const panelInitialized = useRef(false);
  const [pageFilteringEnabled, setPageFilteringEnabled] = useState(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    startUncaughtReporting({
      target: window,
      source: "sidepanel",
      filterToOwnCode: false,
    });

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
      if (statusTimer.current !== null) {
        window.clearTimeout(statusTimer.current);
      }
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
      .then(() => {
        setStatus(t("optionsStatusSaved"));
        if (statusTimer.current !== null) {
          window.clearTimeout(statusTimer.current);
        }
        statusTimer.current = window.setTimeout(() => setStatus(""), 1400);
      })
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
        const host = tab?.url ? new URL(tab.url).hostname : null;
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
        if (host !== null) {
          const site = siteSettingsKeyForControl(host);
          if (
            site !== null &&
            context?.site === site &&
            context.scopeKey !== null
          ) {
            const current = settingsRef.current;
            const stored = sourceSettingsFor(current, site).find(
              ({ scopeKey }) => scopeKey === context.scopeKey,
            );
            const label = contextLabel(context);
            if (stored !== undefined && stored.label !== label) {
              const renamed = withSourceSettings(
                current,
                site,
                context.scopeKey,
                label,
                stored.settings,
              );
              settingsRef.current = renamed;
              setSettings(renamed);
              void settingsItem.setValue(renamed).catch(() => {});
            }
          }
          if (
            site !== null &&
            (forceSelection || followActiveContext.current)
          ) {
            followActiveContext.current = true;
            setSelectedSite(site);
            setSelectedScopeKey(
              context?.site === site ? context.scopeKey : null,
            );
          }
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

  const activeSource =
    activeContext?.site === selectedSite && activeContext.scopeKey !== null
      ? {
          scopeKey: activeContext.scopeKey,
          label: contextLabel(activeContext),
        }
      : null;
  const storedSources = sourceSettingsFor(settings, selectedSite);
  const sourceOptions = [
    ...storedSources.map(({ scopeKey, label }) => ({ scopeKey, label })),
  ];
  if (
    activeSource !== null &&
    !sourceOptions.some(({ scopeKey }) => scopeKey === activeSource.scopeKey)
  ) {
    sourceOptions.push(activeSource);
  }
  const selectedSourceLabel =
    sourceOptions.find(({ scopeKey }) => scopeKey === selectedScopeKey)
      ?.label ??
    selectedScopeKey ??
    "";
  const selectedSourceIsSaved =
    selectedScopeKey !== null &&
    hasSourceSettings(settings, selectedSite, selectedScopeKey);
  const selectedSettings = settingsFor(
    settings,
    selectedSite,
    selectedScopeKey,
  );

  const reactionFilterEnabled =
    selectedSettings.kind === "youtube"
      ? selectedSettings.minViewsEnabled
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

  const saveSelectedSettings = (
    nextSiteSettings: ReactionSiteSettings | YouTubeSiteSettings,
  ): void => {
    if (selectedScopeKey === null) {
      saveSettings(withSiteSettings(settings, selectedSite, nextSiteSettings));
      return;
    }
    if (!selectedSourceIsSaved) {
      if (selectedSite !== "youtube" && nextSiteSettings.kind === "reactions") {
        saveSettings(
          withSourceSettings(
            settings,
            selectedSite,
            selectedScopeKey,
            selectedSourceLabel,
            nextSiteSettings,
          ),
        );
      }
      return;
    }
    saveSettings(
      withSourceSettings(
        settings,
        selectedSite,
        selectedScopeKey,
        selectedSourceLabel,
        nextSiteSettings,
      ),
    );
  };

  const updateReactionSetting = <Key extends keyof ReactionSiteSettings>(
    key: Key,
    value: ReactionSiteSettings[Key],
  ): void => {
    if (selectedSettings.kind !== "reactions") {
      return;
    }
    saveSelectedSettings({ ...selectedSettings, [key]: value });
  };

  const updateYouTubeSetting = <Key extends keyof YouTubeSiteSettings>(
    key: Key,
    value: YouTubeSiteSettings[Key],
  ): void => {
    if (selectedSettings.kind !== "youtube") {
      return;
    }
    saveSelectedSettings({ ...selectedSettings, [key]: value });
  };

  const currentPageIsEditable =
    manageAll ||
    (activeContext !== null && activeContext.site === selectedSite);

  const settingsNavigation = manageAll ? (
    <Card className="h-fit md:sticky md:top-6 md:col-start-1 md:row-start-2">
      <CardContent className="p-3">
        <nav aria-label={t("optionsNavigationLabel")}>
          {(Object.keys(SITE_LABELS) as SiteSettingsKey[]).map((site) => {
            const sources = sourceSettingsFor(settings, site);
            return (
              <div className="mb-4 last:mb-0" key={site}>
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {SITE_LABELS[site]}
                </p>
                <button
                  className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${
                    selectedSite === site && selectedScopeKey === null
                      ? "bg-muted font-medium"
                      : ""
                  }`}
                  onClick={() => {
                    setSelectedSite(site);
                    setSelectedScopeKey(null);
                  }}
                  type="button"
                >
                  {t("sidepanelSiteDefault")}
                </button>
                {sources.map(({ scopeKey, label }) => (
                  <button
                    className={`w-full rounded-md px-3 py-2 pl-6 text-left text-sm hover:bg-muted ${
                      selectedSite === site && selectedScopeKey === scopeKey
                        ? "bg-muted font-medium"
                        : ""
                    }`}
                    key={scopeKey}
                    onClick={() => {
                      setSelectedSite(site);
                      setSelectedScopeKey(scopeKey);
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </CardContent>
    </Card>
  ) : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div
        className={`mx-auto px-5 py-6 ${
          manageAll
            ? "max-w-6xl md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:gap-x-7"
            : "max-w-xl"
        }`}
      >
        <header className={`mb-7 ${manageAll ? "md:col-span-2" : ""}`}>
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">
              {manageAll ? t("optionsTitle") : t("sidepanelTitle")}
            </h1>
          </div>
          {manageAll && (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t("optionsTagline")}
            </p>
          )}
        </header>

        {settingsNavigation}

        {(!manageAll || selectedScopeKey !== null) && (
          <SettingsGroup
            className={manageAll ? "md:col-start-2" : undefined}
            title={manageAll ? selectedSourceLabel : t("sidepanelCurrentPage")}
            description={
              !manageAll && activeContext !== null
                ? contextLabel(activeContext)
                : undefined
            }
          >
            {!manageAll && !currentPageIsEditable && (
              <div className="p-5 text-sm leading-6 text-muted-foreground sm:px-6">
                {t("sidepanelStatusUnavailable")}
              </div>
            )}
            {manageAll && selectedScopeKey !== null && (
              <div className="flex justify-end p-5 sm:px-6">
                <Button
                  variant="destructive"
                  onClick={() => {
                    saveSettings(
                      withoutSourceSettings(
                        settings,
                        selectedSite,
                        selectedScopeKey,
                      ),
                    );
                    setSelectedScopeKey(null);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t("sidepanelDeleteSourceSettings")}
                </Button>
              </div>
            )}
            {!manageAll && currentPageIsEditable && (
              <SettingRow label={t("sidepanelPageEnabled")}>
                <Switch
                  checked={filteringEnabled}
                  onCheckedChange={updateFiltering}
                />
              </SettingRow>
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

        {!manageAll && (
          <Button
            className="mb-6 mt-3 w-full"
            onClick={() => void browser.runtime.openOptionsPage()}
            variant="outline"
          >
            <Settings2 className="size-4" aria-hidden="true" />
            {t("sidepanelManageSettings")}
          </Button>
        )}

        <fieldset
          className={`m-0 min-w-0 border-0 p-0 disabled:opacity-60 ${
            manageAll ? "md:col-start-2" : ""
          }`}
          disabled={!filteringEnabled || !currentPageIsEditable}
          hidden={!currentPageIsEditable}
        >
          <section
            className="mt-7"
            aria-label={t("optionsSectionDisplayConditions")}
          >
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              {t("optionsSectionDisplayConditions")}
            </h2>
            <div className="space-y-4">
              <Card>
                <CardContent className="divide-y p-0">
                  <SettingRow
                    label={
                      selectedSettings.kind === "youtube"
                        ? t("optionsViewsEnabled")
                        : selectedSite === "misskey"
                          ? t("optionsReactionsEnabled")
                          : t("optionsLikesEnabled")
                    }
                  >
                    <Switch
                      checked={reactionFilterEnabled}
                      onCheckedChange={(value) =>
                        selectedSettings.kind === "youtube"
                          ? updateYouTubeSetting("minViewsEnabled", value)
                          : updateReactionSetting("minReactionsEnabled", value)
                      }
                    />
                  </SettingRow>
                  {reactionFilterEnabled && (
                    <>
                      <PeriodSetting
                        mode={selectedSettings.periodMode}
                        onModeChange={(value) =>
                          selectedSettings.kind === "youtube"
                            ? updateYouTubeSetting("periodMode", value)
                            : updateReactionSetting("periodMode", value)
                        }
                        onUnitChange={(value) =>
                          selectedSettings.kind === "youtube"
                            ? updateYouTubeSetting("periodUnit", value)
                            : updateReactionSetting("periodUnit", value)
                        }
                        onValueChange={(value) =>
                          selectedSettings.kind === "youtube"
                            ? updateYouTubeSetting("periodValue", value)
                            : updateReactionSetting("periodValue", value)
                        }
                        unit={selectedSettings.periodUnit}
                        value={selectedSettings.periodValue}
                      />
                      {selectedSettings.kind === "youtube" ? (
                        <NumberSetting
                          label={t("optionsMinViews")}
                          min={0}
                          onValueChange={(value) =>
                            updateYouTubeSetting("minViews", value)
                          }
                          suffix={t("optionsUnitViews")}
                          value={selectedSettings.minViews}
                        />
                      ) : (
                        <NumberSetting
                          label={
                            selectedSite === "misskey"
                              ? t("optionsMinReactions")
                              : t("optionsMinLikes")
                          }
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
            <SettingsGroup title={t("optionsSectionExclude")}>
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

        {status && (
          <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
            {status}
          </p>
        )}
        {manageAll && (
          <footer className="mt-7 text-sm md:col-start-2">
            <a
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
              href={REPOSITORY_URL}
              rel="noreferrer"
              target="_blank"
            >
              {t("optionsRepository")}
            </a>
          </footer>
        )}
      </div>
    </main>
  );
}

function SettingsGroup({
  children,
  className,
  description,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  description?: string;
  title: string;
}): React.JSX.Element {
  return (
    <section className={`mt-7 ${className ?? ""}`} aria-label={title}>
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
    <div className="flex min-h-16 flex-col items-stretch gap-3 p-5 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between min-[360px]:gap-5 sm:px-6">
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
    <fieldset className="m-0 border-0 px-5 pb-5 sm:px-6">
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
