// ローカル配備専用の Native Messaging Host。配備スタンプを監視し、新しい
// build ID を接続中の Sift へ伝える。ストア提出物には含めない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildAvailableMessage {
  type: "build-available";
  build: string;
}

export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function readBuildId(file: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof value.build === "string" && value.build !== ""
      ? value.build
      : null;
  } catch {
    return null;
  }
}

function run(): void {
  const stamp = process.env.SIFT_RELOAD_STAMP;
  if (!stamp || !path.isAbsolute(stamp)) process.exit(1);

  let lastSent: string | null = null;
  const sendCurrent = () => {
    const build = readBuildId(stamp);
    if (!build || build === lastSent) return;
    lastSent = build;
    process.stdout.write(
      encodeNativeMessage({ type: "build-available", build }),
    );
  };

  process.stdout.on("error", () => process.exit(0));
  process.stdin.on("end", () => {
    fs.unwatchFile(stamp, sendCurrent);
  });
  process.stdin.resume();

  sendCurrent();
  fs.watchFile(stamp, { interval: 250 }, sendCurrent);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  run();
}
