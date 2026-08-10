import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { localizeDocument } from "../../utils/i18n.ts";

// このページで動いているものは全部が拡張機能自身のものなので、何も除かない。
// 購読は popup と同じだけ生きる。
startUncaughtReporting({
  target: window,
  source: "popup",
  filterToOwnCode: false,
});

// モジュールの最上位に置かず関数で包んであるのは、見つからなかったマークアップの
// 要素があったときに、途中で例外を投げるのではなく早く返せるように。要素そのものは
// 実行時に必ずある（index.html がどれも宣言している）ので、この早期の return が
// 実際に走ることはない。
function main(): void {
  // 何かを見せる前に。index.html はメッセージが入る場所に英語の文を持っていて、
  // そこへ読み手自身の言語を入れるのがこれ。
  localizeDocument(document);
  document.documentElement.lang = browser.i18n.getUILanguage();

  const maybeOpenOptions = document.querySelector<HTMLButtonElement>(
    '[data-role="open-options"]',
  );
  if (!maybeOpenOptions) {
    return;
  }

  maybeOpenOptions.addEventListener("click", () => {
    // ページが開けば Chrome が自分で popup を閉じる。そのページがタブなのか
    // 埋め込みの枠なのかを決めるのは options_ui で、
    // entrypoints/options/index.html はタブを求めている。
    void browser.runtime.openOptionsPage();
  });
}

main();
