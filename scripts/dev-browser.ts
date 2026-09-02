// 開発用の Chrome プロファイルを親プロセス限定の CDP パイプ付きで起動し、
// 配備済みの production ビルドを読み込む。Chrome を閉じるまでこのプロセスも
// 動かし、別のプロセスが後からデバッグ接続できる待受ポートは作らない。
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { selectAdapter } from "../utils/adapters/index.ts";
import { findChromePath } from "./chrome-path.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const OUTPUT = path.join(ROOT, ".output", "chrome-mv3");
const EXTENSION_ID = "bohbpocokkfioejlabmeaimpkpmablkm";

interface ExtensionInfo {
  id: string;
  path: string;
  enabled: boolean;
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  url: string;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CdpPipeClient {
  readonly #input: Writable;
  readonly #output: Readable;
  readonly #pending = new Map<number, PendingCall>();
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #disposed = false;

  constructor(input: Writable, output: Readable) {
    this.#input = input;
    this.#output = output;
    output.on("data", this.#handleData);
    output.on("end", this.#handleClose);
    output.on("error", this.#handleError);
    input.on("error", this.#handleError);
  }

  call<T>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    if (this.#disposed) {
      return Promise.reject(new Error("CDP パイプは既に閉じている。"));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} が時間内に応答しなかった。`));
      }, 5000);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      const message = {
        id,
        method,
        params,
        ...(sessionId === undefined ? {} : { sessionId }),
      };
      this.#input.write(`${JSON.stringify(message)}\0`, "utf8");
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#output.off("data", this.#handleData);
    this.#output.off("end", this.#handleClose);
    this.#output.off("error", this.#handleError);
    this.#input.off("error", this.#handleError);
    this.#input.end();
    this.#failAll(new Error("CDP パイプを閉じた。"));
  }

  #handleData = (chunk: Buffer | string): void => {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#buffer = Buffer.concat([this.#buffer, incoming]);
    for (;;) {
      const separator = this.#buffer.indexOf(0);
      if (separator < 0) return;
      const body = this.#buffer.subarray(0, separator);
      this.#buffer = this.#buffer.subarray(separator + 1);
      if (body.length === 0) continue;
      let message: CdpResponse;
      try {
        message = JSON.parse(body.toString("utf8")) as CdpResponse;
      } catch {
        this.#failAll(new Error("CDP パイプから不正な JSON を受け取った。"));
        return;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.#pending.get(message.id);
      if (!pending) continue;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? "CDP 呼び出しに失敗した。"),
        );
      } else {
        pending.resolve(message.result);
      }
    }
  };

  #handleClose = (): void => {
    this.#failAll(new Error("Chrome が CDP パイプを閉じた。"));
  };

  #handleError = (): void => {
    this.#failAll(new Error("Chrome との CDP パイプ接続に失敗した。"));
  };

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

async function loadSharedExtension(client: CdpPipeClient): Promise<void> {
  const loaded = await client.call<{ id: string }>("Extensions.loadUnpacked", {
    path: OUTPUT,
  });
  const listed = await client.call<{ extensions: ExtensionInfo[] }>(
    "Extensions.getExtensions",
  );
  const extension = listed.extensions.find((item) => item.id === loaded.id);
  if (
    loaded.id !== EXTENSION_ID ||
    !extension?.enabled ||
    path.resolve(extension.path) !== path.resolve(OUTPUT)
  ) {
    throw new Error(
      `CDP が共有ビルドを有効にできなかった: ${loaded.id} ${extension?.path ?? "(pathなし)"}`,
    );
  }
}

async function verifySupportedPage(client: CdpPipeClient): Promise<void> {
  const targets = await client.call<{ targetInfos: CdpTargetInfo[] }>(
    "Target.getTargets",
  );
  const target = targets.targetInfos.find((candidate) => {
    if (candidate.type !== "page") return false;
    try {
      return selectAdapter(new URL(candidate.url).hostname) !== null;
    } catch {
      return false;
    }
  });
  if (!target) {
    throw new Error(
      "[sift] 開発用 Chrome に対応サイトのタブが無い。確認対象を開いてから再実行すること。",
    );
  }

  const attached = await client.call<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId: target.targetId, flatten: true },
  );
  try {
    await client.call("Page.reload", { ignoreCache: true }, attached.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await client
      .call("Target.detachFromTarget", { sessionId: attached.sessionId })
      .catch(() => {});
  }

  const tabTargets = await client.call<{ targetInfos: CdpTargetInfo[] }>(
    "Target.getTargets",
    { filter: [{ type: "tab", exclude: false }, { exclude: true }] },
  );
  const tabTarget = tabTargets.targetInfos.find(
    (candidate) => candidate.type === "tab" && candidate.url === target.url,
  );
  if (!tabTarget) {
    throw new Error(
      "[sift] 再読み込みしたページのタブを CDP で特定できなかった。",
    );
  }
  await client.call("Extensions.triggerAction", {
    id: EXTENSION_ID,
    targetId: tabTarget.targetId,
  });
  console.log(
    `[sift] 対応サイトを再読み込み、サイドパネルを開いた: ${target.url}`,
  );
}

function waitForChromeExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(
          new Error(
            `[sift] 開発用 Chrome が終了コード ${child.exitCode} で停止した。`,
          ),
        );
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal !== null) resolve();
      else
        reject(
          new Error(`[sift] 開発用 Chrome が終了コード ${code} で停止した。`),
        );
    });
  });
}

async function main(): Promise<void> {
  const chrome = process.env.SIFT_CHROME || findChromePath();

  if (process.argv.includes("--print")) {
    console.log(`chrome:      ${chrome}`);
    console.log(`プロファイル: ${PROFILE}`);
    console.log("CDP:         親プロセス限定のパイプ");
    console.log(
      `ビルド:      ${OUTPUT}${fs.existsSync(path.join(OUTPUT, "manifest.json")) ? "" : "  (まだ配備されていない)"}`,
    );
    return;
  }

  if (!fs.existsSync(path.join(OUTPUT, "manifest.json"))) {
    throw new Error(
      `[sift] 共有ビルドが無い。先に "npm run deploy" を実行すること: ${OUTPUT}`,
    );
  }

  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(
    chrome,
    [
      `--user-data-dir=${PROFILE}`,
      "--remote-debugging-pipe",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
    {
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const input = child.stdio[3] as Writable | null;
  const output = child.stdio[4] as Readable | null;
  if (!input || !output) {
    child.kill();
    throw new Error("[sift] Chrome の CDP パイプを作れなかった。");
  }

  const stopChrome = () => child.kill();
  process.once("SIGINT", stopChrome);
  process.once("SIGTERM", stopChrome);
  const client = new CdpPipeClient(input, output);
  try {
    await client.call("Browser.getVersion");
    console.log(
      `[sift] CDP パイプ付きの開発用プロファイルを開いた: ${PROFILE}`,
    );
    await loadSharedExtension(client);
    console.log(`[sift] 開発用プロファイルで共有ビルドを読み込んだ: ${OUTPUT}`);

    if (process.argv.includes("--verify")) {
      await verifySupportedPage(client);
    }

    console.log("[sift] Chrome を閉じるまで CDP パイプを維持する。");
    await waitForChromeExit(child);
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  } finally {
    process.off("SIGINT", stopChrome);
    process.off("SIGTERM", stopChrome);
    client.dispose();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
