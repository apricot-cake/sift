import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { LiveSite } from "./live-load.ts";

const siteNames: Record<LiveSite, string> = {
  x: "X",
  bluesky: "Bluesky",
  youtube: "YouTube",
  niconico: "ニコニコ動画",
};

export function parseNetworkReportArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: { site: { type: "string", default: "x" } },
    allowPositionals: true,
  });
  if (positionals.length > 1)
    throw new Error("runId は一つだけ指定してください");
  if (!Object.hasOwn(siteNames, values.site))
    throw new Error(
      "--site は x, bluesky, youtube, niconico から指定してください",
    );
  return { runId: positionals[0], site: values.site as LiveSite };
}

interface TraceEvent {
  runId: string;
  requestId: string;
  event: string;
  site?: string;
  resourceType: string;
  caseId: string;
  phase: string;
  host: string;
  endpoint: string;
  pagination?: string;
  disposition?: string;
  status?: number;
  fromCache?: boolean;
  fromServiceWorker?: boolean;
}
interface Request {
  event: TraceEvent;
  disposition?: string;
  response?: TraceEvent;
  failed: boolean;
}
function emptyCounts() {
  return {
    requests: 0,
    continued: 0,
    aborted: 0,
    dispositionUnknown: 0,
    responses: 0,
    responseMissing: 0,
    failed: 0,
    fromCache: 0,
    fromServiceWorker: 0,
    pagination: { initial: 0, continuation: 0, unknown: 0 },
    statuses: {} as Record<string, number>,
  };
}
type Counts = ReturnType<typeof emptyCounts>;
function add(counts: Counts, request: Request) {
  counts.requests++;
  if (request.disposition === "continued") counts.continued++;
  else if (request.disposition === "aborted") counts.aborted++;
  else counts.dispositionUnknown++;
  if (request.failed) counts.failed++;
  const pagination = request.event.pagination;
  if (pagination === "initial" || pagination === "continuation")
    counts.pagination[pagination]++;
  else counts.pagination.unknown++;
  if (request.response) {
    counts.responses++;
    if (request.response.fromCache) counts.fromCache++;
    if (request.response.fromServiceWorker) counts.fromServiceWorker++;
    const status = String(request.response.status ?? "unknown");
    counts.statuses[status] = (counts.statuses[status] ?? 0) + 1;
  } else counts.responseMissing++;
}
function group(requests: Request[], key: (request: Request) => string) {
  const groups = new Map<string, Counts>();
  for (const request of requests) {
    const label = key(request);
    const counts = groups.get(label) ?? emptyCounts();
    add(counts, request);
    groups.set(label, counts);
  }
  return [...groups.entries()]
    .map(([label, counts]) => ({ label, ...counts }))
    .sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label));
}

// URL・query・bodyは出力せず、既に匿名化した分類情報だけを集計する。
export function summarizeNetwork(
  jsonl: string,
  runId: string,
  site: LiveSite = "x",
) {
  const unique = new Map<string, Request>();
  let matchingEvents = 0;
  for (const [index, line] of jsonl.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event: TraceEvent;
    try {
      event = JSON.parse(line) as TraceEvent;
    } catch {
      throw new Error(`通信ログの ${index + 1} 行目が不正です`);
    }
    if (
      event.runId !== runId ||
      event.site !== site ||
      !["fetch", "xhr"].includes(event.resourceType) ||
      !["request", "response", "requestfailed"].includes(event.event)
    )
      continue;
    if (!event.requestId) throw new Error("通信ログに requestId がありません");
    matchingEvents++;
    const request = unique.get(event.requestId) ?? { event, failed: false };
    if (event.event === "request") {
      if (request.disposition && request.disposition !== event.disposition)
        throw new Error("同じ requestId の送信判定が矛盾しています");
      request.disposition = event.disposition;
      request.event = event;
    } else if (event.event === "response") request.response = event;
    else request.failed = true;
    unique.set(event.requestId, request);
  }
  const requests = [...unique.values()];
  const totals = emptyCounts();
  for (const request of requests) add(totals, request);
  return {
    schema: 1,
    runId,
    scope: `${siteNames[site]} fetch/XHR`,
    note: "操作名が同じ通信は分類件数です。同一要求の重複とは判定しません。cache と Service Worker は重なる場合があります。応答欠落は送信失敗を意味しません。",
    matchingEvents,
    totals,
    endpoints: group(
      requests,
      ({ event }) => `${event.host}/${event.endpoint}`,
    ),
    cases: group(requests, ({ event }) => event.caseId),
    phases: group(requests, ({ event }) => `${event.caseId}/${event.phase}`),
  };
}

export function writeNetworkReport(
  runId?: string,
  directory = "test-results",
  site: LiveSite = "x",
) {
  const selected =
    runId ??
    (
      JSON.parse(
        fs.readFileSync(path.join(directory, "live-load.json"), "utf8"),
      ) as { runId: string }
    ).runId;
  if (!selected) throw new Error("集計対象の runId がありません");
  const summary = summarizeNetwork(
    fs.readFileSync(path.join(directory, "live-load.network.jsonl"), "utf8"),
    selected,
    site,
  );
  if (!summary.matchingEvents)
    throw new Error(`対象 runId の ${siteNames[site]} 通信記録がありません`);
  const safeId = selected.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const suffix = site === "x" ? "" : `-${site}`;
  const output = path.join(
    directory,
    `network-summary-${safeId}${suffix}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
  return { output, runId: selected, ...summary.totals };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    const { runId, site } = parseNetworkReportArgs(process.argv.slice(2));
    console.log(
      JSON.stringify(writeNetworkReport(runId, "test-results", site)),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
