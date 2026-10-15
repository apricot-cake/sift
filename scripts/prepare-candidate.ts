import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "./build-extension.ts";
import { artifactHash } from "./compatibility/artifact.ts";
import { sourceHash } from "./compatibility/verification.ts";

const root = path.resolve(import.meta.dirname, "..");
export function prepareCandidate() {
  const sourceBefore = sourceHash(root);
  const candidate = buildExtension(
    "local",
    "build",
    path.join(root, ".output", "candidate"),
  );
  const record = {
    ...candidate,
    sha256: artifactHash(candidate.output),
    createdAt: new Date().toISOString(),
    sourceHash: sourceBefore,
  };
  if (sourceBefore !== sourceHash(root))
    throw new Error("ビルド中にソースが変更されました。");
  fs.writeFileSync(
    path.join(root, ".output", "candidate.json"),
    JSON.stringify(record, null, 2),
  );
  return record;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
  console.log(JSON.stringify(prepareCandidate(), null, 2));
