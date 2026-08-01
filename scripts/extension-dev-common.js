import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, "..");

function discoverMainRoot(repoRoot) {
  try {
    const commonDirectory = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        windowsHide: true
      }
    ).trim();
    return path.dirname(path.resolve(repoRoot, commonDirectory));
  } catch {
    return repoRoot;
  }
}

export function samePath(left, right) {
  if (!left || !right) {
    return false;
  }

  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };

  return normalize(left) === normalize(right);
}

const configuredRepoRoot = path.resolve(
  process.env.SIFT_DEV_REPO_ROOT ?? defaultRepoRoot
);
const configuredMainRoot = path.resolve(
  process.env.SIFT_DEV_MAIN_ROOT ?? discoverMainRoot(configuredRepoRoot)
);

export const extensionDevConfig = Object.freeze({
  host: process.env.SIFT_DEV_HOST ?? "127.0.0.1",
  port: Number(process.env.SIFT_DEV_PORT ?? 51732),
  taskName: process.env.SIFT_DEV_TASK_NAME ?? "SiftExtensionDev",
  repoRoot: configuredRepoRoot,
  mainRoot: configuredMainRoot,
  distDevRoot: path.resolve(
    process.env.SIFT_DEV_OUT_DIR ??
      path.join(configuredMainRoot, "dist-dev")
  ),
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
  claim: path.join(
    extensionDevConfig.stateDirectory,
    "extension-dev-claim.json"
  ),
  claimLock: path.join(
    extensionDevConfig.stateDirectory,
    "extension-dev-claim.lock"
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

function writeClaim(value) {
  ensureStateDirectory();
  const temporaryPath = `${extensionDevPaths.claim}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
  fs.renameSync(temporaryPath, extensionDevPaths.claim);
}

export function readPreviewClaim() {
  try {
    return JSON.parse(fs.readFileSync(extensionDevPaths.claim, "utf8"));
  } catch {
    return null;
  }
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

async function withClaimLock(callback, timeoutMs = 2000) {
  ensureStateDirectory();
  const deadline = Date.now() + timeoutMs;
  let descriptor = null;

  while (descriptor === null) {
    try {
      descriptor = fs.openSync(extensionDevPaths.claimLock, "wx");
      fs.writeFileSync(descriptor, String(process.pid), "utf8");
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      let lockPid = Number.NaN;
      try {
        lockPid = Number(
          fs.readFileSync(extensionDevPaths.claimLock, "utf8").trim()
        );
      } catch {
        // Retry after the owner finishes creating or removing the lock.
      }

      if (Number.isInteger(lockPid) && !isProcessAlive(lockPid)) {
        try {
          fs.unlinkSync(extensionDevPaths.claimLock);
        } catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") {
            throw unlinkError;
          }
        }
      } else if (Date.now() >= deadline) {
        throw new Error("Timed out while waiting for the preview claim lock.");
      } else {
        await wait(25);
      }
    }
  }

  try {
    return await callback();
  } finally {
    fs.closeSync(descriptor);
    try {
      fs.unlinkSync(extensionDevPaths.claimLock);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function isEligibleRepoRoot(repoRoot) {
  return (
    fs.existsSync(path.join(repoRoot, "package.json")) &&
    samePath(discoverMainRoot(repoRoot), extensionDevConfig.mainRoot)
  );
}

export async function claimPreview({ repoRoot, sessionId }) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (!sessionId) {
    throw new Error("A session ID is required to claim the preview.");
  }
  if (!isEligibleRepoRoot(resolvedRepoRoot)) {
    throw new Error(`Not a Sift worktree: ${resolvedRepoRoot}`);
  }

  return withClaimLock(() => {
    const existing = readPreviewClaim();
    if (
      existing &&
      (!samePath(existing.repoRoot, resolvedRepoRoot) ||
        existing.sessionId !== sessionId)
    ) {
      return { claimed: false, claim: existing };
    }

    const now = new Date().toISOString();
    const claim = {
      repoRoot: resolvedRepoRoot,
      sessionId,
      claimedAt: existing?.claimedAt ?? now,
      updatedAt: now
    };
    writeClaim(claim);
    return { claimed: true, claim };
  });
}

export async function releasePreview({
  force = false,
  repoRoot = null,
  sessionId = null
} = {}) {
  return withClaimLock(() => {
    const existing = readPreviewClaim();
    if (!existing) {
      return { released: false, claim: null };
    }

    const ownsClaim =
      (sessionId && existing.sessionId === sessionId) ||
      (repoRoot && samePath(existing.repoRoot, repoRoot));
    if (!force && !ownsClaim) {
      return { released: false, claim: existing };
    }

    try {
      fs.unlinkSync(extensionDevPaths.claim);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    return { released: true, claim: existing };
  });
}

export function getDesiredRepoRoot() {
  const claim = readPreviewClaim();
  if (claim?.repoRoot && isEligibleRepoRoot(claim.repoRoot)) {
    return path.resolve(claim.repoRoot);
  }
  return extensionDevConfig.mainRoot;
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

export async function getReadiness({ expectedRepoRoot = null } = {}) {
  const state = readState();
  const activeRepoRoot = state?.repoRoot ?? extensionDevConfig.mainRoot;
  const manifestPath = path.join(
    extensionDevConfig.distDevRoot,
    "manifest.json"
  );
  const [viteClient, manifest] = await Promise.all([
    probeViteClient(),
    Promise.resolve(fs.existsSync(manifestPath))
  ]);
  const supervisor = isProcessAlive(state?.supervisorPid);
  const child = isProcessAlive(state?.childPid);
  const sourceMatches =
    expectedRepoRoot === null ||
    samePath(activeRepoRoot, expectedRepoRoot);

  return {
    ready:
      state?.status === "ready" &&
      supervisor &&
      child &&
      viteClient &&
      manifest &&
      sourceMatches,
    supervisor,
    child,
    viteClient,
    manifest,
    sourceMatches,
    state,
    claim: readPreviewClaim(),
    activeRepoRoot,
    expectedRepoRoot,
    repoRoot: activeRepoRoot,
    manifestPath
  };
}

export function readinessSummary(readiness) {
  return [
    `status=${readiness.state?.status ?? "missing"}`,
    `supervisor=${readiness.supervisor ? "alive" : "down"}`,
    `vite=${readiness.child ? "alive" : "down"}`,
    `client=${readiness.viteClient ? "ready" : "down"}`,
    `manifest=${readiness.manifest ? "ready" : "missing"}`,
    `source=${readiness.activeRepoRoot ?? "unknown"}`,
    readiness.expectedRepoRoot
      ? `expected=${readiness.expectedRepoRoot}`
      : null
  ].filter(Boolean).join(", ");
}
