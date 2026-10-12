import { homedir } from "node:os";
import path from "node:path";
import { type Browser, launch } from "puppeteer-core";
import { findChromePath } from "./chrome-path.ts";
import { secureDevBrowserProfile } from "./dev-browser-profile.ts";

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
/** 接続を起動元の匿名 pipe に限定し、既存 Chrome には接続しない。 */
export async function launchDevBrowser(headless: boolean): Promise<Browser> {
  const profile = devBrowserProfile();
  secureDevBrowserProfile(profile);
  return await launch({
    executablePath: process.env.SIFT_CHROME || findChromePath(),
    userDataDir: profile,
    headless,
    pipe: true,
    enableExtensions: true,
    defaultViewport: null,
    protocolTimeout: 30000,
    ignoreDefaultArgs: [
      // SDK の環境変数からも Chrome の sandbox を無効にさせない。
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--password-store=basic",
      "--use-mock-keychain",
      "--hide-scrollbars",
    ],
    args: [
      ...devBrowserArgs(profile).filter(
        (arg) => !arg.startsWith("--user-data-dir="),
      ),
      ...(headless ? ["--window-size=1280,720"] : []),
    ],
  }).catch((cause) => {
    throw new Error(
      "開発用 Chrome を起動できません。手動確認用の Chrome が開いていれば閉じてから再実行してください。",
      { cause },
    );
  });
}
/** 各コマンドが所有する Chrome は、正常終了・失敗のどちらでも終了する。 */
export async function withDevBrowser<T>(
  run: (browser: Browser) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const browser = await launchDevBrowser(true);
  const abort = () => void browser.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    return await run(browser);
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
}
