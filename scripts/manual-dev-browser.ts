import { loadDevCandidate } from "./dev-browser-candidate.ts";
import { launchDevBrowser } from "./managed-dev-browser.ts";

// 候補の読み込みと Chrome の保持には pipe を使い、TCP ポートは開かない。
const context = await launchDevBrowser(false);
try {
  const browser = context.browser();
  if (!browser) throw new Error("手動確認用 Chrome を取得できません。");
  const disconnected = new Promise<void>((resolve) =>
    browser.once("disconnected", () => resolve()),
  );
  await loadDevCandidate(browser);
  if (!browser.isConnected())
    throw new Error("手動確認用 Chrome が終了しました。");
  process.send?.("ready");
  await disconnected;
} finally {
  await context.close();
}
