import { execFileSync } from "node:child_process";
import fs from "node:fs";

function writeHookOutput(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function deny(reason) {
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

function gitRoot(cwd) {
  return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function runNpm(root, script) {
  // On Windows, npm is a .cmd file. Passing one command string through the
  // shell is the supported way to invoke it from Node.
  execFileSync(`npm run ${script}`, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    stdio: "pipe",
  });
}

function isChromeSelection(code) {
  return (
    /agent\.browsers\.getForUrl\s*\(/.test(code) ||
    /agent\.browsers\.get\s*\(\s*["'](?:chrome|extension)["']\s*\)/.test(code) ||
    /agent\.browsers\.getDefault\s*\(\s*\)/.test(code)
  );
}

function addDevelopmentProfileCheck(code) {
  return `${code}

globalThis.__siftChrome = globalThis.browser ?? globalThis.chrome;
if (globalThis.__siftChrome != null) {
  globalThis.__siftDevTabs = await globalThis.__siftChrome.user.openTabs();
  if (!globalThis.__siftDevTabs.some((tab) => tab.title === "Sift 開発プロファイル")) {
    delete globalThis.browser;
    delete globalThis.chrome;
    throw new Error(
      "Sift development profile is not connected. Enable the browser connection extension in that profile, then retry.",
    );
  }
  await globalThis.__siftChrome.nameSession("🔎 Sift development profile");
}
`;
}

const rawInput = fs.readFileSync(0, "utf8");
if (!rawInput.trim()) {
  process.exit(0);
}

let hookInput;
try {
  hookInput = JSON.parse(rawInput);
} catch {
  process.exit(0);
}

const code = hookInput.tool_input?.code;
if (
  hookInput.hook_event_name !== "PreToolUse" ||
  hookInput.tool_name !== "mcp__node_repl__js" ||
  typeof code !== "string" ||
  !isChromeSelection(code)
) {
  process.exit(0);
}

try {
  const root = gitRoot(hookInput.cwd || process.cwd());
  runNpm(root, "dev");
  runNpm(root, "dev:marker");

  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        ...hookInput.tool_input,
        code: addDevelopmentProfileCheck(code),
      },
      additionalContext:
        "Sift development server and development Chrome profile were prepared. The browser binding must expose the Sift development-profile marker; otherwise do not use Chrome.",
    },
  });
} catch {
  deny(
    "Sift development server or development Chrome profile could not be prepared. Chrome was not connected.",
  );
}
