import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import {
  ensureStateDirectory,
  extensionDevConfig,
  extensionDevPaths,
  isProcessAlive,
  probeViteClient,
  wait,
  writeState
} from "./extension-dev-common.js";

const maximumBackoffMs = 30_000;
const stableRunMs = 60_000;
let child = null;
let stopping = false;
let lockDescriptor = null;

function appendLog(message) {
  ensureStateDirectory();
  fs.appendFileSync(
    extensionDevPaths.log,
    `[${new Date().toISOString()}] ${message}\n`,
    "utf8"
  );
}

function acquireLock() {
  ensureStateDirectory();

  try {
    lockDescriptor = fs.openSync(extensionDevPaths.lock, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existingPid = Number(
      fs.readFileSync(extensionDevPaths.lock, "utf8").trim()
    );
    if (isProcessAlive(existingPid)) {
      appendLog(`supervisor already running (pid=${existingPid})`);
      process.exit(0);
    }

    fs.unlinkSync(extensionDevPaths.lock);
    lockDescriptor = fs.openSync(extensionDevPaths.lock, "wx");
  }

  fs.writeFileSync(lockDescriptor, String(process.pid), "utf8");
}

function releaseLock() {
  if (lockDescriptor !== null) {
    fs.closeSync(lockDescriptor);
    lockDescriptor = null;
  }

  try {
    fs.unlinkSync(extensionDevPaths.lock);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      appendLog(`could not remove lock: ${error.message}`);
    }
  }
}

function status(status, extra = {}) {
  writeState({
    status,
    taskName: extensionDevConfig.taskName,
    host: extensionDevConfig.host,
    port: extensionDevConfig.port,
    repoRoot: extensionDevConfig.repoRoot,
    supervisorPid: process.pid,
    childPid: child?.pid ?? null,
    logPath: extensionDevPaths.log,
    ...extra
  });
}

function stopChild() {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T"],
      { stdio: "ignore", windowsHide: true }
    );
  } else {
    child.kill("SIGTERM");
  }
}

async function waitUntilReady(runningChild) {
  const deadline = Date.now() + 20_000;

  while (
    !stopping &&
    runningChild.exitCode === null &&
    Date.now() < deadline
  ) {
    if (await probeViteClient()) {
      return true;
    }
    await wait(250);
  }

  return false;
}

async function runChild() {
  ensureStateDirectory();
  const logDescriptor = fs.openSync(extensionDevPaths.log, "a");
  const startedAt = Date.now();

  child = spawn("npm run dev:server", {
    cwd: extensionDevConfig.repoRoot,
    shell: true,
    stdio: ["ignore", logDescriptor, logDescriptor],
    windowsHide: true
  });
  fs.closeSync(logDescriptor);

  appendLog(`started Vite (pid=${child.pid}, cwd=${extensionDevConfig.repoRoot})`);
  status("starting", { startedAt: new Date(startedAt).toISOString() });

  const exit = new Promise((resolve) => {
    child.once("error", (error) => {
      appendLog(`could not start Vite: ${error.message}`);
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const ready = await Promise.race([
    waitUntilReady(child),
    exit.then(() => false)
  ]);

  if (ready) {
    appendLog(`Vite ready on ${extensionDevConfig.host}:${extensionDevConfig.port}`);
    status("ready", {
      readyAt: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString()
    });
  } else if (child.exitCode === null && !stopping) {
    appendLog("Vite readiness timed out; stopping child");
    status("failed", {
      error: "Vite readiness timed out",
      startedAt: new Date(startedAt).toISOString()
    });
    stopChild();
  }

  const result = await exit;
  return { ...result, runtimeMs: Date.now() - startedAt };
}

async function main() {
  acquireLock();
  appendLog(`supervisor started (pid=${process.pid})`);
  let backoffMs = 1000;

  while (!stopping) {
    const result = await runChild();
    child = null;

    if (stopping) {
      break;
    }

    appendLog(
      `Vite exited (code=${result.code}, signal=${result.signal ?? "none"}); ` +
        `retrying in ${backoffMs}ms`
    );
    status("restart-wait", {
      backoffMs,
      lastExitCode: result.code,
      lastExitSignal: result.signal
    });

    await wait(backoffMs);
    backoffMs =
      result.runtimeMs >= stableRunMs
        ? 1000
        : Math.min(backoffMs * 2, maximumBackoffMs);
  }

  status("stopped");
  appendLog("supervisor stopped");
  releaseLock();
}

function requestStop(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  appendLog(`received ${signal}`);
  stopChild();
}

process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("exit", releaseLock);

main().catch((error) => {
  appendLog(`supervisor failed: ${error.stack ?? error.message}`);
  try {
    stopChild();
    status("failed", { error: error.message });
  } finally {
    releaseLock();
  }
  process.exitCode = 1;
});
