import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "puppeteer-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIVE_LOAD_LIMITS,
  LiveLoadBudget,
  LiveLoadGuard,
  liveSite,
  networkEndpoint,
  networkPagination,
} from "./live-load.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function budget() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-load-"));
  dirs.push(dir);
  return new LiveLoadBudget(path.join(dir, "load.json"), "test-run");
}
describe("実機検証の通信予算", () => {
  it("API操作名を残し、queryId・自由入力パス・検索語を保存しない", () => {
    expect(
      networkEndpoint(
        "https://x.com/i/api/graphql/private-query-id/UserTweets?variables=secret",
      ),
    ).toBe("graphql/UserTweets");
    expect(
      networkEndpoint(
        "https://x.com/i/api/1.1/users/show/123.json?screen_name=private",
      ),
    ).toBe("i/api/1.1/users/show/:id");
    expect(
      networkEndpoint("https://x.com/private-user/status/123?secret=yes"),
    ).toBe(":segment/status/:id");
    expect(
      networkEndpoint(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=secret",
      ),
    ).toBe("xrpc/app.bsky.feed.getFeed");
    expect(
      networkEndpoint("https://www.youtube.com/youtubei/v1/browse?key=secret"),
    ).toBe("youtubei/v1/browse");
  });
  it("GraphQL変数からはページ追加の有無だけ分類する", () => {
    const prefix = "https://x.com/i/api/graphql/id/UserTweets?variables=";
    expect(
      networkPagination(
        prefix + encodeURIComponent(JSON.stringify({ userId: "secret" })),
      ),
    ).toBe("initial");
    expect(
      networkPagination(
        prefix +
          encodeURIComponent(JSON.stringify({ cursor: "secret-cursor" })),
      ),
    ).toBe("continuation");
    expect(networkPagination(`${prefix}invalid`)).toBe("unknown");
    expect(networkPagination("https://x.com/home")).toBe("unknown");
  });
  it("連続スラッシュ・旧GraphQL・別APIホストも同じ操作単位で分類する", () => {
    expect(
      networkEndpoint(
        "https://x.com//i//api/graphql/private-id/UserTweets?variables=secret",
      ),
    ).toBe("graphql/UserTweets");
    expect(
      networkEndpoint(
        "https://x.com/i/api/1.1/graphql/Viewer.json?variables=secret",
      ),
    ).toBe("graphql/Viewer");
    expect(
      networkEndpoint("https://api.x.com/1.1/jot/client_event.json?secret=yes"),
    ).toBe("i/api/1.1/jot/client_event");
    expect(
      networkEndpoint("https://x.com/i/api/1.1/jot/client_event.json"),
    ).toBe("i/api/1.1/jot/client_event");
    expect(networkEndpoint("https://api.x.com/1.1/users/123.json")).toBe(
      "i/api/1.1/users/:id",
    );
    const variables = encodeURIComponent(
      JSON.stringify({ cursor: "secret-cursor", userId: "secret-user" }),
    );
    expect(
      networkPagination(
        `https://x.com//i/api/graphql/id/UserTweets?variables=${variables}`,
      ),
    ).toBe("continuation");
    expect(
      networkPagination(
        `https://x.com/i/api/1.1/graphql/Viewer.json?variables=${variables}`,
      ),
    ).toBe("continuation");
  });
  it("通信と応答を同じIDと開始時のケースに結び、機密値を出力しない", async () => {
    const guard = new LiveLoadGuard(budget());
    const frame = {};
    const page = Object.assign(new EventEmitter(), {
      setRequestInterception: async () => {},
      mainFrame: () => frame,
      url: () => "https://x.com/home",
    });
    await guard.watch(page as unknown as Page);
    guard.setContext("case-a", "filter");
    const request = {
      isInterceptResolutionHandled: () => false,
      url: () =>
        "https://x.com/i/api/graphql/secret-query-id/UserTweets?variables=" +
        encodeURIComponent(
          JSON.stringify({ userId: "secret-user", cursor: "secret-cursor" }),
        ),
      isNavigationRequest: () => false,
      resourceType: () => "fetch",
      method: () => "GET",
      continue: async () => {},
      abort: async () => {},
      postData: () => {
        throw new Error("本文を読んではいけない");
      },
      headers: () => {
        throw new Error("ヘッダーを読んではいけない");
      },
    };
    page.emit("request", request);
    await Promise.resolve();
    await Promise.resolve();
    guard.setContext("case-b", "navigate");
    page.emit("response", {
      url: request.url,
      request: () => request,
      status: () => 200,
      fromCache: () => true,
      fromServiceWorker: () => false,
    });
    const raw = fs.readFileSync(guard.networkFile, "utf8");
    const [sent, received] = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(sent.disposition).toBe("continued");
    expect(sent.endpoint).toBe("graphql/UserTweets");
    expect(sent.pagination).toBe("continuation");
    expect(received.requestId).toBe(sent.requestId);
    expect(received.caseId).toBe("case-a");
    expect(received.fromCache).toBe(true);
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("variables");
  });
  it("別ブラウザにも制限状態を引き継ぎ、他サイトを巻き込まない", () => {
    const first = budget();
    first.stop("x", "HTTP 429", "60");
    const next = new LiveLoadBudget(first.file, first.runId);
    expect(() => next.assert("x")).toThrow("429");
    expect(() => next.assert("bluesky")).not.toThrow();
    expect(next.read().sites.x?.retryAfter).toBe("60");
  });
  it("新しい検証実行では前回の結果を混ぜない", () => {
    const first = budget();
    first.stop("x", "通信予算の上限");
    const next = new LiveLoadBudget(first.file, "next-run");
    expect(() => next.assert("x")).not.toThrow();
  });
  it("Retry-Afterの期限は実行をやり直しても維持する", () => {
    const first = budget();
    first.stop("x", "HTTP 429", "60");
    const next = new LiveLoadBudget(first.file, "next-run");
    expect(() => next.assert("x")).toThrow("429");
    expect(next.read().sites.x?.navigations).toBe(0);
  });
  it("読み込み回数が予算を超えたら未完了として止める", () => {
    const b = budget();
    for (let i = 0; i < LIVE_LOAD_LIMITS.navigations; i++)
      b.request("x", true, false, i * 3000);
    expect(() => b.request("x", true, false, 999999)).toThrow("未完了");
  });
  it("DOM観測とは分けて追加通信と読み込み間隔を管理する", () => {
    const b = budget();
    expect(b.request("bluesky", true, false, 10000)).toBe(0);
    expect(b.request("bluesky", true, false, 10500)).toBe(1500);
    b.request("bluesky", false, true, 10600);
    expect(b.read().sites.bluesky?.dataRequests).toBe(1);
  });
  it("外部サイトと拡張機能を区別する", () => {
    expect(liveSite("https://public.api.bsky.app/xrpc/test")).toBe("bluesky");
    expect(liveSite("chrome-extension://test/sidepanel.html")).toBeUndefined();
    expect(liveSite("https://example.com/?x=x.com")).toBeUndefined();
  });
  it("429を観測したら、後続リクエストを送らず止める", async () => {
    const b = budget();
    const guard = new LiveLoadGuard(b);
    const frame = {};
    const page = Object.assign(new EventEmitter(), {
      setRequestInterception: async () => {},
      mainFrame: () => frame,
      url: () => "https://x.com/home",
    });
    await guard.watch(page as unknown as Page);
    page.emit("response", {
      url: () => "https://x.com/i/api/graphql/test",
      status: () => 429,
      headers: () => ({ "retry-after": "60" }),
      request: () => ({ isNavigationRequest: () => false }),
    });
    const actions: string[] = [];
    page.emit("request", {
      isInterceptResolutionHandled: () => false,
      url: () => "https://x.com/i/api/graphql/test",
      isNavigationRequest: () => false,
      resourceType: () => "fetch",
      continue: async () => {
        actions.push("continue");
      },
      abort: async () => {
        actions.push("abort");
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(actions).toEqual(["abort"]);
    expect(b.read().sites.x?.retryAfter).toBe("60");
    const events = fs
      .readFileSync(guard.networkFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0].disposition).toBe("aborted");
    expect(events[0].method).toBe("unknown");
  });
});
