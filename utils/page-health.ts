export type PageSupport = "supported" | "unsupported" | "unknown";
export type PageHealthState =
  | "ready"
  | "loading"
  | "empty"
  | "unsupported"
  | "unreadable"
  | "degraded";
export type PageHealthIssue = "page" | "posts" | "metrics" | "dates";

export interface PageHealth {
  warnPartial?: boolean;
  state: PageHealthState;
  issue?: PageHealthIssue;
  sampledPosts: number;
  readableMetrics: number;
  readableDates: number;
}

export interface PageHealthObservation {
  requiresMetrics?: boolean;
  knownMetricOmissions?: number;
  pageKey: string;
  support: PageSupport;
  empty: boolean;
  requiresDates: boolean;
  sampledPosts: number;
  readableMetrics: number;
  readableDates: number;
}

/** 一時的な描き直しを猶予し、カード未取得を空一覧とは扱わない。 */
export class PageHealthTracker {
  private failureKey = "";
  private failureSince = 0;
  private partialKey = "";
  private partialSince = 0;

  private readonly graceMs: number;

  constructor(graceMs = 8000) {
    this.graceMs = graceMs;
  }

  observe(observation: PageHealthObservation, now = Date.now()): PageHealth {
    const {
      pageKey,
      support,
      empty,
      requiresDates,
      sampledPosts,
      readableMetrics,
      readableDates,
    } = observation;
    const counts = { sampledPosts, readableMetrics, readableDates };
    const requiredIssue =
      observation.requiresMetrics &&
      readableMetrics + (observation.knownMetricOmissions ?? 0) < sampledPosts
        ? "metrics"
        : requiresDates && readableDates < sampledPosts
          ? "dates"
          : undefined;
    const partialKey =
      support === "supported" && sampledPosts > 0 && requiredIssue
        ? `${pageKey}:${requiredIssue}`
        : "";
    if (partialKey !== this.partialKey) {
      this.partialKey = partialKey;
      this.partialSince = now;
    }
    if (support === "unsupported") {
      this.failureKey = "";
      return { state: "unsupported", ...counts };
    }
    if (support === "supported" && sampledPosts === 0 && empty) {
      this.failureKey = "";
      return { state: "empty", ...counts };
    }
    const issue: PageHealthIssue | undefined =
      support === "unknown"
        ? "page"
        : sampledPosts === 0
          ? "posts"
          : readableMetrics === 0 &&
              observation.knownMetricOmissions !== sampledPosts
            ? "metrics"
            : requiresDates && readableDates === 0
              ? "dates"
              : undefined;
    if (issue) {
      const key = `${pageKey}:${issue}`;
      if (key !== this.failureKey) {
        this.failureKey = key;
        this.failureSince = now;
      }
      return {
        state:
          now - this.failureSince < this.graceMs ? "loading" : "unreadable",
        issue,
        ...counts,
      };
    }
    this.failureKey = "";
    const partial =
      readableMetrics < sampledPosts
        ? "metrics"
        : requiresDates && readableDates < sampledPosts
          ? "dates"
          : undefined;
    return {
      state: partial ? "degraded" : "ready",
      warnPartial:
        Boolean(partialKey) && now - this.partialSince >= this.graceMs,
      ...(partial ? { issue: partial } : {}),
      ...counts,
    };
  }
}

export function isPageHealth(value: unknown): value is PageHealth {
  if (!value || typeof value !== "object") return false;
  const health = value as PageHealth;
  return (
    [
      "ready",
      "loading",
      "empty",
      "unsupported",
      "unreadable",
      "degraded",
    ].includes(health.state) &&
    (health.warnPartial === undefined ||
      typeof health.warnPartial === "boolean") &&
    (health.issue === undefined ||
      ["page", "posts", "metrics", "dates"].includes(health.issue)) &&
    [health.sampledPosts, health.readableMetrics, health.readableDates].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    health.readableMetrics <= health.sampledPosts &&
    health.readableDates <= health.sampledPosts
  );
}
