import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { artifactHash } from "./artifact.ts";

export interface CandidateBuild {
  buildId: string;
  output: string;
  sha256: string;
  sourceHash: string;
}

/** 拡張機能の未追跡の実装・テストも含めて変更を検出する。独立ビルドのWebサイトは除く。 */
export function sourceHash(root: string): string {
  const names = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((name) => !name.startsWith("website/"))
    .sort();
  const hash = createHash("sha256");
  hash.update("sift-extension-source-v2");
  for (const name of names) {
    const file = path.join(root, name);
    hash.update(JSON.stringify(name));
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    else hash.update("<deleted>");
  }
  return hash.digest("hex");
}

/** 配備済み成果物を退避して候補をコピーする。コピーの整合性を確認してから切り替える。 */
export function promoteCandidate(
  root: string,
  candidate: CandidateBuild,
): string {
  const outputRoot = path.join(root, ".output");
  if (
    path.resolve(candidate.output) !==
    path.join(outputRoot, "candidate", "chrome-mv3")
  )
    throw new Error("候補成果物の場所が一致しません。");
  const staging = fs.mkdtempSync(path.join(outputRoot, "promote-"));
  const staged = path.join(staging, "chrome-mv3");
  fs.cpSync(candidate.output, staged, { recursive: true, errorOnExist: true });
  if (artifactHash(staged) !== candidate.sha256)
    throw new Error("配備用コピーのハッシュが一致しません。");
  const destination = path.join(outputRoot, "chrome-mv3");
  const backup = path.join(staging, "previous");
  const existed = fs.existsSync(destination);
  if (existed) fs.renameSync(destination, backup);
  try {
    fs.renameSync(staged, destination);
  } catch (error) {
    if (existed) fs.renameSync(backup, destination);
    throw error;
  }
  return destination;
}
