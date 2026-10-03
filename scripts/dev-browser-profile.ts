import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function isRegularChromeProfile(target: string, home: string): boolean {
  const relative = path.relative(path.resolve(home), target);
  const parts = relative.split(path.sep);
  const base = path.basename(target);
  return (
    base === "Default" ||
    /^Profile \d+$/.test(base) ||
    parts.includes("google-chrome") ||
    parts.includes("chromium") ||
    parts.join("/").includes("Library/Application Support/Google/Chrome") ||
    parts.join("/").includes("AppData/Local/Google/Chrome/User Data")
  );
}

/**
 * 開発専用プロファイルだけを、Chrome が触れる前に所有者専用にする。
 *
 * chmod の直前にも最終パスを検査し、設定間違いでホームや通常の
 * Chrome プロファイル、シンボリックリンクを変更しない。
 */
export function secureDevBrowserProfile(
  profile: string,
  platform = process.platform,
  home = homedir(),
): void {
  const target = path.resolve(profile);
  const root = path.parse(target).root;
  if (
    target === root ||
    target === path.resolve(home) ||
    isRegularChromeProfile(target, home)
  )
    throw new Error(`開発専用プロファイル以外は使用できません: ${target}`);

  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(target) !== target
  )
    throw new Error(
      `開発用プロファイルは実体のあるディレクトリを指定してください: ${target}`,
    );

  if (platform !== "win32") fs.chmodSync(target, 0o700);
}
