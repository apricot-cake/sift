import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extensionDevConfig,
  getReadiness,
  isProcessAlive,
  readState,
  readinessSummary,
  wait
} from "./extension-dev-common.js";

function taskCommand(...arguments_) {
  return spawnSync("schtasks.exe", arguments_, {
    encoding: "utf8",
    windowsHide: true
  });
}

function stopProcessTree(pid) {
  if (
    process.platform !== "win32" ||
    !Number.isInteger(pid) ||
    pid <= 0 ||
    pid === process.pid ||
    !isProcessAlive(pid)
  ) {
    return;
  }

  spawnSync(
    "taskkill.exe",
    ["/PID", String(pid), "/T", "/F"],
    { stdio: "ignore", windowsHide: true }
  );
}

export async function waitForReadiness(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let readiness = await getReadiness();

  while (!readiness.ready && Date.now() < deadline) {
    await wait(250);
    readiness = await getReadiness();
  }

  return readiness;
}

export async function ensureReady({ timeoutMs = 15_000 } = {}) {
  let readiness = await getReadiness();
  if (readiness.ready) {
    return readiness;
  }

  if (process.env.SIFT_DEV_DISABLE_TASK_START === "1") {
    return readiness;
  }

  const started = taskCommand(
    "/Run",
    "/TN",
    extensionDevConfig.taskName
  );
  if (started.status !== 0) {
    return {
      ...readiness,
      taskError: (started.stderr || started.stdout || "task start failed").trim()
    };
  }

  return waitForReadiness(timeoutMs);
}

async function statusCommand() {
  const readiness = await getReadiness();
  console.log(readinessSummary(readiness));
  if (readiness.state?.logPath) {
    console.log(`log=${readiness.state.logPath}`);
  }
  process.exitCode = readiness.ready ? 0 : 1;
}

async function ensureCommand() {
  const readiness = await ensureReady();
  console.log(readinessSummary(readiness));
  if (!readiness.ready) {
    console.error(
      readiness.taskError ??
        "Sift extension development server did not become ready."
    );
    process.exitCode = 1;
  }
}

async function restartCommand() {
  const previousState = readState();
  taskCommand("/End", "/TN", extensionDevConfig.taskName);
  stopProcessTree(previousState?.childPid);
  stopProcessTree(previousState?.supervisorPid);
  await wait(500);
  const started = taskCommand(
    "/Run",
    "/TN",
    extensionDevConfig.taskName
  );

  if (started.status !== 0) {
    console.error(
      (started.stderr || started.stdout || "task restart failed").trim()
    );
    process.exitCode = 1;
    return;
  }

  const readiness = await waitForReadiness(20_000);
  console.log(readinessSummary(readiness));
  process.exitCode = readiness.ready ? 0 : 1;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const command = process.argv[2] ?? "status";

  if (command === "status") {
    await statusCommand();
  } else if (command === "ensure") {
    await ensureCommand();
  } else if (command === "restart") {
    await restartCommand();
  } else {
    console.error("Usage: extension-dev-control.js <status|ensure|restart>");
    process.exitCode = 2;
  }
}
