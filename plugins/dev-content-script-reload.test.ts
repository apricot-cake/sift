import { describe, expect, it, vi } from "vitest";
import type { ReloadContentScriptPayload, WxtDevServer } from "wxt";
import { requireExplicitContentScriptReload } from "./dev-content-script-reload";

const payload = {
  contentScript: {
    js: ["content-scripts/content.js"],
    matches: ["https://example.com/*"],
  },
} as ReloadContentScriptPayload;

function createServer() {
  const listeners = new Map<string, () => void>();
  const reloadContentScript = vi.fn();
  const server = {
    reloadContentScript,
    ws: {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
    },
  } as unknown as WxtDevServer;

  return { listeners, reloadContentScript, server };
}

describe("requireExplicitContentScriptReload", () => {
  it("編集中の自動反映では対象タブを再読み込みしない", () => {
    const { reloadContentScript, server } = createServer();
    requireExplicitContentScriptReload(server);

    server.reloadContentScript(payload);

    expect(reloadContentScript).not.toHaveBeenCalled();
  });

  it("開発版の接続時だけ最新の content script を反映する", () => {
    vi.useFakeTimers();
    const { listeners, reloadContentScript, server } = createServer();
    requireExplicitContentScriptReload(server);

    listeners.get("wxt:background-initialized")?.();
    server.reloadContentScript(payload);
    vi.runAllTimers();
    server.reloadContentScript(payload);

    expect(reloadContentScript).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
