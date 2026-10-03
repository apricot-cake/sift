import { spawn } from "node:child_process";
import path from "node:path";
import { withDevBrowser } from "./managed-dev-browser.ts";

const args = process.argv.slice(2);
const script = args[0];
if (!script) throw new Error("実行する Node スクリプトを指定してください。");
const abort = new AbortController();
let interrupted = false;
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const interrupt = () => {
  interrupted = true;
  abort.abort();
};
for (const signal of signals) process.on(signal, interrupt);
const interruptBreak = () => {
  process.emit("SIGINT");
};
if (process.platform === "win32") process.on("SIGBREAK", interruptBreak);
async function runNode(command: string[]): Promise<number> {
  if (abort.signal.aborted) return 130;
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, command, {
      stdio: "inherit",
      signal: abort.signal,
    });
    child.once("error", (error) => {
      if (abort.signal.aborted) resolve(130);
      else reject(error);
    });
    child.once("close", (code, signal) =>
      resolve(interrupted || signal ? 130 : (code ?? 1)),
    );
  });
}
try {
  process.exitCode = await withDevBrowser(async (owned) => {
    const loader = path.join(import.meta.dirname, "load-candidate.ts");
    if (owned && path.resolve(script) !== loader) {
      const code = await runNode([loader]);
      if (code) return code;
    }
    return await runNode(args);
  }, abort.signal);
} finally {
  for (const signal of signals) process.off(signal, interrupt);
  if (process.platform === "win32") process.off("SIGBREAK", interruptBreak);
}
