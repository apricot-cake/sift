import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { findChromePath } from "./chrome-path.ts";
import {
  type DevBrowserEndpoint,
  readDevBrowserEndpoint,
} from "./dev-browser-endpoint.ts";

const sessionKey = "SIFT_DEV_BROWSER_SESSION";

export function devBrowserProfile(): string {
  return path.resolve(
    process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile"),
  );
}

export function devBrowserArgs(profile: string): string[] {
  return [
    `--user-data-dir=${profile}`,
    "--profile-directory=Default",
    "--restore-last-session",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ];
}

export async function launchDevBrowser(debug: boolean) {
  const profile = devBrowserProfile();
  return await chromium.launchPersistentContext(profile, {
    executablePath: process.env.SIFT_CHROME || findChromePath(),
    headless: false,
    viewport: null,
    chromiumSandbox: true,
    ignoreDefaultArgs: [
      "--disable-extensions",
      "--password-store=basic",
      "--use-mock-keychain",
    ],
    args: [
      ...devBrowserArgs(profile).filter(
        (arg) => !arg.startsWith("--user-data-dir="),
      ),
      ...(debug
        ? ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"]
        : []),
    ],
  });
}

/** セッションの記録は認証ではなく、所有ラッパーの取り違え防止に使う。 */
export async function readManagedDevBrowserEndpoint(): Promise<DevBrowserEndpoint> {
  const profile = devBrowserProfile();
  const session = process.env[sessionKey];
  const endpoint = await readDevBrowserEndpoint(profile);
  if (
    !session ||
    !endpoint ||
    session !==
      JSON.stringify({ profile, endpoint: endpoint.webSocketDebuggerUrl })
  )
    throw new Error(
      "管理中の開発用 Chrome がありません。npm の検証コマンドから実行してください。",
    );
  return endpoint;
}

/** 呼び出し中だけ CDP を有効にし、子コマンドでは同じ Chrome を共有する。 */
export async function withDevBrowser<T>(
  run: (owned: boolean) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (process.env[sessionKey]) {
    await readManagedDevBrowserEndpoint();
    return await run(false);
  }
  const profile = devBrowserProfile();
  if (await readDevBrowserEndpoint(profile))
    throw new Error("CDP が有効な開発用 Chrome を先に閉じてください。");
  const context = await launchDevBrowser(true).catch((cause) => {
    throw new Error(
      "検証用 Chrome を起動できません。手動確認用の開発用 Chrome が開いていれば閉じてから再実行してください。",
      { cause },
    );
  });
  try {
    const endpoint = await readDevBrowserEndpoint(profile);
    if (!endpoint)
      throw new Error("検証用 Chrome の CDP 接続先を確認できません。");
    process.env[sessionKey] = JSON.stringify({
      profile,
      endpoint: endpoint.webSocketDebuggerUrl,
    });
    return await run(true);
  } finally {
    delete process.env[sessionKey];
    await context.close();
  }
}
