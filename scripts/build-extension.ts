import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type BuildKind = "local" | "store";
export type BuildAction = "build" | "zip";

const ROOT = path.resolve(import.meta.dirname, "..");

export function outputFor(kind: BuildKind): string {
  return kind === "local"
    ? path.join(ROOT, ".output", "chrome-mv3")
    : path.join(ROOT, ".output", "store", "chrome-mv3");
}

export function buildExtension(
  kind: BuildKind,
  action: BuildAction = "build",
): { buildId: string; output: string } {
  const buildId = kind === "local" ? randomUUID() : "";
  const wxt = path.join(ROOT, "node_modules", "wxt", "bin", "wxt.mjs");
  const env = {
    ...process.env,
    SIFT_BUILD_KIND: kind,
    SIFT_BUILD_ID: buildId,
  };

  // .cmd のシェル解釈を避け、WXT の公式CLIを現在のNodeで直接実行する。
  execFileSync(
    process.execPath,
    [wxt, action, "-b", "chrome", "--mode", "production"],
    {
      cwd: ROOT,
      env,
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "verify-manifest.ts"), kind],
    { cwd: ROOT, env, stdio: "inherit" },
  );

  return { buildId, output: outputFor(kind) };
}

function parseKind(value: string | undefined): BuildKind {
  if (value === "local" || value === "store") return value;
  throw new Error("ビルド種別は local または store を指定してください。");
}

function parseAction(value: string | undefined): BuildAction {
  if (value === undefined || value === "build") return "build";
  if (value === "zip") return "zip";
  throw new Error("ビルド操作は build または zip を指定してください。");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const kind = parseKind(process.argv[2]);
  const action = parseAction(process.argv[3]);
  const result = buildExtension(kind, action);
  console.log(`[sift] ${kind} ${action}: ${result.output}`);
}
