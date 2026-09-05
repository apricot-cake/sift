import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

const localDeploy = process.env.SIFT_BUILD_KIND === "local";
const buildId = localDeploy ? (process.env.SIFT_BUILD_ID ?? "") : "";

if (localDeploy && buildId === "") {
  throw new Error("ローカル配備ビルドには SIFT_BUILD_ID が必要です。");
}

export default defineConfig({
  // @wxt-dev/i18n（WXT公式のi18nモジュール）。locales/<言語>.yml を読み、
  // ビルド時に _locales/<言語>/messages.json を生成する。型（#i18n の
  // GeneratedI18nStructure）は locales/<default_locale>.yml から作られる＝
  // manifest.default_locale の設定が要る（下の manifest 節）。
  modules: ["@wxt-dev/i18n/module", "@wxt-dev/module-react"],
  // ローカル配備は、2つの Chrome プロファイルが共有する場所へ直接書く。ストア
  // 提出物は誰も読み込まない別の場所で作り、ローカル専用機能を含まない。
  outDir: localDeploy
    ? resolve(import.meta.dirname, ".output")
    : resolve(import.meta.dirname, ".output", "store"),
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}",
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
  manifest: {
    // ローカル配備だけ固定の署名鍵を持たせ、拡張機能 id を
    // bohbpocokkfioejlabmeaimpkpmablkm に保つ。Chrome ウェブストアは新規アイテムの
    // manifest に key があるパッケージを受け付けないため、ストア提出物には含めない。
    ...(localDeploy
      ? {
          key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7HRMGxpsFxVmyHkVNzHAtaSVuu6vJVFCC0gSSYBT9t31XfT68U7NYyn15N3rLuvZRhRAXYBgZiouzH619jVc2lbHGRzRUPYjm8o0XW70TW6NB+g7P510902pHXw1TmcrN9wqFfFsFhV50DObPKfY+GYfgNzWo+A4raQ4+sCQaCv9TNR78CU2HAi81oGJthhxPYRfdZdqLiZ7FWSnz+Nv9Ie0Q0RAn6W21ekSRpN6wfJf4AjgBe5sj3zRRTGH6CcUSvfUehjKjSbsS5KX5OhL4KWsio4GYRmUZa3SJxWexZN3kLSo4ugA+0AaT0rFjLTZhxOl/ULBeMvBvnnZ+xEqyQIDAQAB",
        }
      : {}),
    // ブラウザがここに自分のロケールを持たないとき、どのメッセージファイルへ
    // 落ちるか。`en`。@wxt-dev/i18n が locales/en.yml から生成する。
    default_locale: "en",
    // 説明文と違ってリテラルのまま＝名前はどの言語でも "Sift" で、
    // __MSG_extensionName__ はそう言うために間接の層を1つ増やすだけ。
    name: "Sift",
    description: "__MSG_extensionDescription__",
    permissions: [
      "storage",
      ...(localDeploy ? (["nativeMessaging"] as const) : []),
    ],
    action: {
      default_title: "Sift",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __SIFT_LOCAL_DEPLOY__: JSON.stringify(localDeploy),
      __SIFT_BUILD_ID__: JSON.stringify(buildId),
    },
  }),
});
