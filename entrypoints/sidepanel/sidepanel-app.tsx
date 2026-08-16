import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { t } from "../../utils/i18n.ts";
import {
  defaults,
  normalizeSettings,
  type Settings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
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

function SidepanelApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(
    normalizeSettings(defaults),
  );
  const [status, setStatus] = useState(t("optionsStatusLoading"));
  const statusTimer = useRef<number | null>(null);

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

  const updateSetting = <Key extends keyof Settings>(
    key: Key,
    value: Settings[Key],
  ): void => saveSettings({ ...settings, [key]: value });

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
        </header>

        <SettingsGroup title={t("optionsSectionVisible")}>
          <SettingRow label={t("optionsMedia")}>
            <Select
              value={settings.mediaMode}
              onValueChange={(value) =>
                updateSetting("mediaMode", value as Settings["mediaMode"])
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("optionsMediaAny")}</SelectItem>
                <SelectItem value="images">
                  {t("optionsMediaImages")}
                </SelectItem>
                <SelectItem value="video">{t("optionsMediaVideo")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title={t("optionsSectionStandard")}>
          <NumberSetting
            label={t("optionsMinLikes")}
            min={0}
            onValueChange={(value) => updateSetting("minLikes", value)}
            step={10}
            value={settings.minLikes}
          />
          <NumberSetting
            label={t("optionsMinReactions")}
            min={0}
            onValueChange={(value) =>
              updateSetting("misskeyMinReactions", value)
            }
            step={1}
            value={settings.misskeyMinReactions}
          />
        </SettingsGroup>

        <SettingsGroup title={t("optionsSectionRising")}>
          <SettingRow label={t("optionsRisingEnabled")}>
            <Switch
              checked={settings.risingEnabled}
              onCheckedChange={(value) => updateSetting("risingEnabled", value)}
            />
          </SettingRow>
          {settings.risingEnabled && (
            <>
              <NumberSetting
                label={t("optionsMinLikes")}
                min={0}
                onValueChange={(value) =>
                  updateSetting("risingMinLikes", value)
                }
                step={10}
                value={settings.risingMinLikes}
              />
              <NumberSetting
                label={t("optionsMinReactions")}
                min={0}
                onValueChange={(value) =>
                  updateSetting("misskeyRisingMinReactions", value)
                }
                step={1}
                value={settings.misskeyRisingMinReactions}
              />
              <NumberSetting
                label={t("optionsMaxAge")}
                min={1}
                onValueChange={(value) =>
                  updateSetting("risingMaxAgeHours", value)
                }
                step={1}
                suffix={t("optionsUnitHours")}
                value={settings.risingMaxAgeHours}
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
              value={settings.excludedKeywords}
              onChange={(event) =>
                updateSetting("excludedKeywords", event.currentTarget.value)
              }
            />
          </div>
          <SettingRow label={t("optionsHideReposts")}>
            <Switch
              checked={settings.hideReposts}
              onCheckedChange={(value) => updateSetting("hideReposts", value)}
            />
          </SettingRow>
        </SettingsGroup>

        <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
          {status || t("optionsAutosaveNote")}
        </p>
        <Button
          className="mt-5 w-full"
          variant="outline"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          {t("sidepanelOpenOptions")}
        </Button>
      </div>
    </main>
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
    <section className="mt-7" aria-label={title}>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
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
    <div className="flex min-h-16 items-center justify-between gap-5 p-5 sm:px-6">
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
  suffix,
  value,
}: {
  label: string;
  min: number;
  onValueChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
}): React.JSX.Element {
  return (
    <SettingRow label={label}>
      <div className="flex items-center gap-2">
        <Input
          className="w-24 text-right tabular-nums"
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onValueChange(Number(event.currentTarget.value))}
        />
        {suffix && (
          <span className="text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
    </SettingRow>
  );
}

export { SidepanelApp };
