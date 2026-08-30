import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WXT 自身の Vitest プラグイン。テストがビルドと同じプロジェクトを見るように
  // しているのがこれ＝wxt.config.ts を読むので、Vite の設定も別名も、ここで
  // 抱える2つ目の組ではなく拡張機能自身のものになる。
  plugins: [WxtVitest()],
  test: {
    // どのアダプターもページに対して走らせるセレクタの集まりなので、ページは
    // 本物でなければならない。`querySelector`・`closest`・`firstElementChild`・
    // 属性の照合が、ブラウザでの意味どおりになるのは happy-dom のおかげ＝手書きの
    // 代役はテストが答えろと言ったとおりに答えるだけで、それはテストのテスト。
    environment: "happy-dom",
    // WXT の偽ブラウザが実装しないまま置いている browser.i18n.getMessage を、
    // public/_locales/en から埋める。文字を見せる画面はどれもこれを通るので、
    // これが無いと全部が例外になる。
    setupFiles: ["./test/i18n.ts"],
  },
});
