import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const devProfileName = ".sift-ext-profile";

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
  if (platform === "win32") return;

  const target = path.resolve(profile);
  const root = path.parse(target).root;
  if (
    target === root ||
    target === path.resolve(home) ||
    path.basename(target) !== devProfileName
  )
    throw new Error(`開発専用プロファイル以外は使用できません: ${target}`);

  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      `開発用プロファイルは実体のあるディレクトリを指定してください: ${target}`,
    );

  fs.chmodSync(target, 0o700);
}
