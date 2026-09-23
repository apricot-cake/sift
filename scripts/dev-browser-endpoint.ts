import fs from "node:fs";
import path from "node:path";

export interface DevBrowserEndpoint {
  url: string;
  webSocketDebuggerUrl: string;
}

// Chrome が専用プロファイルに書いた接続先だけを使う。ポートが再利用されても、
// ブラウザごとに変わる WebSocket のパスが一致しなければ接続先として採用しない。
export async function readDevBrowserEndpoint(
  profile: string,
  fixedPort?: number,
): Promise<DevBrowserEndpoint | null> {
  if (fixedPort !== undefined) {
    if (!Number.isInteger(fixedPort) || fixedPort < 1 || fixedPort > 65535) {
      return null;
    }
    return await readEndpoint(`http://127.0.0.1:${fixedPort}`);
  }

  let contents: string;
  try {
    contents = fs.readFileSync(
      path.join(profile, "DevToolsActivePort"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const [portText, browserPath] = contents.trim().split(/\r?\n/);
  if (
    !portText ||
    !/^\d+$/.test(portText) ||
    Number(portText) < 1 ||
    Number(portText) > 65535 ||
    !browserPath ||
    !/^\/devtools\/browser\/[\w-]+$/.test(browserPath)
  ) {
    return null;
  }
  const url = `http://127.0.0.1:${Number(portText)}`;
  const webSocketDebuggerUrl = `ws://127.0.0.1:${Number(portText)}${browserPath}`;
  const endpoint = await readEndpoint(url);
  return endpoint?.webSocketDebuggerUrl === webSocketDebuggerUrl
    ? endpoint
    : null;
}

async function readEndpoint(url: string): Promise<DevBrowserEndpoint | null> {
  try {
    const response = await fetch(`${url}/json/version`, {
      signal: AbortSignal.timeout(500),
      redirect: "error",
    });
    if (!response.ok) return null;
    const version: unknown = await response.json();
    return typeof version === "object" &&
      version !== null &&
      "webSocketDebuggerUrl" in version &&
      typeof version.webSocketDebuggerUrl === "string" &&
      version.webSocketDebuggerUrl.startsWith(
        `${url.replace("http://", "ws://")}/devtools/browser/`,
      )
      ? { url, webSocketDebuggerUrl: version.webSocketDebuggerUrl }
      : null;
  } catch {
    return null;
  }
}
