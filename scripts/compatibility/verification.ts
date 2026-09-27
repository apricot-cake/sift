import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { artifactHash } from "./artifact.ts";

export interface VerifiedCandidate {
  buildId: string;
  output: string;
  sha256: string;
  sourceHash: string;
}

/** 未追跡の実装・テストも含め、検証後の変更を検出する。内容は外部に送らない。 */
export function sourceHash(root: string): string {
  const names = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const name of names) {
    const file = path.join(root, name);
    hash.update(JSON.stringify(name));
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    else hash.update("<deleted>");
  }
  return hash.digest("hex");
}

export function assertVerified(
  candidate: VerifiedCandidate,
  receipt: {
    status: string;
    buildId?: string;
    sha256?: string;
    sourceHash?: string;
  },
  currentSourceHash: string,
): void {
  if (
    receipt.status !== "passed" ||
    receipt.buildId !== candidate.buildId ||
    receipt.sha256 !== candidate.sha256 ||
    receipt.sourceHash !== currentSourceHash ||
    candidate.sourceHash !== currentSourceHash
  )
    throw new Error(
      "配備できません。現在のソースと候補ビルドに対する完全な検証結果が必要です。",
    );
  if (artifactHash(candidate.output) !== candidate.sha256)
    throw new Error("検証後に成果物が変更されています。");
}

/** 配備済み成果物は退避し、検証したバイト列だけを昇格する。再ビルドしない。 */
export function promoteCandidate(
  root: string,
  candidate: VerifiedCandidate,
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
