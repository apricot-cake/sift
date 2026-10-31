import {
  CircleMinus,
  ExternalLink,
  Heart,
  Image,
  ImageOff,
  ListFilter,
  type LucideIcon,
  MessageCircle,
  Quote,
  Repeat2,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../utils/i18n.ts";
import { checkPanelBuild } from "../../utils/local-build-reload.ts";
import type { PanelPost } from "../../utils/panel-post.ts";
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
import { usePostLoadMore } from "./use-post-load-more.ts";

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

  const {
    activeContext,
    activeSite,
    knownUnsupportedSite,
    selectedSite,
    runPanelAction,
    captureConnection,
    refreshContext,
  } = usePanelConnection();
  const postLoading = usePostLoadMore(activeContext, () =>
    refreshContext(captureConnection()),
  );

  const saveSettings = (next: Settings): void => {
    const connection = captureConnection();
    const normalized = normalizeSettings(next);
    settingsRef.current = normalized;
    setSettings(normalized);
    void settingsItem
      .setValue(normalized)
      .then(() => refreshContext(connection))
      .catch(() => setStatus(t("optionsErrorSaveFailed")));
  };

  const resetSettings = (): void => {
    if (!resetDialog.current?.open) return;
    if (!resetAllSites && resetSite === null) return;
    resetDialog.current.close();
    if (resetAllSites) {
      saveSettings(defaults);
    } else if (resetSite !== null) {
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

  const setMinimum = (value: number | null): void => {
    runPanelAction(() => {
      saveSiteSettings(selectedSite, {
        ...settingsFor(settingsRef.current, selectedSite),
        minReactionsEnabled: value !== null,
        ...(value !== null ? { minReactions: value } : {}),
      });
    });
  };

  const currentPageIsEditable = activeSite === selectedSite;
  const healthState = activeContext?.health?.state;
  const metricIssue = activeContext?.health?.issue === "metrics";
  const healthMessage =
    metricIssue &&
    selectedSettings.minReactionsEnabled &&
    (healthState === "unreadable" ||
      (healthState === "degraded" &&
        activeContext?.health?.warnPartial === true))
      ? "sidepanelMetricUnavailable"
      : !metricIssue && healthState === "unreadable"
        ? "sidepanelReadFailed"
        : healthState === "loading"
          ? "sidepanelReading"
          : healthState === "empty"
            ? "sidepanelEmpty"
            : !metricIssue &&
                healthState === "degraded" &&
                activeContext?.health?.warnPartial === true
              ? "sidepanelPartialData"
              : null;
  const healthBlocksControls =
    !metricIssue &&
    (healthState === "unreadable" ||
      healthState === "loading" ||
      healthState === "empty");
  const filteringIsAvailable =
    activeContext?.timelineAvailable === true &&
    activeContext.site === selectedSite;
  const pageIsUnsupported =
    !currentPageIsEditable ||
    (activeContext !== null && !activeContext.timelineAvailable);

  const conditionCount = [
    selectedSettings.minReactionsEnabled,
    selectedSettings.mediaEnabled,
    selectedSettings.hideReplies,
    selectedSettings.hideQuotes,
    selectedSettings.hideReposts,
  ].filter(Boolean).length;

  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-sift-sidepanel=""
      data-sift-site={activeSite ?? undefined}
    >
      <div className="relative mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
        <div className="shrink-0 px-4 py-3 empty:hidden" data-panel-notice="">
          {healthMessage !== null && activeSite !== null && (
            <p
              role="status"
              data-page-health={healthState}
              className="m-0 text-sm leading-6 text-muted-foreground"
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
          {pageIsUnsupported && (
            <footer className="mt-5 flex justify-end">
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
          )}
        </div>
        {!pageIsUnsupported && activeContext !== null && (
          <PanelViews
            key={`${activeContext.site}:${activeContext.pageKey}`}
            site={activeContext.site === "x" ? "X" : "Bluesky"}
            postCount={activeContext.posts.length}
            collectedCount={activeContext.collectedCount}
            conditionCount={conditionCount}
            onSelectFilters={postLoading.cancel}
            posts={
              <PostList
                load={postLoading}
                posts={activeContext.posts}
                collectedCount={activeContext.collectedCount}
                truncated={activeContext.collectionTruncated}
                reading={
                  healthState === "loading" || healthState === "unreadable"
                }
              />
            }
            conditions={
              !healthBlocksControls ? (
                <>
                  <fieldset
                    data-filter-controls=""
                    className="m-0 min-w-0 border-0 p-0 disabled:opacity-60"
                    disabled={!filteringIsAvailable}
                  >
                    <div>
                      <section data-minimum-group="">
                        <h2 className="m-0 pb-3 text-sm font-medium">
                          <ItemLabel icon={ListFilter}>
                            {t("optionsMinLikes")}
                          </ItemLabel>
                        </h2>
                        <div className="flex items-center gap-2">
                          <EditableNumberInput
                            key={selectedSite}
                            ariaLabel={t("optionsMinLikes")}
                            className="min-w-0 flex-1 text-left"
                            min={0}
                            max={1_000_000_000}
                            placeholder={t("optionsMinimumNone")}
                            value={
                              selectedSettings.minReactionsEnabled
                                ? selectedSettings.minReactions
                                : null
                            }
                            onValueChange={setMinimum}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10"
                            onClick={() => setMinimum(null)}
                            disabled={!selectedSettings.minReactionsEnabled}
                          >
                            {t("optionsMinimumNone")}
                          </Button>
                        </div>
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
                      <SettingRow
                        icon={Repeat2}
                        label={t("optionsHideReposts")}
                      >
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
                  <p className="mb-0 mt-5 text-xs leading-5 text-muted-foreground">
                    {t("sidepanelSettingsSavedPerSite")}
                  </p>
                  <footer className="mt-5 flex justify-end border-t border-border pt-4">
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
                </>
              ) : (
                <p className="m-0 text-sm leading-6 text-muted-foreground">
                  {t("sidepanelConditionsUnavailable")}
                </p>
              )
            }
          />
        )}
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
          <p
            className="m-0 shrink-0 px-4 py-3 text-sm text-muted-foreground"
            aria-live="polite"
          >
            {status}
          </p>
        )}
      </div>
    </main>
  );
}

type PanelTab = "posts" | "filters";

function PanelViews({
  site,
  postCount,
  collectedCount,
  conditionCount,
  onSelectFilters,
  posts,
  conditions,
}: {
  site: string;
  postCount: number;
  collectedCount: number;
  conditionCount: number;
  onSelectFilters: () => void;
  posts: React.ReactNode;
  conditions: React.ReactNode;
}): React.JSX.Element {
  const [selected, setSelected] = useState<PanelTab>("posts");
  const id = useId();
  const postsPane = useRef<HTMLDivElement>(null);
  const filterPane = useRef<HTMLDivElement>(null);
  const postsTab = useRef<HTMLButtonElement>(null);
  const filterTab = useRef<HTMLButtonElement>(null);
  const positions = useRef<Record<PanelTab, number>>({ posts: 0, filters: 0 });
  const select = (tab: PanelTab): void => {
    if (selected === tab) return;
    if (tab === "filters") onSelectFilters();
    positions.current[selected] =
      (selected === "posts" ? postsPane : filterPane).current?.scrollTop ?? 0;
    setSelected(tab);
  };
  const moveFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: PanelTab,
  ): void => {
    let next: PanelTab;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      next = current === "posts" ? "filters" : "posts";
    else if (event.key === "Home") next = "posts";
    else if (event.key === "End") next = "filters";
    else return;
    event.preventDefault();
    select(next);
    (next === "posts" ? postsTab : filterTab).current?.focus();
  };
  useLayoutEffect(() => {
    const pane = (selected === "posts" ? postsPane : filterPane).current;
    if (pane) pane.scrollTop = positions.current[selected];
  }, [selected]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{site}</span>
          <span data-post-count="" aria-live="polite">
            {t("sidepanelPostCount", {
              count: postCount.toLocaleString(),
              total: collectedCount.toLocaleString(),
            })}
          </span>
        </div>
        <div
          role="tablist"
          aria-label={t("sidepanelViewLabel")}
          data-panel-tabs=""
          className="grid grid-cols-2 gap-2 px-3"
        >
          <button
            ref={postsTab}
            type="button"
            id={`${id}-tab-posts`}
            role="tab"
            aria-selected={selected === "posts"}
            aria-controls={`${id}-pane-posts`}
            aria-label={t("sidepanelPostsTab")}
            tabIndex={selected === "posts" ? 0 : -1}
            data-panel-tab="posts"
            onFocus={() => select("posts")}
            onClick={() => select("posts")}
            onKeyDown={(event) => moveFocus(event, "posts")}
          >
            {t("sidepanelPostsTab")}
          </button>
          <button
            ref={filterTab}
            type="button"
            id={`${id}-tab-filters`}
            role="tab"
            aria-selected={selected === "filters"}
            aria-controls={`${id}-pane-filters`}
            aria-label={t("sidepanelFilterConditions")}
            tabIndex={selected === "filters" ? 0 : -1}
            data-panel-tab="filters"
            onFocus={() => select("filters")}
            onClick={() => select("filters")}
            onKeyDown={(event) => moveFocus(event, "filters")}
          >
            {t("sidepanelFilterConditions")}
            {conditionCount > 0 && (
              <span
                aria-hidden="true"
                title={t("sidepanelActiveConditions", {
                  count: conditionCount,
                })}
                className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs tabular-nums text-primary"
              >
                {conditionCount}
              </span>
            )}
          </button>
        </div>
      </header>
      <div
        ref={postsPane}
        id={`${id}-pane-posts`}
        role="tabpanel"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: APGに従い先頭が非フォーカス要素のtabpanelをTab移動の対象にする。
        tabIndex={0}
        aria-labelledby={`${id}-tab-posts`}
        data-posts-panel=""
        hidden={selected !== "posts"}
        className="min-h-0 flex-1 overflow-y-auto p-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {posts}
      </div>
      <div
        ref={filterPane}
        id={`${id}-pane-filters`}
        role="tabpanel"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: APGに従い先頭が非フォーカス要素のtabpanelをTab移動の対象にする。
        tabIndex={0}
        aria-labelledby={`${id}-tab-filters`}
        data-filter-panel=""
        hidden={selected !== "filters"}
        className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {conditions}
      </div>
    </div>
  );
}

function PostImage({
  image,
  multiple,
}: {
  image: PanelPost["images"][number];
  multiple: boolean;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div
      className="flex h-36 flex-col items-center justify-center gap-2 bg-muted p-3 text-xs text-muted-foreground"
      data-post-image-error=""
    >
      <ImageOff className="size-5" aria-hidden="true" />
      <span>{t("sidepanelImageUnavailable")}</span>
    </div>
  ) : (
    <img
      src={image.url}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={
        multiple
          ? "h-44 w-full bg-muted object-contain"
          : "max-h-96 w-full bg-muted object-contain"
      }
    />
  );
}

const POSTS_PER_PAGE = 50;
const reactionFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function PostList({
  load,
  posts,
  collectedCount,
  truncated,
  reading,
}: {
  load: ReturnType<typeof usePostLoadMore>;
  posts: readonly PanelPost[];
  collectedCount: number;
  truncated: boolean;
  reading: boolean;
}): React.JSX.Element {
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_PAGE);
  const statusId = useId();
  const section = useRef<HTMLElement>(null);
  const more = useRef<() => void>(() => {});
  const stopped =
    load.result !== null &&
    ["limited", "authentication", "limit"].includes(load.result.status);
  more.current = () => {
    if (posts.length > visibleCount) {
      setVisibleCount((count) => count + POSTS_PER_PAGE);
    } else if (
      !load.loading &&
      !stopped &&
      !truncated &&
      !reading &&
      (load.result === null || load.result.status === "loaded")
    ) {
      void load.loadMore();
    }
  };
  useEffect(() => {
    const pane = section.current?.closest<HTMLElement>("[data-posts-panel]");
    if (!pane) return;
    let intentUntil = 0;
    let previous = pane.scrollTop;
    let wheelUsed = false;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let intentSource: "wheel" | "touch" | "other" = "other";
    let touchStart: { x: number; y: number } | null = null;
    let touchUsed = false;
    const atEnd = () =>
      pane.scrollHeight - pane.clientHeight - pane.scrollTop < 160;
    const consume = () => {
      if (pane.hidden || Date.now() >= intentUntil || !atEnd()) return;
      intentUntil = 0;
      if (intentSource === "wheel") wheelUsed = true;
      if (intentSource === "touch") touchUsed = true;
      more.current();
    };
    const wheel = (event: WheelEvent) => {
      clearTimeout(wheelTimer);
      // 慣性を含む一連の入力は1操作。取得完了を起点とする待機は設けない。
      wheelTimer = setTimeout(() => {
        wheelUsed = false;
      }, 200);
      if (
        event.ctrlKey ||
        event.shiftKey ||
        event.deltaY <= 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        intentUntil = 0;
        return;
      }
      if (wheelUsed) return;
      intentSource = "wheel";
      intentUntil = Date.now() + 800;
      consume();
    };
    const startTouch = (event: TouchEvent) => {
      const point = event.touches.length === 1 ? event.touches[0] : null;
      touchStart = point ? { x: point.clientX, y: point.clientY } : null;
      touchUsed = false;
      intentUntil = 0;
    };
    const moveTouch = (event: TouchEvent) => {
      const point = event.touches.length === 1 ? event.touches[0] : null;
      if (!touchStart || !point || touchUsed) return;
      const down = touchStart.y - point.clientY;
      if (down < 30 || down <= Math.abs(touchStart.x - point.clientX)) {
        intentUntil = 0;
        return;
      }
      intentSource = "touch";
      intentUntil = Date.now() + 800;
      consume();
    };
    const endTouch = () => {
      touchStart = null;
      // 指を離した後の慣性スクロールでは次の取得を開始しない。
      intentUntil = 0;
    };
    const drag = (event: PointerEvent) => {
      if (
        event.target === pane &&
        event.pointerType !== "touch" &&
        event.buttons !== 0
      ) {
        intentSource = "other";
        intentUntil = Date.now() + 800;
      }
    };
    const releasePointer = () => {
      if (intentSource === "other") intentUntil = 0;
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'button, input, textarea, select, [role="button"], [role="combobox"], [contenteditable]:not([contenteditable="false"])',
          ))
      ) {
        intentUntil = 0;
        return;
      }
      intentSource = "other";
      intentUntil = ["ArrowDown", "PageDown", "End", " "].includes(event.key)
        ? Date.now() + 800
        : 0;
      consume();
    };
    const scroll = () => {
      const down = pane.scrollTop > previous;
      previous = pane.scrollTop;
      if (
        !pane.hidden &&
        Date.now() < intentUntil &&
        down &&
        pane.scrollHeight - pane.clientHeight - pane.scrollTop < 160
      ) {
        consume();
      }
    };
    pane.addEventListener("wheel", wheel, { passive: true });
    pane.addEventListener("touchstart", startTouch, { passive: true });
    pane.addEventListener("touchmove", moveTouch, { passive: true });
    pane.addEventListener("touchend", endTouch, { passive: true });
    pane.addEventListener("touchcancel", endTouch, { passive: true });
    pane.addEventListener("pointerdown", drag);
    pane.addEventListener("pointermove", drag, { passive: true });
    pane.addEventListener("pointerup", releasePointer);
    pane.addEventListener("pointercancel", releasePointer);
    pane.addEventListener("keydown", key);
    pane.addEventListener("scroll", scroll, { passive: true });
    return () => {
      pane.removeEventListener("wheel", wheel);
      clearTimeout(wheelTimer);
      pane.removeEventListener("touchstart", startTouch);
      pane.removeEventListener("touchmove", moveTouch);
      pane.removeEventListener("touchend", endTouch);
      pane.removeEventListener("touchcancel", endTouch);
      pane.removeEventListener("pointerdown", drag);
      pane.removeEventListener("pointermove", drag);
      pane.removeEventListener("pointerup", releasePointer);
      pane.removeEventListener("pointercancel", releasePointer);
      pane.removeEventListener("keydown", key);
      pane.removeEventListener("scroll", scroll);
    };
  }, []);
  const statusMessage = load.loading
    ? t("sidepanelLoadLoading")
    : load.result?.status === "loaded"
      ? t("sidepanelLoadLoaded", { count: load.result.added })
      : load.result?.status === "limited"
        ? t("sidepanelLoadLimited")
        : load.result?.status === "authentication"
          ? t("sidepanelLoadAuthentication")
          : load.result?.status === "limit"
            ? t("sidepanelCollectionLimit", {
                count: collectedCount.toLocaleString(),
              })
            : load.result?.status === "unsupported"
              ? t("sidepanelLoadUnsupported")
              : load.result?.status === "cancelled"
                ? t("sidepanelLoadCancelled")
                : load.result?.status === "no-progress"
                  ? t("sidepanelLoadNoProgress")
                  : load.result?.status === "failed"
                    ? t("sidepanelLoadFailed")
                    : "";
  const hasMoreCollected = posts.length > visibleCount;
  const retry =
    !load.loading &&
    !stopped &&
    load.result !== null &&
    load.result.status !== "loaded";
  const showHint =
    hasMoreCollected ||
    (!truncated && !reading && !load.loading && !stopped && !retry);
  return (
    <section
      ref={section}
      aria-label={t("sidepanelPostsTitle")}
      aria-busy={load.loading}
      data-load-request-count={load.requestCount}
      data-has-more-collected={hasMoreCollected}
    >
      {truncated && (
        <p
          className="mb-4 text-xs leading-5 text-muted-foreground"
          role="status"
        >
          {t("sidepanelCollectionLimit", {
            count: collectedCount.toLocaleString(),
          })}
        </p>
      )}
      {posts.length === 0 ? (
        !reading && (
          <p
            className="py-8 text-sm leading-6 text-muted-foreground"
            data-post-empty=""
          >
            {t(
              collectedCount === 0
                ? "sidepanelNoCollectedPosts"
                : "sidepanelNoMatchingPosts",
            )}
          </p>
        )
      ) : (
        <ul className="m-0 list-none space-y-3 p-0" data-post-list="">
          {posts.slice(0, visibleCount).map((post) => (
            <PostRow key={post.id} post={post} />
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        <p
          id={statusId}
          role="status"
          data-load-more-status=""
          data-status={load.loading ? "loading" : load.result?.status}
          data-added={load.result?.added ?? 0}
          data-request-count={load.requestCount}
          className={
            statusMessage
              ? "m-0 text-xs leading-5 text-muted-foreground"
              : "sr-only"
          }
        >
          {statusMessage}
        </p>
        {showHint && (
          <p
            className="m-0 py-2 text-center text-xs leading-5 text-muted-foreground"
            data-load-more-hint=""
          >
            {t("sidepanelLoadHint")}
          </p>
        )}
        {retry && !truncated && (
          <Button
            className="w-full"
            variant="outline"
            data-load-more-posts=""
            aria-describedby={statusMessage ? statusId : undefined}
            disabled={reading}
            onClick={() => void load.loadMore()}
          >
            {t("sidepanelLoadRetry")}
          </Button>
        )}
        {load.loading && (
          <Button className="w-full" variant="ghost" onClick={load.cancel}>
            {t("sidepanelLoadCancel")}
          </Button>
        )}
      </div>
    </section>
  );
}

function PostRow({ post }: { post: PanelPost }): React.JSX.Element {
  return (
    <li data-post-id={post.id}>
      <a
        href={post.url}
        target="_blank"
        rel="noreferrer"
        data-post-link=""
        className="block overflow-hidden rounded-xl border border-border bg-card text-foreground no-underline transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="flex items-start justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-medium">
              {post.author ||
                (post.handle
                  ? post.handle.startsWith("@")
                    ? post.handle
                    : `@${post.handle}`
                  : t("sidepanelPostFallback"))}
            </p>
            {post.author && post.handle && (
              <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
                {post.handle.startsWith("@") ? post.handle : `@${post.handle}`}
              </p>
            )}
          </div>
          <ExternalLink
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        {post.images.length > 0 && (
          <div
            data-post-media=""
            className={
              post.images.length > 1
                ? "grid grid-cols-2 gap-px bg-border"
                : "bg-muted"
            }
          >
            {post.images.map((image) => (
              <PostImage
                key={image.url}
                image={image}
                multiple={post.images.length > 1}
              />
            ))}
          </div>
        )}
        {post.text && (
          <p className="m-0 line-clamp-3 whitespace-pre-line break-words px-3 pt-3 text-sm leading-6">
            {post.text}
          </p>
        )}
        <p className="m-0 flex items-center gap-1.5 p-3 text-xs text-muted-foreground">
          <Heart className="size-3.5" aria-hidden="true" />
          <span>
            {post.metricCount === null
              ? t("sidepanelLikesUnknown")
              : t("sidepanelPostLikes", {
                  count: reactionFormatter.format(post.metricCount),
                })}
          </span>
        </p>
      </a>
    </li>
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
      className="flex min-h-10 items-center justify-between gap-3"
      data-setting-row=""
    >
      <span className="min-w-0 text-sm">
        {icon ? <ItemLabel icon={icon}>{label}</ItemLabel> : label}
      </span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function EditableNumberInput({
  ariaLabel,
  className = "w-24",
  disabled = false,
  placeholder,
  min,
  max = Number.MAX_SAFE_INTEGER,
  onValueChange,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  min: number;
  max?: number;
  onValueChange: (value: number | null) => void;
  value: number | null;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setDraft(value === null ? "" : String(value));
    }
  }, [value]);

  const commit = (): void => {
    editing.current = false;
    if (draft.trim() === "") {
      if (value !== null) onValueChange(null);
      return;
    }
    const parsed = Number(draft);
    if (!Number.isSafeInteger(parsed)) {
      setDraft(value === null ? "" : String(value));
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
      className={`${className} tabular-nums`}
      disabled={disabled}
      placeholder={placeholder}
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
        if (rawValue === "" && !event.currentTarget.validity.badInput) {
          onValueChange(null);
          return;
        }
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
        <SelectTrigger className="w-full" aria-label={t("optionsMedia")}>
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
