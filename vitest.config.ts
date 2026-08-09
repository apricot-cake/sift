import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WXT 自身の Vitest プラグイン。テストがビルドと同じプロジェクトを見るように
  // しているのがこれ＝wxt.config.ts を読むので、Vite の設定も別名も、ビルド時の
  // 定数（`__SIFT_DEV__`）も、ここで抱える2つ目の組ではなく拡張機能自身のものに
  // なる。
  plugins: [WxtVitest()],
  define: {
    // wxt.config.ts はこれを Vite の command で分けるが、テストの実行は、あちらが
    // 知っている2つの command のどちらでもない＝だから定数が欠け、content script
    // はそこへ届いた時点で例外になる。テストにはリリースビルドの答えを渡す＝
    // 開発時だけの半分が話しかける相手のサーバーを、どのテストも立てないから。
    __SIFT_DEV__: "false",
  },
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
