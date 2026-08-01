import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const extensionDevConfig = Object.freeze({
  host: process.env.SIFT_DEV_HOST ?? "127.0.0.1",
  port: Number(process.env.SIFT_DEV_PORT ?? 51732),
  taskName: process.env.SIFT_DEV_TASK_NAME ?? "SiftExtensionDev",
  repoRoot:
    process.env.SIFT_DEV_REPO_ROOT ?? path.resolve(scriptDirectory, ".."),
  stateDirectory:
    process.env.SIFT_DEV_STATE_DIR ?? path.join(os.homedir(), ".sift")
});

export const extensionDevPaths = Object.freeze({
  state: path.join(
    extensionDevConfig.stateDirectory,
    "extension-dev-server.json"
  ),
  lock: path.join(
    extensionDevConfig.stateDirectory,
    "extension-dev-server.lock"
  ),
  log: path.join(
    extensionDevConfig.stateDirectory,
    "extension-dev-server.log"
  )
});

export function ensureStateDirectory() {
  fs.mkdirSync(extensionDevConfig.stateDirectory, { recursive: true });
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(extensionDevPaths.state, "utf8"));
  } catch {
    return null;
  }
}

export function writeState(value) {
  ensureStateDirectory();
  const temporaryPath = `${extensionDevPaths.state}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      {
        ...value,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.renameSync(temporaryPath, extensionDevPaths.state);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function probeViteClient(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: extensionDevConfig.host,
        port: extensionDevConfig.port,
        path: "/@vite/client",
        timeout: timeoutMs
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );

    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

export async function getReadiness() {
  const state = readState();
  const repoRoot = state?.repoRoot ?? extensionDevConfig.repoRoot;
  const manifestPath = path.join(repoRoot, "dist-dev", "manifest.json");
  const [viteClient, manifest] = await Promise.all([
    probeViteClient(),
    Promise.resolve(fs.existsSync(manifestPath))
  ]);
  const supervisor = isProcessAlive(state?.supervisorPid);
  const child = isProcessAlive(state?.childPid);

  return {
    ready:
      state?.status === "ready" &&
      supervisor &&
      child &&
      viteClient &&
      manifest,
    supervisor,
    child,
    viteClient,
    manifest,
    state,
    repoRoot,
    manifestPath
  };
}

export function readinessSummary(readiness) {
  return [
    `status=${readiness.state?.status ?? "missing"}`,
    `supervisor=${readiness.supervisor ? "alive" : "down"}`,
    `vite=${readiness.child ? "alive" : "down"}`,
    `client=${readiness.viteClient ? "ready" : "down"}`,
    `manifest=${readiness.manifest ? "ready" : "missing"}`
  ].join(", ");
}
