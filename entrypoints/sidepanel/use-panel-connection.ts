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
import { checkPanelBuild } from "../../utils/local-build-reload.ts";
import { isKnownUnsupportedSite } from "../../utils/panel-connection.ts";
import {
  normalizeSettings,
  type Settings,
  type SiteSettingsKey,
  settingsFor,
  withSiteSettings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import {
  isSidePanelTabRequest,
  SIDE_PANEL_CONTROL,
  sidePanelTabIdFromUrl,
} from "../../utils/sidepanel-controls.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";

interface ConnectedPage {
  tabId: number;
  pageKey: string;
  url?: string;
}

interface ConnectionSnapshot {
  epoch: number;
  page: ConnectedPage | null;
}

interface PanelConnectionOptions {
  onSettingsInitialized: (settings: Settings) => void;
  onMinimumReset: () => void;
}

async function readFilterContext(
  tabId: number,
): Promise<FilterContextResponse | null> {
  return browser.tabs
    .sendMessage(tabId, { type: FILTER_CONTEXT_REQUEST })
    .then((response) => (isFilterContextResponse(response) ? response : null))
    .catch(() => null);
}

/** 所有タブへの接続、更新の購読、遅れた応答の破棄を管理する。 */
export function usePanelConnection({
  onSettingsInitialized,
  onMinimumReset,
}: PanelConnectionOptions) {
  const [activeContext, setActiveContext] =
    useState<FilterContextResponse | null>(null);
  const [knownUnsupportedSite, setKnownUnsupportedSite] = useState(false);
  const [selectedSite, setSelectedSite] = useState<SiteSettingsKey>("x");
  const [pageFilteringEnabled, setPageFilteringEnabled] = useState(false);
  const activePageRef = useRef<ConnectedPage | null>(null);
  const connectionEpoch = useRef(0);
  const panelMounted = useRef(true);
  const panelTabId = useRef(sidePanelTabIdFromUrl(location.href));
  const panelInitialized = useRef(false);
  const initializedMinimums = useRef(new Set<SiteSettingsKey>());
  const pageFilteringExpected = useRef(false);

  const runPanelAction = (action: () => void): void => {
    const epoch = connectionEpoch.current;
    void checkPanelBuild().then((current) => {
      if (
        current &&
        panelMounted.current &&
        epoch === connectionEpoch.current &&
        document.visibilityState !== "hidden"
      )
        action();
    });
  };

  useEffect(() => {
    panelMounted.current = true;
    return () => {
      panelMounted.current = false;
      connectionEpoch.current += 1;
      const activePage = activePageRef.current;
      if (activePage !== null) {
        void browser.tabs
          .sendMessage(activePage.tabId, {
            type: TIMELINE_CONTROL.setFiltering,
            enabled: false,
          })
          .catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    // 初回の設定初期化やフィルター有効化も、更新確認が終わるまで待つ。
    // 定期的なページ情報取得では Native Host へ問い合わせない。
    const openingBuild = checkPanelBuild();
    let refreshGeneration = 0;
    let activeRefresh: number | null = null;
    let disposed = false;
    let connectionAttempt: string | null = null;
    const refreshActiveHost = async (forceSelection = false): Promise<void> => {
      if (disposed) return;
      if (forceSelection) connectionEpoch.current += 1;
      if (document.visibilityState === "hidden") {
        if (forceSelection) {
          refreshGeneration += 1;
          activeRefresh = null;
        }
        return;
      }
      // 定期取得は進行中の応答を待つ。接続先の変更だけが古い取得を無効にする。
      if (!forceSelection && activeRefresh !== null) return;
      const generation = ++refreshGeneration;
      activeRefresh = generation;
      const isCurrent = () =>
        !disposed &&
        generation === refreshGeneration &&
        document.visibilityState !== "hidden";
      try {
        if (!(await openingBuild) || !isCurrent()) return;
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!isCurrent()) return;
        if (panelTabId.current !== tab?.id) {
          return;
        }
        const isCurrentTab = async (): Promise<boolean> => {
          const [currentTab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          return (
            isCurrent() &&
            currentTab?.id === tab?.id &&
            currentTab?.url === tab?.url
          );
        };
        setKnownUnsupportedSite(isKnownUnsupportedSite(tab?.url));
        const panelTabMatches = panelTabId.current === tab?.id;
        let context: FilterContextResponse | null = null;
        if (tab?.id !== undefined) {
          context = await readFilterContext(tab.id);
          if (!isCurrent()) return;
          const attemptKey = `${tab.id}:${tab.url ?? ""}`;
          if (
            context === null &&
            connectionAttempt !== attemptKey &&
            !isKnownUnsupportedSite(tab.url)
          ) {
            connectionAttempt = attemptKey;
            await browser.runtime
              .sendMessage({
                type: SIDE_PANEL_CONTROL.connectTab,
                tabId: tab.id,
              })
              .catch(() => {});
            if (!isCurrent()) return;
            context = await readFilterContext(tab.id);
          }
          if (!isCurrent()) return;
          if (context !== null) connectionAttempt = null;
        }
        if (!(await isCurrentTab())) return;
        if (tab?.id !== undefined) {
          const closed = await browser.runtime
            .sendMessage({
              type: SIDE_PANEL_CONTROL.checkPage,
              tabId: tab.id,
            })
            .catch(() => false);
          if (!isCurrent() || closed === true) return;
        }
        const nextPage =
          tab?.id !== undefined && context?.timelineAvailable
            ? { tabId: tab.id, pageKey: context.pageKey, url: tab.url }
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
          try {
            const stored = normalizeSettings(await settingsItem.getValue());
            if (!(await isCurrentTab())) return;
            const siteSettings = settingsFor(stored, context.site);
            const next = withSiteSettings(stored, context.site, {
              ...siteSettings,
              minReactionsEnabled: false,
            });
            initializedMinimums.current.add(context.site);
            await settingsItem.setValue(next);
            if (!(await isCurrentTab())) return;
            onSettingsInitialized(next);
          } catch (error) {
            if (isCurrent()) initializedMinimums.current.delete(context.site);
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
        if (site !== null) {
          setSelectedSite(site);
        }
      } catch {
      } finally {
        if (activeRefresh === generation) activeRefresh = null;
      }
    };

    const handleTabActivated = () => void refreshActiveHost(true);
    const handleTabUpdated = (
      tabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
    ): void => {
      if (
        tabId === panelTabId.current &&
        (changeInfo.url !== undefined || changeInfo.status === "loading")
      ) {
        void refreshActiveHost(true);
      }
    };
    const handlePanelTab = (message: unknown): void => {
      if (
        !isSidePanelTabRequest(message) ||
        message.tabId !== panelTabId.current
      ) {
        return;
      }
      if (message.resetMinimum === true) {
        initializedMinimums.current.clear();
        onMinimumReset();
      }
      void refreshActiveHost(true);
    };
    void refreshActiveHost(true);
    const handleVisibility = () => void refreshActiveHost(true);
    document.addEventListener("visibilitychange", handleVisibility);
    const contextTimer = window.setInterval(() => {
      void refreshActiveHost();
    }, 750);
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.runtime.onMessage.addListener(handlePanelTab);
    return () => {
      disposed = true;
      refreshGeneration += 1;
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      browser.runtime.onMessage.removeListener(handlePanelTab);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(contextTimer);
    };
  }, [onSettingsInitialized, onMinimumReset]);

  const updateFiltering = (enabled: boolean): void => {
    const epoch = connectionEpoch.current;
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
        if (
          !panelMounted.current ||
          epoch !== connectionEpoch.current ||
          activePageRef.current?.pageKey !== activePage.pageKey
        )
          return;
        pageFilteringExpected.current = false;
        setPageFilteringEnabled(false);
      });
  };

  const captureConnection = (): ConnectionSnapshot => ({
    epoch: connectionEpoch.current,
    page: activePageRef.current,
  });

  /** 設定の保存中に接続先が変わった場合は有効化を再送しない。 */
  const restoreFiltering = async ({
    epoch,
    page,
  }: ConnectionSnapshot): Promise<void> => {
    if (
      !panelMounted.current ||
      epoch !== connectionEpoch.current ||
      document.visibilityState === "hidden" ||
      page === null
    )
      return;
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activePage = activePageRef.current;
    if (
      panelMounted.current &&
      epoch === connectionEpoch.current &&
      document.visibilityState === "visible" &&
      tab?.id === page.tabId &&
      tab.url === page.url &&
      activePage?.tabId === page.tabId &&
      activePage.pageKey === page.pageKey
    ) {
      updateFiltering(true);
    }
  };

  return {
    activeContext,
    activeSite: activeContext?.site ?? null,
    knownUnsupportedSite,
    selectedSite,
    pageFilteringEnabled,
    runPanelAction,
    updateFiltering,
    captureConnection,
    restoreFiltering,
  };
}
