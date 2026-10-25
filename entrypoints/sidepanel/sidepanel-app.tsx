import {
  CircleMinus,
  Image,
  ListFilter,
  type LucideIcon,
  MessageCircle,
  Quote,
  Repeat2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../utils/i18n.ts";
import { metricThresholdSuggestions } from "../../utils/metric-threshold-suggestions.ts";
import {
  defaults,
  normalizeSettings,
  type ReactionSiteSettings,
  type Settings,
  type SiteSettingsKey,
  settingsFor,
  withSiteSettings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
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
import { usePanelConnection } from "./use-panel-connection.ts";

export function SidepanelApp(): React.JSX.Element {
  const resetDialog = useRef<HTMLDialogElement>(null);
  const resetCancel = useRef<HTMLButtonElement>(null);
  const [resetAllSites, setResetAllSites] = useState(false);
  const [resetSite, setResetSite] = useState<SiteSettingsKey | null>(null);
  const [settings, setSettings] = useState<Settings>(
    normalizeSettings(defaults),
  );
  const [status, setStatus] = useState(t("optionsStatusLoading"));
  const settingsRef = useRef(settings);
  const [manualSites, setManualSites] = useState<
    Partial<Record<SiteSettingsKey, boolean>>
  >({});

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

  const clearManualMinimums = useCallback(() => setManualSites({}), []);
  const {
    activeContext,
    activeSite,
    knownUnsupportedSite,
    selectedSite,
    pageFilteringEnabled,
    runPanelAction,
    updateFiltering,
    captureConnection,
    restoreFiltering,
  } = usePanelConnection({
    onSettingsInitialized: setSettings,
    onMinimumReset: clearManualMinimums,
  });

  const saveSettings = (next: Settings): void => {
    const connection = captureConnection();
    const normalized = normalizeSettings(next);
    settingsRef.current = normalized;
    setSettings(normalized);
    void settingsItem
      .setValue(normalized)
      .then(() => restoreFiltering(connection))
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

  const selectedSettings = settingsFor(settings, selectedSite);
  const manualActive = manualSites[selectedSite] === true;
  const manualMinimum =
    selectedSettings.manualMinimum ?? selectedSettings.minReactions;
  const filteringEnabled = pageFilteringEnabled;

  const saveSiteSettings = (
    site: SiteSettingsKey,
    nextSiteSettings: ReactionSiteSettings,
  ): void => {
    saveSettings(withSiteSettings(settingsRef.current, site, nextSiteSettings));
  };

  const updateReactionSetting = <Key extends keyof ReactionSiteSettings>(
    key: Key,
    value: ReactionSiteSettings[Key],
  ): void => {
    runPanelAction(() => {
      saveSiteSettings(selectedSite, {
        ...settingsFor(settingsRef.current, selectedSite),
        [key]: value,
      });
    });
  };

  const setManualMinimum = (value: number, enabled: boolean): void => {
    setManualSites((sites) => ({ ...sites, [selectedSite]: true }));
    saveSiteSettings(selectedSite, {
      ...settingsFor(settingsRef.current, selectedSite),
      manualMinimum: value,
      ...(enabled ? { minReactions: value, minReactionsEnabled: true } : {}),
    });
  };

  const toggleManualMinimum = (enabled: boolean): void => {
    setManualSites((sites) => ({ ...sites, [selectedSite]: enabled }));
    if (enabled) setManualMinimum(manualMinimum, true);
    else
      saveSiteSettings(selectedSite, {
        ...settingsFor(settingsRef.current, selectedSite),
        minReactionsEnabled: false,
      });
  };

  const currentPageIsEditable = activeSite === selectedSite;
  const healthState = activeContext?.health?.state;
  const healthMessage =
    healthState === "unreadable"
      ? "sidepanelReadFailed"
      : healthState === "loading"
        ? "sidepanelReading"
        : healthState === "empty"
          ? "sidepanelEmpty"
          : healthState === "degraded" &&
              activeContext?.health?.warnPartial === true
            ? "sidepanelPartialData"
            : null;
  const healthBlocksControls =
    healthState === "unreadable" ||
    healthState === "loading" ||
    healthState === "empty";
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
      data-sift-site={activeSite ?? undefined}
    >
      <div className="relative mx-auto flex min-h-screen max-w-xl flex-col p-6">
        <div data-filter-controls="">
          {healthMessage !== null && activeSite !== null && (
            <p
              role="status"
              data-page-health={healthState}
              className="m-0 mb-6 text-sm leading-6 text-muted-foreground"
            >
              {t(healthMessage)}
            </p>
          )}
          {pageIsUnsupported && activeSite === null && (
            <div className="text-sm leading-6 text-muted-foreground">
              <p className="m-0">
                {t(
                  knownUnsupportedSite
                    ? "sidepanelStatusUnavailable"
                    : "sidepanelConnectionUnavailable",
                )}
              </p>
              <p className="mb-0 mt-6">
                {t(
                  knownUnsupportedSite
                    ? "sidepanelSupportedSitesHint"
                    : "sidepanelConnectionHint",
                )}
              </p>
            </div>
          )}
          {pageIsUnsupported &&
            activeSite !== null &&
            !healthBlocksControls && (
              <div className="text-sm leading-6 text-muted-foreground">
                <p className="m-0">{t("sidepanelUnsupportedTitle")}</p>
                <div className="mt-6">
                  <p className="m-0 font-medium">
                    {t("sidepanelSupportedPagesTitle")}
                  </p>
                  <ul className="mb-0 mt-3 list-disc space-y-1 pl-5">
                    <li>{t("sidepanelSupportedFollowing")}</li>
                    <li>{t("sidepanelSupportedLists")}</li>
                    <li>{t("sidepanelSupportedLatestSearch")}</li>
                    <li>
                      {t(
                        activeSite === "x"
                          ? "sidepanelSupportedXProfiles"
                          : "sidepanelSupportedProfiles",
                      )}
                    </li>
                  </ul>
                </div>
              </div>
            )}
          {currentPageIsEditable &&
            !pageIsUnsupported &&
            !healthBlocksControls && (
              <fieldset
                className="m-0 min-w-0 space-y-7 border-0 p-0 disabled:opacity-60"
                disabled={!filteringIsAvailable}
              >
                <div>
                  <section data-minimum-group="">
                    <h2 className="m-0 pb-3 text-sm font-medium">
                      <ItemLabel icon={ListFilter}>
                        {t("optionsMinLikes")}
                      </ItemLabel>
                    </h2>
                    <ReactionThresholdSuggestions
                      truncated={activeContext?.metricContextTruncated === true}
                      minimumEnabled={selectedSettings.minReactionsEnabled}
                      onManual={() =>
                        runPanelAction(() => toggleManualMinimum(true))
                      }
                      onClear={() =>
                        runPanelAction(() => toggleManualMinimum(false))
                      }
                      selectionEnabled={
                        !manualActive && selectedSettings.minReactionsEnabled
                      }
                      currentMinimum={selectedSettings.minReactions}
                      metricCounts={activeContext?.metricCounts ?? []}
                      onSelect={(minimum) =>
                        runPanelAction(() => {
                          setManualSites((sites) => ({
                            ...sites,
                            [selectedSite]: false,
                          }));
                          saveSiteSettings(selectedSite, {
                            ...settingsFor(settingsRef.current, selectedSite),
                            manualMinimum,
                            minReactions: minimum,
                            minReactionsEnabled: true,
                          });
                        })
                      }
                    >
                      <ThresholdSetting
                        label={t("optionsManualMinimum")}
                        min={0}
                        onValueChange={(value) =>
                          runPanelAction(() => setManualMinimum(value, true))
                        }
                        suffix={t("sidepanelLikeSuggestionMinimumSuffix")}
                        value={manualMinimum}
                      />
                    </ReactionThresholdSuggestions>
                  </section>
                  <MediaSetting
                    enabled={selectedSettings.mediaEnabled}
                    mode={selectedSettings.mediaMode}
                    onChange={(mediaEnabled, mediaMode) =>
                      runPanelAction(() =>
                        saveSiteSettings(selectedSite, {
                          ...settingsFor(settingsRef.current, selectedSite),
                          mediaEnabled,
                          mediaMode,
                        }),
                      )
                    }
                  />
                </div>

                <section data-filter-section="">
                  <h2>
                    <ItemLabel icon={CircleMinus}>
                      {t("optionsSectionExclude")}
                    </ItemLabel>
                  </h2>
                  <SettingRow
                    icon={MessageCircle}
                    label={t("optionsHideReplies")}
                  >
                    <Switch
                      aria-label={t("optionsHideReplies")}
                      checked={selectedSettings.hideReplies}
                      onCheckedChange={(value) =>
                        updateReactionSetting("hideReplies", value)
                      }
                    />
                  </SettingRow>
                  <SettingRow icon={Quote} label={t("optionsHideQuotes")}>
                    <Switch
                      aria-label={t("optionsHideQuotes")}
                      checked={selectedSettings.hideQuotes}
                      onCheckedChange={(value) =>
                        updateReactionSetting("hideQuotes", value)
                      }
                    />
                  </SettingRow>
                  <SettingRow icon={Repeat2} label={t("optionsHideReposts")}>
                    <Switch
                      aria-label={t("optionsHideReposts")}
                      checked={selectedSettings.hideReposts}
                      onCheckedChange={(value) =>
                        updateReactionSetting("hideReposts", value)
                      }
                    />
                  </SettingRow>
                </section>
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
              <Button
                className="w-full"
                onClick={() => runPanelAction(() => updateFiltering(false))}
              >
                {t("continuousLoadingWarningDisable")}
              </Button>
            </CardContent>
          </Card>
        )}

        <footer className="mt-auto flex justify-end pt-8">
          <Button
            onClick={() =>
              runPanelAction(() => {
                setResetAllSites(false);
                setResetSite(activeSite);
                resetDialog.current?.showModal();
                resetCancel.current?.focus();
              })
            }
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
                    }[resetSite],
                  })}
          </p>
          <label className="mb-6 flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              checked={resetAllSites}
              onChange={(event) => {
                const checked = event.target.checked;
                runPanelAction(() => setResetAllSites(checked));
              }}
            />
            {t("optionsResetAllSites")}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              ref={resetCancel}
              variant="outline"
              onClick={() => runPanelAction(() => resetDialog.current?.close())}
            >
              {t("optionsResetCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => runPanelAction(resetSettings)}
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

function ReactionThresholdSuggestions({
  minimumEnabled,
  onManual,
  onClear,
  children,
  selectionEnabled,
  currentMinimum,
  metricCounts,
  truncated = false,
  onSelect,
}: {
  minimumEnabled: boolean;
  onManual: () => void;
  onClear: () => void;
  children: React.ReactNode;
  selectionEnabled: boolean;
  currentMinimum: number;
  truncated?: boolean;
  metricCounts: readonly number[];
  onSelect: (minimum: number) => void;
}): React.JSX.Element {
  const suggestions = metricThresholdSuggestions(metricCounts, currentMinimum);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerWidth, setPickerWidth] = useState<number>();
  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const updateWidth = () =>
      setPickerWidth(picker.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(picker);
    return () => observer.disconnect();
  }, []);

  const formatter = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const scopeText = truncated
    ? t("sidepanelSampleScope", { count: metricCounts.length })
    : t("sidepanelLikeSuggestionScope", {
        count: formatter.format(metricCounts.length),
      });

  return (
    <div data-threshold-suggestions="">
      <Select
        onOpenChange={(open) => {
          if (open) void checkPanelBuild();
        }}
        value={
          !minimumEnabled
            ? "none"
            : selectionEnabled
              ? String(currentMinimum)
              : "custom"
        }
        onValueChange={(value) => {
          if (value === "none") onClear();
          else if (value === "custom") onManual();
          else onSelect(Number(value));
        }}
      >
        <div
          data-minimum-picker=""
          ref={pickerRef}
          data-custom={minimumEnabled && !selectionEnabled}
        >
          {minimumEnabled && !selectionEnabled && children}
          <SelectTrigger aria-label={t("optionsMinLikes")}>
            {(!minimumEnabled || selectionEnabled) && <SelectValue />}
          </SelectTrigger>
        </div>
        <SelectContent
          data-minimum-menu=""
          align="end"
          style={{ width: pickerWidth }}
          className="max-h-[var(--radix-select-content-available-height)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            const input = document.querySelector<HTMLInputElement>(
              "[data-custom-minimum] input",
            );
            if (input) {
              event.preventDefault();
              input.focus();
            }
          }}
        >
          <SelectItem value="none">
            {t("optionsMinimumNone")}
            <span data-choice-count="">
              {metricCounts.length.toLocaleString()}
              {t("sidepanelLikeSuggestionCountSuffix")}
            </span>
          </SelectItem>
          {suggestions.map((suggestion) => (
            <SelectItem
              key={suggestion.minimum}
              value={String(suggestion.minimum)}
            >
              {formatter.format(suggestion.minimum)}
              <span data-choice-count="">
                {suggestion.count.toLocaleString()}
                {t("sidepanelLikeSuggestionCountSuffix")}
              </span>
            </SelectItem>
          ))}
          <SelectItem value="custom">{t("optionsManualMinimum")}</SelectItem>
        </SelectContent>
      </Select>
      {(truncated || suggestions.length > 0) && (
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
  max = Number.MAX_SAFE_INTEGER,
  onValueChange,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  min: number;
  max?: number;
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
    const nextValue = Math.min(max, Math.max(min, parsed));
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
      max={max}
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
        if (
          Number.isSafeInteger(nextValue) &&
          nextValue >= min &&
          nextValue <= max
        ) {
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
        onOpenChange={(open) => {
          if (open) void checkPanelBuild();
        }}
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

function ThresholdSetting({
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
    <div data-custom-minimum="">
      <EditableNumberInput
        ariaLabel={label}
        min={min}
        value={value}
        onValueChange={onValueChange}
      />
      {suffix && (
        <span className="text-sm text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}
