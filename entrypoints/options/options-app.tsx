import {
  Eye,
  EyeOff,
  type LucideIcon,
  Server,
  SlidersHorizontal,
} from "lucide-react";
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
  normalizeSettings,
  type Settings,
} from "../../utils/settings.ts";
import { instanceStorage, settingsItem } from "../../utils/settings-storage.ts";
import { Badge } from "./components/ui/badge.tsx";
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
import { Textarea } from "./components/ui/textarea.tsx";
import { cn } from "./lib/utils.ts";

type NavigationItem = {
  icon: LucideIcon;
  id: string;
  label: string;
};

const SETTINGS_PAGE_IDS = ["visible", "exclude", "instances"] as const;
type SettingsPage = (typeof SETTINGS_PAGE_IDS)[number];

function settingsPageFromHash(): SettingsPage {
  const id = window.location.hash.slice(1);
  return SETTINGS_PAGE_IDS.includes(id as SettingsPage)
    ? (id as SettingsPage)
    : "visible";
}

function OptionsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(
    normalizeSettings(defaults),
  );
  const [status, setStatus] = useState(t("optionsStatusLoading"));
  const [instanceHost, setInstanceHost] = useState("");
  const [instanceError, setInstanceError] = useState("");
  const [isSubmittingInstance, setIsSubmittingInstance] = useState(false);
  const [activePage, setActivePage] =
    useState<SettingsPage>(settingsPageFromHash);
  const statusTimer = useRef<number | null>(null);

  useEffect(() => {
    startUncaughtReporting({
      target: window,
      source: "options",
      filterToOwnCode: false,
    });

    const updateSettings = (storedSettings: Settings): void => {
      setSettings(normalizeSettings(storedSettings));
      setStatus("");
    };

    void settingsItem
      .getValue()
      .then(updateSettings)
      .catch(() => {
        setStatus(t("optionsErrorLoadFailed"));
      });

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

  useEffect(() => {
    const updateActivePage = (): void => setActivePage(settingsPageFromHash());
    window.addEventListener("hashchange", updateActivePage);
    return () => window.removeEventListener("hashchange", updateActivePage);
  }, []);

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
      .catch(() => {
        setStatus(t("optionsErrorSaveFailed"));
      });
  };

  const updateSetting = <Key extends keyof Settings>(
    key: Key,
    value: Settings[Key],
  ): void => {
    saveSettings({ ...settings, [key]: value });
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

  const navigation: NavigationItem[] = [
    { id: "visible", label: t("optionsSectionVisible"), icon: Eye },
    { id: "exclude", label: t("optionsSectionExclude"), icon: EyeOff },
    { id: "instances", label: t("optionsSectionInstances"), icon: Server },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <SlidersHorizontal className="size-5" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("optionsTitle")}
          </h1>
        </header>

        <div className="grid items-start gap-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-14">
          <SettingsNavigation
            items={navigation}
            activeId={activePage}
            onSelect={setActivePage}
          />
          <div className="min-w-0 max-w-2xl">
            {activePage === "visible" && (
              <section
                id="visible"
                className="scroll-mt-8"
                aria-labelledby="visible-heading"
              >
                <SectionHeading
                  id="visible-heading"
                  title={t("optionsSectionVisible")}
                />
                <Card>
                  <CardContent className="p-0">
                    <SettingRow label={t("optionsMedia")}>
                      <Select
                        value={settings.mediaMode}
                        onValueChange={(value: Settings["mediaMode"]) =>
                          updateSetting("mediaMode", value)
                        }
                      >
                        <SelectTrigger className="w-44">
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
                  </CardContent>
                </Card>

                <SettingsGroup title={t("optionsSectionStandard")}>
                  <NumberSetting
                    label={t("optionsMinLikes")}
                    min={0}
                    step={50}
                    value={settings.minLikes}
                    onValueChange={(value) => updateSetting("minLikes", value)}
                  />
                  <NumberSetting
                    label={t("optionsMinReactions")}
                    min={0}
                    step={2}
                    value={settings.misskeyMinReactions}
                    onValueChange={(value) =>
                      updateSetting("misskeyMinReactions", value)
                    }
                  />
                </SettingsGroup>

                <SettingsGroup title={t("optionsSectionRising")}>
                  <SettingRow label={t("optionsRisingEnabled")}>
                    <Switch
                      checked={settings.risingEnabled}
                      onCheckedChange={(checked) =>
                        updateSetting("risingEnabled", checked)
                      }
                      aria-label={t("optionsRisingEnabled")}
                    />
                  </SettingRow>
                  <NumberSetting
                    label={t("optionsMinLikes")}
                    min={0}
                    step={10}
                    value={settings.risingMinLikes}
                    onValueChange={(value) =>
                      updateSetting("risingMinLikes", value)
                    }
                  />
                  <NumberSetting
                    label={t("optionsMinReactions")}
                    min={0}
                    step={1}
                    value={settings.misskeyRisingMinReactions}
                    onValueChange={(value) =>
                      updateSetting("misskeyRisingMinReactions", value)
                    }
                  />
                  <SettingRow label={t("optionsMaxAge")}>
                    <div className="flex items-center gap-2">
                      <Input
                        className="w-20 text-right tabular-nums"
                        type="number"
                        min={1}
                        max={168}
                        value={settings.risingMaxAgeHours}
                        onChange={(event) =>
                          updateSetting(
                            "risingMaxAgeHours",
                            Number(event.currentTarget.value),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {t("optionsUnitHours")}
                      </span>
                    </div>
                  </SettingRow>
                </SettingsGroup>
              </section>
            )}

            {activePage === "exclude" && (
              <section
                id="exclude"
                className="scroll-mt-8"
                aria-labelledby="exclude-heading"
              >
                <SectionHeading
                  id="exclude-heading"
                  title={t("optionsSectionExclude")}
                />
                <Card>
                  <CardContent className="p-0">
                    <div className="space-y-3 border-b p-5 sm:p-6">
                      <label
                        className="block text-sm font-medium"
                        htmlFor="excluded-keywords"
                      >
                        {t("optionsExcludedKeywords")}
                      </label>
                      <Textarea
                        id="excluded-keywords"
                        rows={4}
                        value={settings.excludedKeywords}
                        placeholder={t("optionsExcludedKeywordsPlaceholder")}
                        onChange={(event) =>
                          updateSetting(
                            "excludedKeywords",
                            event.currentTarget.value,
                          )
                        }
                      />
                    </div>
                    <SettingRow
                      label={t("optionsHideReposts")}
                      className="p-5 sm:px-6"
                    >
                      <Switch
                        checked={settings.hideReposts}
                        onCheckedChange={(checked) =>
                          updateSetting("hideReposts", checked)
                        }
                        aria-label={t("optionsHideReposts")}
                      />
                    </SettingRow>
                  </CardContent>
                </Card>
              </section>
            )}

            {activePage === "instances" && (
              <section
                id="instances"
                className="scroll-mt-8"
                aria-labelledby="instances-heading"
              >
                <SectionHeading
                  id="instances-heading"
                  title={t("optionsSectionInstances")}
                />
                <Card>
                  <CardContent className="p-0">
                    <ul
                      className="divide-y"
                      aria-label={t("optionsSectionInstances")}
                    >
                      {DEFAULT_MISSKEY_HOSTS.map((host) => (
                        <li
                          className="flex items-center justify-between gap-4 p-5 sm:px-6"
                          key={host}
                        >
                          <span className="text-sm font-medium">{host}</span>
                          <Badge>{t("optionsInstanceDefault")}</Badge>
                        </li>
                      ))}
                      {settings.misskeyInstances
                        .filter((host) => !DEFAULT_MISSKEY_HOSTS.includes(host))
                        .map((host) => (
                          <li
                            className="flex items-center justify-between gap-4 p-5 sm:px-6"
                            key={host}
                          >
                            <span className="text-sm font-medium">{host}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void removeInstance(host, instanceDeps)
                              }
                            >
                              {t("optionsInstanceRemove")}
                            </Button>
                          </li>
                        ))}
                    </ul>
                    <form
                      className="border-t p-5 sm:p-6"
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
                        <p
                          className="mt-2 text-sm text-destructive"
                          role="alert"
                        >
                          {instanceError}
                        </p>
                      )}
                      <p className="mt-3 text-sm text-muted-foreground">
                        {t("optionsInstanceNote")}
                      </p>
                    </form>
                  </CardContent>
                </Card>
              </section>
            )}

            <footer className="mt-12 flex min-h-5 items-center justify-between gap-6 text-sm text-muted-foreground">
              <p aria-live="polite" className="text-primary">
                {status}
              </p>
              <p className="text-right">{t("optionsAutosaveNote")}</p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}

function SettingsNavigation({
  activeId,
  items,
  onSelect,
}: {
  activeId: SettingsPage;
  items: NavigationItem[];
  onSelect: (page: SettingsPage) => void;
}): React.JSX.Element {
  return (
    <nav
      aria-label={t("optionsNavigationLabel")}
      className="md:sticky md:top-8"
    >
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1 md:flex-col md:overflow-visible">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            type="button"
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
              activeId === id && "bg-accent text-accent-foreground",
            )}
            onClick={() => onSelect(id as SettingsPage)}
            aria-pressed={activeId === id}
            key={id}
          >
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function SectionHeading({
  id,
  title,
}: {
  id: string;
  title: string;
}): React.JSX.Element {
  return (
    <h2 id={id} className="mb-4 text-xl font-semibold tracking-tight">
      {title}
    </h2>
  );
}

function SettingsGroup({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}): React.JSX.Element {
  return (
    <div className="mt-7">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      <Card>
        <CardContent className="divide-y p-0">{children}</CardContent>
      </Card>
    </div>
  );
}

function SettingRow({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex min-h-16 items-center justify-between gap-6 p-5 sm:px-6",
        className,
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function NumberSetting({
  label,
  min,
  onValueChange,
  step,
  value,
}: {
  label: string;
  min: number;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
}): React.JSX.Element {
  return (
    <SettingRow label={label}>
      <Input
        className="w-24 text-right tabular-nums"
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onValueChange(Number(event.currentTarget.value))}
      />
    </SettingRow>
  );
}

export { OptionsApp };
