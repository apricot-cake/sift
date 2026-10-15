import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseNetworkReportArgs,
  summarizeNetwork,
  writeNetworkReport,
} from "./network-report.ts";

const base = {
  runId: "run:1",
  requestId: "a",
  event: "request",
  site: "x",
  resourceType: "fetch",
  caseId: "x-profile",
  phase: "media-on",
  host: "x.com",
  endpoint: "graphql/UserTweets",
  pagination: "initial",
  disposition: "continued",
};
const lines = (...events: object[]) =>
  events.map((e) => JSON.stringify(e)).join("\n");
describe("通信分類の集計", () => {
  it.each(["bluesky", "youtube", "niconico"] as const)(
    "%s の要求と応答を他サイト・別runから分離する",
    (site) => {
      const request = { ...base, site, requestId: site };
      const summary = summarizeNetwork(
        lines(
          base,
          request,
          { ...request, event: "response", status: 200 },
          { ...request, requestId: "other", runId: "other" },
        ),
        "run:1",
        site,
      );
      expect(summary.totals).toMatchObject({ requests: 1, responses: 1 });
      expect(summary.matchingEvents).toBe(2);
    },
  );
  it("CLI の既存指定を維持し、サイト指定と誤指定を処理する", () => {
    expect(parseNetworkReportArgs([])).toEqual({ runId: undefined, site: "x" });
    expect(parseNetworkReportArgs(["run:1"])).toEqual({
      runId: "run:1",
      site: "x",
    });
    expect(parseNetworkReportArgs(["--site", "youtube", "run:1"])).toEqual({
      runId: "run:1",
      site: "youtube",
    });
    expect(() => parseNetworkReportArgs(["--site", "other"])).toThrow("--site");
    expect(() => parseNetworkReportArgs(["a", "b"])).toThrow("一つだけ");
  });
  it("応答順・重複イベントに関わらず requestId ごとに一度だけ数える", () => {
    const response = {
      ...base,
      event: "response",
      status: 200,
      fromCache: true,
      fromServiceWorker: true,
    };
    const summary = summarizeNetwork(
      lines(response, base, response, base),
      "run:1",
    );
    expect(summary.totals).toMatchObject({
      requests: 1,
      continued: 1,
      responses: 1,
      fromCache: 1,
      fromServiceWorker: 1,
      statuses: { "200": 1 },
    });
    expect(summary.phases[0]?.label).toBe("x-profile/media-on");
  });
  it("同じ操作名の別要求は合算し、送信前停止と応答欠落を分ける", () => {
    const summary = summarizeNetwork(
      lines(
        base,
        {
          ...base,
          requestId: "b",
          disposition: "aborted",
          pagination: "continuation",
        },
        { ...base, requestId: "b", event: "requestfailed" },
        {
          ...base,
          requestId: "c",
          event: "response",
          status: 429,
          pagination: "unknown",
        },
      ),
      "run:1",
    );
    expect(summary.totals).toMatchObject({
      requests: 3,
      continued: 1,
      aborted: 1,
      dispositionUnknown: 1,
      failed: 1,
      responses: 1,
      responseMissing: 2,
      pagination: { initial: 1, continuation: 1, unknown: 1 },
      statuses: { "429": 1 },
    });
    expect(summary.endpoints).toHaveLength(1);
  });
  it("別run・別サイト・文書通信を除外し、余分な機密フィールドを保存しない", () => {
    const summary = summarizeNetwork(
      lines(
        { ...base, url: "secret", body: "secret" },
        { ...base, requestId: "b", runId: "other" },
        { ...base, requestId: "c", site: "bluesky" },
        { ...base, requestId: "d", resourceType: "document" },
      ),
      "run:1",
    );
    expect(summary.totals.requests).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("secret");
  });
  it("破損した行と矛盾する送信記録を成功扱いしない", () => {
    expect(() => summarizeNetwork("broken", "run:1")).toThrow("1 行目");
    expect(() =>
      summarizeNetwork(
        lines(base, { ...base, disposition: "aborted" }),
        "run:1",
      ),
    ).toThrow("矛盾");
  });
  it("省略時のrunIdを使い、安全なファイル名で出力する", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "sift-network-report-"),
    );
    try {
      fs.writeFileSync(
        path.join(directory, "live-load.json"),
        JSON.stringify({ runId: "run:1" }),
      );
      fs.writeFileSync(
        path.join(directory, "live-load.network.jsonl"),
        lines(base, { ...base, requestId: "b", site: "youtube" }),
      );
      const result = writeNetworkReport(undefined, directory);
      expect(path.basename(result.output)).toBe("network-summary-run_1.json");
      expect(
        JSON.parse(fs.readFileSync(result.output, "utf8")).totals.requests,
      ).toBe(1);
      const youtube = writeNetworkReport(undefined, directory, "youtube");
      expect(path.basename(youtube.output)).toBe(
        "network-summary-run_1-youtube.json",
      );
      expect(JSON.parse(fs.readFileSync(youtube.output, "utf8")).scope).toBe(
        "YouTube fetch/XHR",
      );
      expect(fs.existsSync(result.output)).toBe(true);
      expect(() => writeNetworkReport("missing", directory)).toThrow(
        "記録がありません",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
