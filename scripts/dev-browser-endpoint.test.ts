// @vitest-environment node
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";

describe("専用プロファイルのCDP接続先", () => {
  let profile: string;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    profile = fs.mkdtempSync(path.join(tmpdir(), "sift-endpoint-"));
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(profile, { recursive: true, force: true });
  });

  function record(contents: string) {
    fs.writeFileSync(path.join(profile, "DevToolsActivePort"), contents);
  }

  test("未起動なら固定ポートへ接続しない", async () => {
    expect(await readDevBrowserEndpoint(profile)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("固定ポートを指定したときは接続先を直接確認する", async () => {
    const endpoint = {
      url: "http://127.0.0.1:9224",
      webSocketDebuggerUrl: "ws://127.0.0.1:9224/devtools/browser/sift-browser",
    };
    fetchMock.mockResolvedValue(Response.json(endpoint));

    expect(await readDevBrowserEndpoint(profile, 9224)).toEqual(endpoint);
    expect(fetchMock).toHaveBeenCalledWith(
      `${endpoint.url}/json/version`,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  test("Chromeが選んだポートを別の呼び出しでも再利用する", async () => {
    record("49152\r\n/devtools/browser/sift-browser\r\n");
    const endpoint = {
      url: "http://127.0.0.1:49152",
      webSocketDebuggerUrl:
        "ws://127.0.0.1:49152/devtools/browser/sift-browser",
    };
    fetchMock.mockImplementation(async () => Response.json(endpoint));
    expect(await readDevBrowserEndpoint(profile)).toEqual(endpoint);
    expect(await readDevBrowserEndpoint(profile)).toEqual(endpoint);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${endpoint.url}/json/version`,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  test("古いポートが別アプリに再利用されていても採用しない", async () => {
    record("9222\n/devtools/browser/old-sift");
    fetchMock.mockResolvedValue(
      Response.json({
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/other-app",
      }),
    );
    expect(await readDevBrowserEndpoint(profile)).toBeNull();
  });

  test.each([
    "",
    "0\n/devtools/browser/id",
    "65536\n/devtools/browser/id",
    "9222garbage\n/devtools/browser/id",
    "9222",
    "9222\nhttps://example.com/",
  ])("不完全な記録では接続しない: %s", async (contents) => {
    record(contents);
    expect(await readDevBrowserEndpoint(profile)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("終了済みブラウザは再利用しない", async () => {
    record("49152\n/devtools/browser/stopped");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await readDevBrowserEndpoint(profile)).toBeNull();
  });
});
