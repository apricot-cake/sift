import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

const buildKind = process.env.SIFT_BUILD_KIND;
const localDeploy = buildKind === "local";
const localBuild = localDeploy || buildKind === "candidate";
const signedBuild = localBuild;
const buildId = localBuild ? (process.env.SIFT_BUILD_ID ?? "") : "";

if (localBuild && buildId === "") {
  throw new Error("ローカルビルドには SIFT_BUILD_ID が必要です。");
}

// バンドルした依存のライセンス文を配布物に同梱する。Vite の build.license は
// ビルド1回分しか書かないが、WXT はエントリポイントのグループごとに Vite を
// 走らせるので、各回を JSON で出させて最後に1つの Markdown へまとめる。
const licensePartsDir = "licenses/.parts";
const licenseFile = "licenses/third-party.md";

type LicenseEntry = {
  name: string;
  version: string;
  identifier?: string;
  text?: string;
};

async function mergeLicenseParts(outDir: string): Promise<void> {
  const partsDir = join(outDir, licensePartsDir);
  const entries = new Map<string, LicenseEntry>();
  for (const part of await readdir(partsDir)) {
    const list: LicenseEntry[] = JSON.parse(
      await readFile(join(partsDir, part), "utf-8"),
    );
    for (const entry of list) {
      entries.set(`${entry.name}@${entry.version}`, entry);
    }
  }
  await rm(partsDir, { recursive: true });

  let markdown =
    "# Licenses\n\nsift bundles the following third-party packages.\n";
  for (const [, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const identifier = entry.identifier ? ` (${entry.identifier})` : "";
    markdown += `\n## ${entry.name} - ${entry.version}${identifier}\n`;
    if (entry.text) markdown += `\n${entry.text}\n`;
  }
  await mkdir(join(outDir, "licenses"), { recursive: true });
  await writeFile(join(outDir, licenseFile), markdown);
}

export default defineConfig({
  // @wxt-dev/i18n（WXT公式のi18nモジュール）。locales/<言語>.yml を読み、
  // ビルド時に _locales/<言語>/messages.json を生成する。型（#i18n の
  // GeneratedI18nStructure）は locales/<default_locale>.yml から作られる＝
  // manifest.default_locale の設定が要る（下の manifest 節）。
  modules: ["@wxt-dev/i18n/module", "@wxt-dev/module-react"],
  // 検証候補と日常版の中間成果物を分け、配備で検証候補を上書きしない。
  outDir:
    process.env.SIFT_OUTPUT_DIR ||
    resolve(import.meta.dirname, ".output", buildKind || "store"),
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
    // ローカル配備は固定の署名鍵を持たせ、拡張機能 id を
    // bohbpocokkfioejlabmeaimpkpmablkm に保つ。Chrome ウェブストアは新規アイテムの
    // manifest に key があるパッケージを受け付けないため、ストア提出物には含めない。
    ...(signedBuild
      ? {
          key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7HRMGxpsFxVmyHkVNzHAtaSVuu6vJVFCC0gSSYBT9t31XfT68U7NYyn15N3rLuvZRhRAXYBgZiouzH619jVc2lbHGRzRUPYjm8o0XW70TW6NB+g7P510902pHXw1TmcrN9wqFfFsFhV50DObPKfY+GYfgNzWo+A4raQ4+sCQaCv9TNR78CU2HAi81oGJthhxPYRfdZdqLiZ7FWSnz+Nv9Ie0Q0RAn6W21ekSRpN6wfJf4AjgBe5sj3zRRTGH6CcUSvfUehjKjSbsS5KX5OhL4KWsio4GYRmUZa3SJxWexZN3kLSo4ugA+0AaT0rFjLTZhxOl/ULBeMvBvnnZ+xEqyQIDAQAB",
        }
      : {}),
    // ブラウザがここに自分のロケールを持たないとき、どのメッセージファイルへ
    // 落ちるか。`en`。@wxt-dev/i18n が locales/en.yml から生成する。
    default_locale: "en",
    // 説明文と違ってリテラルのまま＝名前はどの言語でも "sift" で、
    // __MSG_extensionName__ はそう言うために間接の層を1つ増やすだけ。
    name: "sift",
    description: "__MSG_extensionDescription__",
    permissions: [
      "storage",
      "activeTab",
      "scripting",
      ...(localDeploy ? (["nativeMessaging"] as const) : []),
    ],
    action: {
      default_title: "sift",
    },
  },
  hooks: {
    "vite:build:extendConfig": (entrypoints, viteConfig) => {
      const group = entrypoints.map((entrypoint) => entrypoint.name).join("+");
      viteConfig.build ??= {};
      viteConfig.build.license = {
        fileName: `${licensePartsDir}/${group}.json`,
      };
    },
    "build:done": (wxt) => mergeLicenseParts(wxt.config.outDir),
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __SIFT_LOCAL_DEPLOY__: JSON.stringify(localDeploy),
      __SIFT_LOCAL_BUILD__: JSON.stringify(localBuild),
      __SIFT_BUILD_ID__: JSON.stringify(buildId),
    },
  }),
});
