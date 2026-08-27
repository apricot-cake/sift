import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { requireExplicitContentScriptReload } from "./plugins/dev-content-script-reload.ts";
import { devErrorLog } from "./plugins/dev-error-log.ts";
import { DEV_SERVER_HOST, DEV_SERVER_PORT } from "./utils/dev-server.ts";

// 開発ビルドの置き場所。作業ツリーの外にあり、どのツリーでも同じ場所なのは
// 意図的＝開発専用の Chrome プロファイルは展開済みの置き場を一度だけ読み込む
// ので、作業が別の worktree へ移るたびにそれを指し直すのは、誰も覚えていない
// クリックになる。
//
// SIFT_DEV_OUTPUT を設定するのは `npm run dev` だけ＝素の `wxt` はこれを未設定の
// まま、リリースと同じく .output へ書く。それが、誰のプロファイルも読み込んで
// いないビルドにとって正しい答え。
const developmentOutput =
  process.env.SIFT_DEV_OUTPUT ||
  resolve(homedir(), ".sift-dev", "chrome-mv3-dev");

// 上の置き場に今ビルドが入っているかどうか。開発時の worker が自分を起動し直す
// 前にこれを訊く＝サーバーの起動はその置き場を消して書き直すし、空になった所へ
// 展開済み拡張機能を読み込み直すのは再試行にならない。Chrome は拡張機能を降ろし、
// manifest が無いというダイアログを出す（2026-08-02 に確認・#31）。両方の条件に
// 意味がある＝フックは「このサーバーの一生の中でビルドが終わった」ことを言い、
// ファイルの検査は「それがまだディスクにある」ことを言う。
let developmentBuildWritten = false;
const developmentBuildIsReady = () =>
  developmentBuildWritten &&
  existsSync(resolve(developmentOutput, "manifest.json"));

export default defineConfig({
  // @wxt-dev/i18n（WXT公式のi18nモジュール）。locales/<言語>.yml を読み、
  // ビルド時に _locales/<言語>/messages.json を生成する。型（#i18n の
  // GeneratedI18nStructure）は locales/<default_locale>.yml から作られる＝
  // manifest.default_locale の設定が要る（下の manifest 節）。
  modules: ["@wxt-dev/i18n/module", "@wxt-dev/module-react"],
  // 決して取り違えてはならない2つの出力先。
  //   開発     → 上の固定の経路。読むのは開発用プロファイルだけ
  //   リリース → .output/<ブラウザ>-mv3-release。scripts/deploy-extension.ts が
  //              これを .output/chrome-mv3 へ引き上げる＝日常の Chrome が読み
  //              込んでいる置き場。だから `wxt build` は日常の置き場へ書けない。
  //              そこへ入れるのは引き上げられたビルドだけ。
  //
  // 開発かビルドかではなく環境変数で分けているのは、この設定がそのどちらとも
  // 決まる前に読まれるから。設定するのは `npm run dev` で、`wxt build` はしない。
  outDir: process.env.SIFT_DEV_OUTPUT
    ? dirname(developmentOutput)
    : resolve(import.meta.dirname, ".output"),
  outDirTemplate: process.env.SIFT_DEV_OUTPUT
    ? basename(developmentOutput)
    : "{{browser}}-mv{{manifestVersion}}-release{{modeSuffix}}",
  // WXT にブラウザを起動させてはならない。理由は独立に2つある。
  //   - 自動化の仕組みを通して開いたものは自動化フラグの指紋を持ち、X はそれを
  //     ボットと読んでサインインを拒む。開発用プロファイルは X にサインイン済み
  //     で、それを失うことはこのプロファイルの存在理由を失うこと。
  //   - `--load-extension` は Chrome 137 以降が無視する（Chrome 151 で確認）ので、
  //     任せて起動しても拡張機能は読み込まれない。
  // 拡張機能は専用のプロファイルへ、手で一度だけ読み込む。起動役を止めておくと、
  // WXT 0.21.2 以降は任意の peer 依存になった `web-ext` も一度も入らない。
  webExt: {
    disabled: true,
  },
  dev: {
    server: {
      // 正本は utils/dev-server.ts＝開発時の worker は、エラーのバッファも
      // 生存確認もこの同じ住所へ送る。
      //
      // ホストを固定する理由はポートと同じ。WXT の既定は `localhost` で、ここ
      // ではそれが ::1 に解決されてそこにしか束縛されず、worker が 127.0.0.1 へ
      // 送ったものは拒まれ、拡張機能が出した診断は全部が黙って失われた（#31）。
      // 住所を名指しすることで、HMR ソケット・CSP・ホスト権限・worker の取得が
      // 1つのホストで一致する。
      //
      // `origin` は WXT では別の設定項目で、自分では localhost を既定にする＝
      // `host` だけを設定すると、サーバーが束縛する先は動くのに拡張機能が呼ぶ
      // 先は動かない。それは同じ食い違いの繰り返し。
      host: DEV_SERVER_HOST,
      origin: DEV_SERVER_HOST,
      port: DEV_SERVER_PORT,
      // これが無いと、51732 が塞がっているとき WXT は黙って次の空きポートを
      // 取る。拡張機能は交渉し直せない1つの住所に対してビルドされているので、
      // 別のポートのサーバーは誰も話しかけないサーバーになる＝それは拡張機能が
      // 壊れているのと見分けの付かない失敗。起動を拒むことが、2つ目の開発
      // サーバーが自分は2つ目だと知る手段。
      strictPort: true,
    },
  },
  manifest: {
    // 固定の署名鍵＝したがって固定の拡張機能 id
    // （bohbpocokkfioejlabmeaimpkpmablkm）。これが無いと id は置き場の経路から
    // 導かれるので、日常のビルドを別の置き場へ移すと黙って新しい拡張機能が
    // できる＝そして新しい browser.storage.sync も一緒に。開発とリリースで同じ
    // 値にしてある＝両者は別々の Chrome プロファイルにいるので、同じ id が自分
    // 自身とぶつかることはない。
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7HRMGxpsFxVmyHkVNzHAtaSVuu6vJVFCC0gSSYBT9t31XfT68U7NYyn15N3rLuvZRhRAXYBgZiouzH619jVc2lbHGRzRUPYjm8o0XW70TW6NB+g7P510902pHXw1TmcrN9wqFfFsFhV50DObPKfY+GYfgNzWo+A4raQ4+sCQaCv9TNR78CU2HAi81oGJthhxPYRfdZdqLiZ7FWSnz+Nv9Ie0Q0RAn6W21ekSRpN6wfJf4AjgBe5sj3zRRTGH6CcUSvfUehjKjSbsS5KX5OhL4KWsio4GYRmUZa3SJxWexZN3kLSo4ugA+0AaT0rFjLTZhxOl/ULBeMvBvnnZ+xEqyQIDAQAB",
    // ブラウザがここに自分のロケールを持たないとき、どのメッセージファイルへ
    // 落ちるか。`en`。@wxt-dev/i18n が locales/en.yml から生成する。
    default_locale: "en",
    // 説明文と違ってリテラルのまま＝名前はどの言語でも "Sift" で、
    // __MSG_extensionName__ はそう言うために間接の層を1つ増やすだけ。
    name: "Sift",
    description: "__MSG_extensionDescription__",
    // サイドパネルは現在のタブのホストごとに設定を切り替える。この権限が無いと
    // URL が伏せられ、対応する
    // タイムラインでも操作不能と表示される。常時のサイト権限にはしない。
    permissions: ["activeTab", "storage"],
    action: {
      default_title: "Sift",
    },
  },
  hooks: {
    "server:created": (_wxt, server) => {
      requireExplicitContentScriptReload(server);
    },
    // 開発サーバーが書くビルドのたびに発火する。最初の1回も含む。
    "build:done": () => {
      developmentBuildWritten = true;
    },
  },
  vite: (env) => ({
    // 開発時の worker がエラーのバッファを送る先のエンドポイントに答える。
    // このプラグインが当たるのは `serve` だけなので、リリースビルドは一度も
    // これを持たない。
    plugins: [tailwindcss(), devErrorLog({ isBuilt: developmentBuildIsReady })],
    define: {
      // このバンドルがどちらのビルドであるか。command で分けているのは意図的で、
      // `import.meta.env.DEV` は NODE_ENV に従うため、テストの実行環境から
      // ビルドしたリリースが、自分は開発ビルドだと思ったまま出来上がる。
      __SIFT_DEV__: JSON.stringify(env.command === "serve"),
    },
  }),
});
