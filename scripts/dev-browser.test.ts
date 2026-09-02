import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { CdpPipeClient } from "./dev-browser.ts";

const source = fs.readFileSync(
  path.join(import.meta.dirname, "dev-browser.ts"),
  "utf8",
);

describe("開発用Chromeプロファイル", () => {
  test("日常用プロファイルと同じproductionビルドを読む", () => {
    expect(source).toContain('path.join(ROOT, ".output", "chrome-mv3")');
    expect(source).toContain('"Extensions.loadUnpacked"');
    expect(source).toContain('"Extensions.getExtensions"');
  });

  test("背面でも描画とタイマーを維持する", () => {
    expect(source).toContain("--disable-backgrounding-occluded-windows");
    expect(source).toContain("--disable-background-timer-throttling");
    expect(source).toContain("--disable-renderer-backgrounding");
  });

  test("固定ポートを公開せず親プロセス限定のパイプを使う", () => {
    expect(source).toContain('"--remote-debugging-pipe"');
    expect(source).toContain(
      'stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"]',
    );
    expect(source).not.toContain("--remote-debugging-port");
    expect(source).not.toContain("--remote-debugging-address");
    expect(source).not.toContain("SIFT_DEV_CDP_PORT");
    expect(source).not.toContain("new WebSocket");
    expect(source).not.toContain("fetch(");
  });

  test("Chromeを閉じるまで親プロセスがパイプを維持する", () => {
    expect(source).toContain("await waitForChromeExit(child)");
    expect(source).not.toContain("child.unref()");
    expect(source).not.toContain("detached: true");
  });
});

describe("CDPパイプ", () => {
  test("NULL区切りの要求と応答を扱う", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new CdpPipeClient(input, output);
    const request = new Promise<Record<string, unknown>>((resolve) => {
      input.once("data", (chunk) => {
        resolve(
          JSON.parse(Buffer.from(chunk).subarray(0, -1).toString("utf8")),
        );
      });
    });

    const result = client.call<{ product: string }>("Browser.getVersion");
    const sent = await request;
    expect(sent).toMatchObject({
      id: 1,
      method: "Browser.getVersion",
      params: {},
    });
    output.write(
      `${JSON.stringify({ id: 1, result: { product: "Chrome" } })}\0`,
    );
    await expect(result).resolves.toEqual({ product: "Chrome" });
    client.dispose();
  });

  test("分割された応答とCDPエラーを扱う", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new CdpPipeClient(input, output);
    const result = client.call("Page.reload");
    output.write('{"id":1,"error":');
    output.write('{"message":"失敗"}}\0');
    await expect(result).rejects.toThrow("失敗");
    client.dispose();
  });
});
