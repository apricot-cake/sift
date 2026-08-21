import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_MISSKEY_HOSTS } from "../../utils/default-instances.ts";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { t } from "../../utils/i18n.ts";
import {
  addInstance,
  type InstanceDeps,
  normalizeInstanceHost,
  removeInstance,
} from "../../utils/instances.ts";
import {
  defaults,
  isSiteEnabled,
  normalizeSettings,
  type Settings,
  type SiteSettings,
  type SiteSettingsKey,
  settingsFor,
  withSiteEnabled,
  withSiteSettings,
} from "../../utils/settings.ts";
import { instanceStorage, settingsItem } from "../../utils/settings-storage.ts";
import { siteSettingsKeyForControl } from "../../utils/site-controls.ts";
import { Badge } from "../options/components/ui/badge.tsx";
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
});

function SidepanelApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(
    normalizeSettings(defaults),
  );
  const [status, setStatus] = useState(t("optionsStatusLoading"));
  const [activeHost, setActiveHost] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteSettingsKey>("x");
  const [instanceHost, setInstanceHost] = useState("");
  const [instanceError, setInstanceError] = useState("");
  const [isSubmittingInstance, setIsSubmittingInstance] = useState(false);
  const statusTimer = useRef<number | null>(null);
  const settingsRef = useRef(settings);

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
    },
    [],
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

  const updateSiteSetting = <Key extends keyof SiteSettings>(
    key: Key,
    value: SiteSettings[Key],
  ): void =>
    saveSettings(
      withSiteSettings(settings, selectedSite, {
        ...settingsFor(settings, selectedSite),
        [key]: value,
      }),
    );

  useEffect(() => {
    const refreshActiveHost = async (): Promise<void> => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      try {
        const host = tab?.url ? new URL(tab.url).hostname : null;
        setActiveHost(host);
        if (host !== null) {
          const site = siteSettingsKeyForControl(host, settingsRef.current);
          if (site !== null) {
            setSelectedSite(site);
          }
        }
      } catch {
        setActiveHost(null);
      }
    };

    const handleTabActivated = () => void refreshActiveHost();
    const handleTabUpdated = (
      tabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
    ): void => {
      if (changeInfo.url !== undefined) {
        void browser.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab?.id === tabId) {
              void refreshActiveHost();
            }
          });
      }
    };
    void refreshActiveHost();
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, []);

  const selectedSettings = settingsFor(settings, selectedSite);
  const reactionFilterLabel =
    selectedSite === "misskey"
      ? t("optionsSectionReactionsFilter")
      : t("optionsSectionLikesFilter");
  const activeSite =
    activeHost === null
      ? null
      : siteSettingsKeyForControl(activeHost, settings);
  const selectedHost =
    selectedSite === "x"
      ? "x.com"
      : selectedSite === "bluesky"
        ? "bsky.app"
        : activeSite === "misskey" && activeHost !== null
          ? activeHost
          : (DEFAULT_MISSKEY_HOSTS[0] ?? "misskey.io");
  const filteringEnabled = isSiteEnabled(settings, selectedHost);
  const customMisskeyInstances = settings.misskeyInstances.filter(
    (host) => !DEFAULT_MISSKEY_HOSTS.includes(host),
  );
  const misskeyInstanceCount =
    DEFAULT_MISSKEY_HOSTS.length + customMisskeyInstances.length;

  const updateFiltering = (enabled: boolean): void => {
    saveSettings(withSiteEnabled(settings, selectedHost, enabled));
  };

  const instanceDeps: InstanceDeps = {
    permissions: browser.permissions,
    scripting: browser.scripting,
    storage: instanceStorage,
  };

  const addMisskeyInstance = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setInstanceError("");
    const host = normalizeInstanceHost(instanceHost);
    if (host === null) {
      setInstanceError(t("optionsErrorBadHost"));
      return;
    }
    if (DEFAULT_MISSKEY_HOSTS.includes(host)) {
      setInstanceError(t("optionsErrorAlreadyDefault"));
      return;
    }

    setIsSubmittingInstance(true);
    try {
      const result = await addInstance(host, instanceDeps);
      if (!result.added) {
        setInstanceError(t("optionsErrorPermissionDenied"));
        return;
      }
      setInstanceHost("");
    } finally {
      setIsSubmittingInstance(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-5 py-6">
        <header className="mb-7">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">
              {t("sidepanelTitle")}
            </h1>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t("sidepanelTagline")}
          </p>
          <FilterLegend reactionFilterLabel={reactionFilterLabel} />
        </header>

        <SettingsGroup
          title={t("sidepanelSectionCurrentSite")}
          description={t("sidepanelSiteNote")}
        >
          <SettingRow label={t("sidepanelSite")}>
            <Select
              value={selectedSite}
              onValueChange={(value) =>
                setSelectedSite(value as SiteSettingsKey)
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SITE_LABELS) as SiteSettingsKey[]).map((site) => (
                  <SelectItem key={site} value={site}>
                    {SITE_LABELS[site]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t("sidepanelFiltering")}>
            <Switch
              checked={filteringEnabled}
              onCheckedChange={updateFiltering}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("optionsSectionVisible")}>
          <SettingRow label={t("optionsMedia")}>
            <Select
              value={selectedSettings.mediaMode}
              onValueChange={(value) =>
                updateSiteSetting(
                  "mediaMode",
                  value as SiteSettings["mediaMode"],
                )
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("optionsMediaAll")}</SelectItem>
                <SelectItem value="any">{t("optionsMediaAny")}</SelectItem>
                <SelectItem value="images">
                  {t("optionsMediaImages")}
                </SelectItem>
                <SelectItem value="video">{t("optionsMediaVideo")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={reactionFilterLabel}
          description={
            selectedSite === "misskey"
              ? t("optionsStandardReactionsNote")
              : t("optionsStandardLikesNote")
          }
        >
          <NumberSetting
            label={
              selectedSite === "misskey"
                ? t("optionsMinReactions")
                : t("optionsMinLikes")
            }
            min={0}
            onValueChange={(value) => updateSiteSetting("minReactions", value)}
            value={selectedSettings.minReactions}
          />
        </SettingsGroup>

        <SettingsGroup
          title={t("optionsSectionRisingFilter")}
          description={t("optionsRisingNote")}
        >
          <SettingRow label={t("optionsRisingEnabled")}>
            <Switch
              checked={selectedSettings.risingEnabled}
              onCheckedChange={(value) =>
                updateSiteSetting("risingEnabled", value)
              }
            />
          </SettingRow>
          {selectedSettings.risingEnabled && (
            <>
              <NumberSetting
                label={t("optionsMaxAge")}
                min={1}
                onValueChange={(value) =>
                  updateSiteSetting("risingMaxAgeHours", value)
                }
                suffix={t("optionsUnitHours")}
                value={selectedSettings.risingMaxAgeHours}
              />
              <NumberSetting
                label={
                  selectedSite === "misskey"
                    ? t("optionsRisingMinReactions")
                    : t("optionsRisingMinLikes")
                }
                min={0}
                onValueChange={(value) =>
                  updateSiteSetting("risingMinReactions", value)
                }
                value={selectedSettings.risingMinReactions}
              />
            </>
          )}
        </SettingsGroup>

        <SettingsGroup title={t("optionsSectionExclude")}>
          <div className="p-5 sm:px-6">
            <label className="text-sm font-medium" htmlFor="excluded-keywords">
              {t("optionsExcludedKeywords")}
            </label>
            <Textarea
              id="excluded-keywords"
              className="mt-3"
              placeholder={t("optionsExcludedKeywordsPlaceholder")}
              value={selectedSettings.excludedKeywords}
              onChange={(event) =>
                updateSiteSetting("excludedKeywords", event.currentTarget.value)
              }
            />
          </div>
          <SettingRow label={t("optionsHideReposts")}>
            <Switch
              checked={selectedSettings.hideReposts}
              onCheckedChange={(value) =>
                updateSiteSetting("hideReposts", value)
              }
            />
          </SettingRow>
        </SettingsGroup>

        {status && (
          <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
            {status}
          </p>
        )}
        <SettingsDisclosure
          count={misskeyInstanceCount}
          title={t("optionsSectionInstances")}
        >
          <CardContent className="divide-y p-0">
            {DEFAULT_MISSKEY_HOSTS.map((host) => (
              <div
                className="flex items-center justify-between gap-4 p-5 sm:px-6"
                key={host}
              >
                <span className="text-sm font-medium">{host}</span>
                <Badge>{t("optionsInstanceDefault")}</Badge>
              </div>
            ))}
            {customMisskeyInstances.map((host) => (
              <div
                className="flex items-center justify-between gap-4 p-5 sm:px-6"
                key={host}
              >
                <span className="text-sm font-medium">{host}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void removeInstance(host, instanceDeps)}
                >
                  {t("optionsInstanceRemove")}
                </Button>
              </div>
            ))}
            <form
              className="p-5 sm:p-6"
              onSubmit={(event) => void addMisskeyInstance(event)}
            >
              <div className="flex gap-2">
                <Input
                  value={instanceHost}
                  onChange={(event) =>
                    setInstanceHost(event.currentTarget.value)
                  }
                  placeholder={t("optionsInstancePlaceholder")}
                  aria-label={t("optionsInstanceInputLabel")}
                />
                <Button type="submit" disabled={isSubmittingInstance}>
                  {t("optionsInstanceAdd")}
                </Button>
              </div>
              {instanceError && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {instanceError}
                </p>
              )}
              <p className="mt-3 text-sm text-muted-foreground">
                {t("optionsInstanceNote")}
              </p>
            </form>
          </CardContent>
        </SettingsDisclosure>

        <footer className="mt-7 text-sm">
          <a
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
            href={REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            {t("optionsRepository")}
          </a>
        </footer>
      </div>
    </main>
  );
}

function FilterLegend({
  reactionFilterLabel,
}: {
  reactionFilterLabel: string;
}): React.JSX.Element {
  return (
    <div className="mt-4 rounded-lg bg-muted/60 px-3 py-2.5">
      <p className="text-xs font-medium text-foreground">
        {t("sidepanelFilterLegend")}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span
            className="h-5 w-[3px]"
            style={{ backgroundColor: "rgb(37, 99, 235)" }}
            aria-hidden="true"
          />
          {reactionFilterLabel}
        </span>
        <span className="flex items-center gap-2">
          <span
            className="h-5 w-[3px]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, rgb(37, 99, 235) 0 4px, transparent 4px 7px)",
            }}
            aria-hidden="true"
          />
          {t("optionsSectionRisingFilter")}
        </span>
      </div>
    </div>
  );
}

function SettingsGroup({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}): React.JSX.Element {
  return (
    <section className="mt-7" aria-label={title}>
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

function SettingsDisclosure({
  children,
  count,
  title,
}: {
  children: React.ReactNode;
  count: number;
  title: string;
}): React.JSX.Element {
  return (
    <details className="group mt-7">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {title}
          <Badge>{count}</Badge>
        </span>
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <Card className="mt-3">{children}</Card>
    </details>
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
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const nextValue = Number(event.currentTarget.value);
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

export { SidepanelApp };
