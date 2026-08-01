import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
assert.match(taskScript, /SiftExtensionDev/);
assert.match(taskScript, /-AtLogOn/);
assert.match(taskScript, /-MultipleInstances IgnoreNew/);
assert.match(taskScript, /-RunLevel Limited/);
assert.match(taskScript, /PathType Container/);
assert.equal(claudeHooks.hooks.SessionStart.length, 1);
assert.equal(claudeHooks.hooks.PreToolUse[0].matcher, "Edit|Write|NotebookEdit");
assert.equal(codexHooks.hooks.SessionStart.length, 1);
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
fs.writeFileSync(
  path.join(stateDirectory, "extension-dev-server.json"),
  JSON.stringify({
    status: "ready",
    repoRoot: temporaryRoot,
    supervisorPid: process.pid,
    childPid: process.pid
  }),
  "utf8"
);

try {
  const readyResult = await runHook(
    { hook_event_name: "SessionStart" },
    {
      SIFT_DEV_PORT: String(port),
      SIFT_DEV_STATE_DIR: stateDirectory,
      SIFT_DEV_REPO_ROOT: temporaryRoot,
      SIFT_DEV_DISABLE_TASK_START: "1",
      SIFT_DEV_HOOK_TIMEOUT_MS: "50"
    }
  );
  assert.equal(readyResult.code, 0, readyResult.stderr);
  assert.match(readyResult.stdout, /development server is ready/);

  const blockedResult = await runHook(
    { hook_event_name: "PreToolUse", tool_name: "apply_patch" },
    {
      SIFT_DEV_PORT: String(port + 1),
      SIFT_DEV_STATE_DIR: path.join(temporaryRoot, "missing-state"),
      SIFT_DEV_REPO_ROOT: temporaryRoot,
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
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("resident extension development contract verified");
