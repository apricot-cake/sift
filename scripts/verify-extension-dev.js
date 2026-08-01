import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const claudeHooks = JSON.parse(
  fs.readFileSync(path.join(repoRoot, ".claude", "settings.json"), "utf8")
);
const codexHooks = JSON.parse(
  fs.readFileSync(path.join(repoRoot, ".codex", "hooks.json"), "utf8")
);
const taskScript = fs.readFileSync(
  path.join(repoRoot, "scripts", "register-extension-dev-task.ps1"),
  "utf8"
);

assert.equal(
  packageJson.scripts.dev,
  "node scripts/extension-dev-control.js ensure"
);
assert.equal(packageJson.scripts["dev:server"], "vite");
assert.equal(
  packageJson.scripts["ext:release"],
  "node scripts/extension-dev-control.js release"
);
assert.match(taskScript, /SiftExtensionDev/);
assert.match(taskScript, /-AtLogOn/);
assert.match(taskScript, /-LogonType S4U/);
assert.match(taskScript, /-MultipleInstances IgnoreNew/);
assert.match(taskScript, /-RunLevel Limited/);
assert.match(taskScript, /PathType Container/);
assert.equal(claudeHooks.hooks.SessionStart.length, 1);
assert.equal(claudeHooks.hooks.SessionEnd.length, 1);
assert.equal(claudeHooks.hooks.PreToolUse[0].matcher, "Edit|Write|NotebookEdit");
assert.equal(codexHooks.hooks.SessionStart.length, 1);
assert.equal(codexHooks.hooks.SessionEnd.length, 1);
assert.equal(
  codexHooks.hooks.PreToolUse[0].matcher,
  "apply_patch|Edit|Write"
);

function runHook(input, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "scripts", "extension-dev-hook.js")],
      {
        env: { ...process.env, ...environment },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "sift-extension-dev-")
);
const stateDirectory = path.join(temporaryRoot, "state");
const distDev = path.join(temporaryRoot, "dist-dev");
fs.mkdirSync(stateDirectory, { recursive: true });
fs.mkdirSync(distDev, { recursive: true });
fs.writeFileSync(path.join(distDev, "manifest.json"), "{}\n", "utf8");

const server = http.createServer((request, response) => {
  if (request.url === "/@vite/client") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end("export {};");
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.equal(typeof address, "object");
const port = address.port;
const mainRoot = path.dirname(
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repoRoot, encoding: "utf8", windowsHide: true }
  ).trim()
);
fs.writeFileSync(
  path.join(stateDirectory, "extension-dev-server.json"),
  JSON.stringify({
    status: "ready",
    repoRoot,
    supervisorPid: process.pid,
    childPid: process.pid
  }),
  "utf8"
);

try {
  const readyResult = await runHook(
    { hook_event_name: "SessionStart", session_id: "owner-session" },
    {
      SIFT_DEV_PORT: String(port),
      SIFT_DEV_STATE_DIR: stateDirectory,
      SIFT_DEV_REPO_ROOT: repoRoot,
      SIFT_DEV_MAIN_ROOT: mainRoot,
      SIFT_DEV_OUT_DIR: distDev,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(readyResult.code, 0, readyResult.stderr);
  assert.match(readyResult.stdout, /development server is serving/);

  const claimPath = path.join(
    stateDirectory,
    "extension-dev-claim.json"
  );
  const ownerClaim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  assert.equal(ownerClaim.sessionId, "owner-session");
  assert.equal(path.resolve(ownerClaim.repoRoot), repoRoot);

  const ownerWriteResult = await runHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "owner-session",
      tool_name: "apply_patch"
    },
    {
      SIFT_DEV_PORT: String(port),
      SIFT_DEV_STATE_DIR: stateDirectory,
      SIFT_DEV_REPO_ROOT: repoRoot,
      SIFT_DEV_MAIN_ROOT: mainRoot,
      SIFT_DEV_OUT_DIR: distDev,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(ownerWriteResult.code, 0, ownerWriteResult.stderr);
  assert.equal(ownerWriteResult.stdout, "");

  const competingStartResult = await runHook(
    { hook_event_name: "SessionStart", session_id: "other-session" },
    {
      SIFT_DEV_PORT: String(port),
      SIFT_DEV_STATE_DIR: stateDirectory,
      SIFT_DEV_REPO_ROOT: repoRoot,
      SIFT_DEV_MAIN_ROOT: mainRoot,
      SIFT_DEV_OUT_DIR: distDev,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(competingStartResult.code, 0, competingStartResult.stderr);
  const competingStartOutput = JSON.parse(competingStartResult.stdout);
  assert.match(competingStartOutput.systemMessage, /owner-session/);
  assert.equal(
    JSON.parse(fs.readFileSync(claimPath, "utf8")).sessionId,
    "owner-session"
  );

  const competingWriteResult = await runHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "other-session",
      tool_name: "apply_patch"
    },
    {
      SIFT_DEV_PORT: String(port),
      SIFT_DEV_STATE_DIR: stateDirectory,
      SIFT_DEV_REPO_ROOT: repoRoot,
      SIFT_DEV_MAIN_ROOT: mainRoot,
      SIFT_DEV_OUT_DIR: distDev,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(competingWriteResult.code, 0, competingWriteResult.stderr);
  const competingWriteOutput = JSON.parse(competingWriteResult.stdout);
  assert.equal(
    competingWriteOutput.hookSpecificOutput.permissionDecision,
    "deny"
  );

  const blockedResult = await runHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "owner-session",
      tool_name: "apply_patch"
    },
    {
      SIFT_DEV_PORT: String(port + 1),
      SIFT_DEV_STATE_DIR: path.join(temporaryRoot, "missing-state"),
      SIFT_DEV_REPO_ROOT: repoRoot,
      SIFT_DEV_MAIN_ROOT: mainRoot,
      SIFT_DEV_OUT_DIR: distDev,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(blockedResult.code, 0, blockedResult.stderr);
  const blockedOutput = JSON.parse(blockedResult.stdout);
  assert.equal(
    blockedOutput.hookSpecificOutput.permissionDecision,
    "deny"
  );

  const releaseResult = await runHook(
    { hook_event_name: "SessionEnd", session_id: "owner-session" },
    {
      SIFT_DEV_PORT: String(port),
      SIFT_DEV_STATE_DIR: stateDirectory,
      SIFT_DEV_REPO_ROOT: repoRoot,
      SIFT_DEV_MAIN_ROOT: mainRoot,
      SIFT_DEV_OUT_DIR: distDev,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(releaseResult.code, 0, releaseResult.stderr);
  assert.equal(releaseResult.stdout, "");
  assert.equal(fs.existsSync(claimPath), false);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("resident extension development contract verified");
