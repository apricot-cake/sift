import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HTTPRequest, Page } from "puppeteer-core";

export type LiveSite = "x" | "bluesky" | "youtube" | "niconico";
export function liveSite(url: string): LiveSite | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (
    host === "x.com" ||
    host.endsWith(".x.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com")
  )
    return "x";
  if (
    host === "bsky.app" ||
    host.endsWith(".bsky.app") ||
    host === "bsky.social" ||
    host.endsWith(".bsky.social") ||
    host.endsWith(".host.bsky.network")
  )
    return "bluesky";
  if (host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "nicovideo.jp" || host.endsWith(".nicovideo.jp"))
    return "niconico";
  return undefined;
}

interface SiteLoad {
  navigations: number;
  dataRequests: number;
  lastNavigation: number;
  blocked?: string;
  retryAfter?: string;
  blockedUntil?: number;
  navigationWaitMs?: number;
}
interface LoadState {
  runId: string;
  sites: Partial<Record<LiveSite, SiteLoad>>;
}
// 公式の安全閾値ではなく、検証が過剰に巡回するのを防ぐ内部予算。
export const LIVE_LOAD_LIMITS = {
  navigations: 40,
  dataRequests: 400,
  caseDataRequests: 60,
  navigationGapMs: 2000,
};

// 生URLやqueryId、検索語、本文を記録せず、同じAPI操作を集計する。
export function networkEndpoint(rawUrl: string): string {
  const url = new URL(rawUrl);
  const route = url.pathname.replace(/\/+/g, "/");
  if (liveSite(rawUrl) === "x") {
    const graphql = route.match(
      /^\/i\/api\/graphql\/[^/]+\/([A-Za-z][A-Za-z0-9_]{0,79})\/?$/,
    );
    if (graphql) return `graphql/${graphql[1]}`;
    const legacyGraphql = route.match(
      /^\/(?:i\/api\/)?1\.1\/graphql\/([A-Za-z][A-Za-z0-9_]{0,79})\.json\/?$/,
    );
    if (legacyGraphql) return `graphql/${legacyGraphql[1]}`;
    if (route.startsWith("/i/api/") || /^\/(?:1\.1|2)\//.test(route)) {
      const known = new Set([
        "i",
        "api",
        "1.1",
        "2",
        "account",
        "settings",
        "verify_credentials",
        "help",
        "configuration",
        "users",
        "lookup",
        "show",
        "search",
        "timeline",
        "home",
        "notifications",
        "badge_count",
        "statuses",
        "update",
        "friendships",
        "create",
        "destroy",
        "graphql",
        "client_event",
        "jot",
      ]);
      const apiRoute = route.startsWith("/i/api/") ? route : `/i/api${route}`;
      return apiRoute
        .split("/")
        .filter(Boolean)
        .map((part) => {
          const bare = part.replace(/\.json$/, "");
          return /^\d+$/.test(bare)
            ? ":id"
            : known.has(bare)
              ? bare
              : ":segment";
        })
        .join("/");
    }
  }
  const xrpc = route.match(
    /^\/xrpc\/((?:app\.bsky|com\.atproto)\.[A-Za-z.]{1,100})$/,
  );
  if (xrpc) return `xrpc/${xrpc[1]}`;
  const youtube = route.match(
    /^\/youtubei\/v1\/(browse|next|player|search|guide|log_event|att|notification\/get_notification_menu|account\/account_menu)$/,
  );
  if (youtube) return `youtubei/v1/${youtube[1]}`;
  // その他のパスの自由入力部分も保存しない。
  const known = new Set([
    "home",
    "search",
    "explore",
    "login",
    "i",
    "flow",
    "lists",
    "status",
    "video",
    "photo",
    "videos",
    "streams",
    "watch",
    "channel",
    "profile",
    "feed",
    "list",
    "api",
    "v1",
    "v2",
    "users",
    "user",
    "channels",
    "history",
    "recommendations",
    "analytics",
    "log",
    "events",
    "collect",
    "jot",
  ]);
  return (
    route
      .split("/")
      .filter(Boolean)
      .map((part) =>
        /^\d+$/.test(part) ? ":id" : known.has(part) ? part : ":segment",
      )
      .join("/") || "root"
  );
}

interface NetworkRequestRecord {
  requestId: string;
  startedAt: string;
  caseId: string;
  phase: string;
  site?: LiveSite;
  host: string;
  endpoint: string;
  method: string;
  resourceType: string;
  navigation: boolean;
  pagination: "initial" | "continuation" | "unknown";
}

export function networkPagination(
  rawUrl: string,
): NetworkRequestRecord["pagination"] {
  const url = new URL(rawUrl);
  const route = url.pathname.replace(/\/+/g, "/");
  if (!/^\/(?:i\/api\/)?(?:1\.1\/)?graphql\//.test(route)) return "unknown";
  const variables = url.searchParams.get("variables");
  if (!variables) return "unknown";
  try {
    const parsed: unknown = JSON.parse(variables);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return "unknown";
    const cursor = (parsed as Record<string, unknown>).cursor;
    return typeof cursor === "string" && cursor.length > 0
      ? "continuation"
      : "initial";
  } catch {
    return "unknown";
  }
}
export class LiveLoadBudget {
  readonly file: string;
  readonly runId: string;
  constructor(
    file = path.resolve("test-results/live-load.json"),
    runId = process.env.SIFT_LIVE_RUN_ID ?? new Date().toISOString(),
  ) {
    this.file = file;
    this.runId = runId;
  }
  read(): LoadState {
    if (fs.existsSync(this.file)) {
      const state = JSON.parse(fs.readFileSync(this.file, "utf8")) as LoadState;
      if (state.runId === this.runId) return state;
      const sites: LoadState["sites"] = {};
      for (const [site, load] of Object.entries(state.sites)) {
        if ((load.blockedUntil ?? 0) > Date.now())
          sites[site as LiveSite] = {
            ...load,
            navigations: 0,
            dataRequests: 0,
            lastNavigation: 0,
          };
      }
      return { runId: this.runId, sites };
    }
    return { runId: this.runId, sites: {} };
  }
  private write(state: LoadState) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2));
  }
  assert(site?: LiveSite) {
    if (!site) return;
    const blocked = this.read().sites[site]?.blocked;
    if (blocked)
      throw new Error(`${site} の実機検証を停止しました: ${blocked}`);
  }
  stop(site: LiveSite, reason: string, retryAfter?: string) {
    const state = this.read();
    const load = state.sites[site] ?? {
      navigations: 0,
      dataRequests: 0,
      lastNavigation: 0,
    };
    load.blocked ??= reason;
    if (retryAfter) load.retryAfter = retryAfter;
    if (reason.includes("429")) {
      const seconds =
        retryAfter && /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : null;
      const until =
        seconds !== null ? Date.now() + seconds : Date.parse(retryAfter ?? "");
      load.blockedUntil =
        Number.isFinite(until) && until > Date.now()
          ? until
          : Date.now() + 15 * 60 * 1000;
    }
    state.sites[site] = load;
    this.write(state);
  }
  request(
    site: LiveSite,
    navigation: boolean,
    data: boolean,
    now = Date.now(),
  ) {
    this.assert(site);
    const state = this.read();
    const load = state.sites[site] ?? {
      navigations: 0,
      dataRequests: 0,
      lastNavigation: 0,
    };
    const wait = navigation
      ? Math.max(
          0,
          load.lastNavigation + LIVE_LOAD_LIMITS.navigationGapMs - now,
        )
      : 0;
    if (navigation) {
      load.navigations++;
      load.lastNavigation = now + wait;
      load.navigationWaitMs = (load.navigationWaitMs ?? 0) + wait;
    }
    if (data) load.dataRequests++;
    state.sites[site] = load;
    this.write(state);
    if (
      load.navigations > LIVE_LOAD_LIMITS.navigations ||
      load.dataRequests > LIVE_LOAD_LIMITS.dataRequests
    ) {
      this.stop(site, "通信予算の上限に達しました（未完了）");
      this.assert(site);
    }
    return wait;
  }
}

export class LiveLoadGuard {
  readonly budget: LiveLoadBudget;
  private pages = new WeakSet<Page>();
  private counts = new WeakMap<Page, { requests: number }>();
  private context = { caseId: "unassigned", phase: "unassigned" };
  private requests = new WeakMap<HTTPRequest, NetworkRequestRecord>();
  readonly networkFile: string;
  constructor(budget = new LiveLoadBudget()) {
    this.budget = budget;
    this.networkFile = `${budget.file.replace(/\.json$/, "")}.network.jsonl`;
  }
  setContext(caseId: string, phase: string) {
    this.context = { caseId, phase };
  }
  private record(event: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(this.networkFile), { recursive: true });
    fs.appendFileSync(
      this.networkFile,
      `${JSON.stringify({
        runId: this.budget.runId,
        at: new Date().toISOString(),
        ...event,
      })}\n`,
    );
  }
  async watch(page: Page) {
    if (this.pages.has(page)) return;
    this.pages.add(page);
    const count = { requests: 0 };
    this.counts.set(page, count);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void handle(request);
    });
    const handle = async (request: HTTPRequest) => {
      if (request.isInterceptResolutionHandled()) return;
      const site = liveSite(request.url());
      const pageSite = liveSite(page.url());
      const navigation =
        request.isNavigationRequest() && request.frame() === page.mainFrame();
      const data =
        request.resourceType() === "xhr" || request.resourceType() === "fetch";
      let entry: NetworkRequestRecord | undefined;
      if ((navigation || data) && /^https?:/.test(request.url())) {
        const url = new URL(request.url());
        entry = {
          requestId: randomUUID(),
          startedAt: new Date().toISOString(),
          ...this.context,
          site,
          host: url.hostname,
          endpoint: networkEndpoint(request.url()),
          method:
            typeof request.method === "function" ? request.method() : "unknown",
          resourceType: request.resourceType(),
          navigation,
          pagination: networkPagination(request.url()),
        };
        this.requests.set(request, entry);
      }
      try {
        this.budget.assert(pageSite);
        this.budget.assert(site);
        let wait = 0;
        if (site && (navigation || data)) {
          wait = this.budget.request(site, navigation, data);
          if (data && ++count.requests > LIVE_LOAD_LIMITS.caseDataRequests) {
            this.budget.stop(
              site,
              "ケースの追加取得予算に達しました（未完了）",
            );
            this.budget.assert(site);
          }
        }
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        this.budget.assert(pageSite);
        this.budget.assert(site);
        if (!request.isInterceptResolutionHandled()) {
          await request.continue();
          if (entry)
            this.record({
              event: "request",
              ...entry,
              disposition: "continued",
            });
        }
      } catch {
        if (!request.isInterceptResolutionHandled()) {
          await request.abort("blockedbyclient").catch(() => {});
          if (entry)
            this.record({ event: "request", ...entry, disposition: "aborted" });
        }
      }
    };
    page.on("response", (response) => {
      const entry = this.requests.get(response.request());
      if (entry)
        this.record({
          event: "response",
          ...entry,
          status: response.status(),
          fromCache: response.fromCache(),
          fromServiceWorker: response.fromServiceWorker(),
        });
      const site = liveSite(response.url());
      if (!site) return;
      const request = response.request();
      const main =
        request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (response.status() === 429)
        this.budget.stop(
          site,
          "HTTP 429（利用制限）",
          response.headers()["retry-after"],
        );
      else if (main && (response.status() === 401 || response.status() === 403))
        this.budget.stop(
          site,
          `HTTP ${response.status()}（認証・アクセス拒否）`,
        );
    });
    page.on("requestfailed", (request) => {
      const entry = this.requests.get(request);
      if (entry) this.record({ event: "requestfailed", ...entry });
    });
  }
  beginCase(page: Page) {
    const count = this.counts.get(page);
    if (count) count.requests = 0;
  }
  async assertPage(page: Page) {
    const site = liveSite(page.url());
    this.budget.assert(site);
    if (!site) return;
    const blocked = await page.evaluate(() => {
      const route = location.pathname;
      if (
        /^\/(?:login|i\/flow\/login|account\/access|checkpoint|challenge)(?:\/|$)/.test(
          route,
        )
      )
        return "認証・確認画面";
      if (
        document.querySelector(
          'iframe[src*="captcha"], [id="challenge-form"], [data-testid="captcha"]',
        )
      )
        return "確認画面";
      const messages = Array.from(
        document.querySelectorAll(
          '[role="alert"], [data-testid="errorMessage"], [data-testid="error-detail"]',
        ),
      );
      if (
        messages.some(
          (element) =>
            element.checkVisibility({ visibilityProperty: true }) &&
            /(?:rate limit exceeded|too many requests|you are rate limited|利用制限|アクセスが集中)/i.test(
              element.textContent ?? "",
            ),
        )
      )
        return "利用制限の案内";
      return null;
    });
    if (blocked) {
      this.budget.stop(site, blocked);
      this.budget.assert(site);
    }
  }
}
