import { Server } from "lucide-react";
import { useEffect, useState } from "react";
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

function OptionsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(
    normalizeSettings(defaults),
  );
  const [status, setStatus] = useState(t("optionsStatusLoading"));
  const [instanceHost, setInstanceHost] = useState("");
  const [instanceError, setInstanceError] = useState("");
  const [isSubmittingInstance, setIsSubmittingInstance] = useState(false);

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
      .catch(() => setStatus(t("optionsErrorLoadFailed")));

    return settingsItem.watch(updateSettings);
  }, []);

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
      <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Server className="size-5" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("optionsTitle")}
            </h1>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {t("optionsTagline")}
          </p>
        </header>

        <section aria-labelledby="instances-heading">
          <h2
            id="instances-heading"
            className="mb-4 text-xl font-semibold tracking-tight"
          >
            {t("optionsSectionInstances")}
          </h2>
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
                        onClick={() => void removeInstance(host, instanceDeps)}
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
                  <p className="mt-2 text-sm text-destructive" role="alert">
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

        <p className="mt-8 min-h-5 text-sm text-primary" aria-live="polite">
          {status}
        </p>
      </div>
    </main>
  );
}

export { OptionsApp };
