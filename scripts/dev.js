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
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output =
  process.env.SIFT_DEV_OUTPUT || path.join(homedir(), ".sift-dev", "chrome-mv3-dev");

console.log(`[sift] development build folder: ${output}`);
console.log("[sift] load THAT folder as an unpacked extension in the development Chrome profile (once).");

// WXT's CLI reads stdin for its key bindings, and a CLOSED stdin ends the
// server: started from anything without a terminal — an agent, a task runner,
// CI — it printed its first build and exited, and no save was ever rebuilt
// (measured 2026-08-02). A pipe is an stdin that stays open and delivers
// nothing, which is exactly what those callers want.
//
// A real terminal still gets `inherit`, because that is what makes the key
// bindings work for a person who typed `npm run dev` themselves.
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
  process.exit(signal ? 1 : (code ?? 0));
});
