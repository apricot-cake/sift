// ローカル配備専用の Native Messaging Host。操作時の問い合わせへ配備済み
// build ID を一度だけ返し、終了する。ストア提出物には含めない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildAvailableMessage {
  type: "build-available";
  build: string | null;
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

async function run(): Promise<void> {
  const stamp = process.env.SIFT_RELOAD_STAMP;
  if (!stamp || !path.isAbsolute(stamp)) process.exit(1);

  process.stdout.on("error", () => process.exit(0));
  // Chrome が要求を書き終える前に終了しないよう、最初のフレームを読み切る。
  // 要求内容には依存せず、固定のスタンプだけを読み取る。
  let input = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    input = Buffer.concat([input, chunk]);
    if (input.length < 4) continue;
    const length = input.readUInt32LE(0);
    if (length > 64 * 1024 * 1024) process.exit(1);
    if (input.length < length + 4) continue;
    const message: BuildAvailableMessage = {
      type: "build-available",
      build: readBuildId(stamp),
    };
    process.stdout.end(encodeNativeMessage(message));
    return;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void run();
}
