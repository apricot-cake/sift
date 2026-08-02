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
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output =
  process.env.SIFT_DEV_OUTPUT || path.join(homedir(), ".sift-dev", "chrome-mv3-dev");

console.log(`[sift] development build folder: ${output}`);
console.log("[sift] load THAT folder as an unpacked extension in the development Chrome profile (once).");

// One string, no argument array: on Windows `npx` is a .cmd, which Node will not
// spawn without a shell and refuses to spawn through execFileSync with one — and
// passing an argument array alongside `shell: true` prints DEP0190.
execFileSync("npx wxt", {
  cwd: ROOT,
  shell: true,
  stdio: "inherit",
  env: { ...process.env, SIFT_DEV_OUTPUT: output }
});
