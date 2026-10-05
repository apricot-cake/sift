import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const linuxProfiles =
  /^(?:google-chrome(?:-beta|-unstable|-canary|-for-testing)?|chromium)$/;
const chromeChannels =
  /^(?:chrome(?: beta| dev| sxs| canary| for testing)?|chromium)$/;

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string) =>
    platform === "win32"
      ? path.normalize(value).toLowerCase()
      : path.normalize(value);
  return normalize(a) === normalize(b);
}

function containsPath(
  parent: string,
  child: string,
  platform: NodeJS.Platform,
): boolean {
  const normalize = (value: string) =>
    platform === "win32" ? value.toLowerCase() : value;
  const relative = path.relative(normalize(parent), normalize(child));
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function canonicalPath(value: string): string {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync.native(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return absolute;
    throw error;
  }
}

/** 読取経路でも通常 profile と既存 alias を拒否する。作成・権限変更は行わない。 */
export function assertDevBrowserProfile(
  profile: string,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const target = path.resolve(profile);
  const repository = path.resolve(import.meta.dirname, "..");
  const protectedRoots = [
    path.parse(target).root,
    path.resolve(home),
    process.cwd(),
    repository,
  ];
  const canonicalTarget = canonicalPath(target);
  for (const workingRoot of [repository, process.cwd()]) {
    const canonicalRoot = canonicalPath(workingRoot);
    if (
      containsPath(canonicalRoot, canonicalTarget, platform) ||
      containsPath(canonicalTarget, canonicalRoot, platform)
    )
      throw new Error(
        `開発専用プロファイルを作業領域と重ねることはできません: ${target}`,
      );
  }
  if (
    protectedRoots.some(
      (root) =>
        samePath(target, path.resolve(root), platform) ||
        samePath(canonicalTarget, canonicalPath(root), platform),
    )
  )
    throw new Error(`開発専用プロファイル以外は使用できません: ${target}`);
  const parts = target.replace(/\\/g, "/").split("/");
  const names =
    platform === "win32" ? parts.map((part) => part.toLowerCase()) : parts;
  const normalProfile =
    names.some(
      (part) =>
        /^(?:Default|Profile \d+)$/i.test(part) || linuxProfiles.test(part),
    ) ||
    names.some((part, i) => {
      const candidate = part.toLowerCase();
      return (
        chromeChannels.test(candidate) &&
        (names[i + 1]?.toLowerCase() === "user data" ||
          (names[i - 1]?.toLowerCase() === "google" &&
            names[i - 2]?.toLowerCase() === "application support") ||
          (candidate === "chromium" &&
            names[i - 1]?.toLowerCase() === "application support"))
      );
    });
  if (
    samePath(target, path.parse(target).root, platform) ||
    samePath(target, path.resolve(home), platform) ||
    normalProfile
  )
    throw new Error(`開発専用プロファイル以外は使用できません: ${target}`);

  let current = path.parse(target).root;
  for (const component of path
    .relative(current, target)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(current), current, platform)
    )
      throw new Error(
        `開発用プロファイルは実体のあるディレクトリを指定してください: ${current}`,
      );
  }
  return target;
}

/** 専用対象だけを作成し、POSIX の所有ディレクトリのみ 0700 にする。Windows ACL は維持する。 */
export function secureDevBrowserProfile(
  profile: string,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): void {
  const target = assertDevBrowserProfile(profile, platform, home);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  assertDevBrowserProfile(target, platform, home);
  if (platform !== "win32") {
    const stat = fs.lstatSync(target);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new Error(
        "開発用プロファイルの所有者が現在のユーザーと一致しません。",
      );
    fs.chmodSync(target, 0o700);
  }
}
