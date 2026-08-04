// `npm run dev` — WXT's dev server, writing the development build to a fixed
// path OUTSIDE the working tree.
//
// Outside, and identical for every tree, on purpose: the dedicated development
// Chrome profile loads one unpacked folder once, and re-pointing it every time
// work moves to another worktree would be a click nobody remembers to make.
// Because the folder never moves, nothing has to arbitrate which worktree is
// "the" source of the development build.
//
// This shells out to the `wxt` CLI rather than calling WXT's JS API, which is
// what the first version did. `createServer().start()` resolves as soon as the
// server is listening and leaves nothing holding the event loop, so the process
// exited straight away and no file change was ever rebuilt. The CLI is also what
// WXT's own documentation describes, so `npm run dev` behaves the way that
// documentation says — Ctrl+C, the key bindings, all of it.
//
// FIRST TIME on a machine, in the development profile only:
//   1. npm run dev:browser
//   2. chrome://extensions → developer mode → load unpacked → the folder below
//   3. sign in to X
//
// The extension id is the same as the release build's (the signing key is
// fixed), so do not load both into the SAME profile — that is what the separate
// profile is for.
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output =
  process.env.SIFT_DEV_OUTPUT || path.join(homedir(), ".sift-dev", "chrome-mv3-dev");

console.log(`[sift] development build folder: ${output}`);
console.log("[sift] load THAT folder as an unpacked extension in the development Chrome profile (once).");

// Started WITHOUT a terminal — an agent session, a task runner — hand the server
// to a console window of its own and return. The window is then the status light:
// it is on the taskbar for exactly as long as the server is up, under Node's icon
// (the window's owner is this script, not a cmd wrapper), so "is the dev server
// running" is answered by looking. Without it the output goes to whatever scratch
// file the caller picked, and a server nobody can see gets started twice and
// outlives the session that started it — this one had been running unattended for
// four hours when it was found (2026-08-04).
//
// A person who typed `npm run dev` gets nothing detached: the server runs in front
// of them, where Ctrl+C and WXT's key bindings work.
//
// The window-opening rules (one command string, no `cmd /k`, the pause below) are
// Windows-wide, not sift's: skill `windows-scripting`.
if (process.platform === "win32" && !process.stdout.isTTY && !process.env.CI && !process.env.SIFT_DEV_WINDOW) {
  spawn('start "sift dev" node scripts/dev.js', {
    cwd: ROOT,
    shell: true,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, SIFT_DEV_WINDOW: "1" }
  }).unref();
  console.log("[sift] opened a console window — the server runs THERE, under Node on the taskbar.");
  console.log("[sift] the window is up only while the server is: close it to stop, and it closing means it stopped.");
  process.exit(0);
}

// WXT's CLI reads stdin for its key bindings, and a CLOSED stdin ends the
// server: started from anything without a terminal — an agent, a task runner,
// CI — it printed its first build and exited, and no save was ever rebuilt
// (measured 2026-08-02). A pipe is an stdin that stays open and delivers
// nothing, which is exactly what those callers want.
//
// A real terminal still gets `inherit`, because that is what makes the key
// bindings work for a person who typed `npm run dev` themselves. The detached
// window above counts as one: it has a console, so its key bindings work too.
const stdin = process.stdin.isTTY ? "inherit" : "pipe";

// One string, no argument array: on Windows `npx` is a .cmd, which Node will not
// spawn without a shell and refuses to spawn through execFileSync with one — and
// passing an argument array alongside `shell: true` prints DEP0190.
const child = spawn("npx wxt", {
  cwd: ROOT,
  shell: true,
  stdio: [stdin, "inherit", "inherit"],
  env: { ...process.env, SIFT_DEV_OUTPUT: output }
});

// Ctrl+C has to reach the server rather than orphan it behind a dead parent.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  // In a status window, a non-zero exit would take its reason with it: the port
  // collision, the build error, the missing install all print and vanish as the
  // window closes. Hold it until read — but ONLY on failure, so a server stopped
  // on purpose still clears itself off the taskbar.
  //
  // Ctrl+C is not a failure: Windows reports it as its own exit status, and
  // stopping the server by hand should close the window the way closing it does.
  const CONTROL_C_EXIT = 3221225786; // 0xC000013A
  if (process.env.SIFT_DEV_WINDOW && !signal && code && code !== CONTROL_C_EXIT) {
    console.error("\n[sift] the dev server exited. The window stays open so the reason above can be read.");
    try {
      execFileSync("cmd", ["/c", "pause"], { stdio: "inherit" });
    } catch {
      // pause needs a console; without one there is nothing to hold open anyway.
    }
  }
  process.exit(signal ? 1 : (code ?? 0));
});
