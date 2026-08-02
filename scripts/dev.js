// `npm run dev` — start WXT's dev server, writing the development build to a
// fixed path OUTSIDE the working tree.
//
// Outside, and identical for every tree, on purpose: the dedicated development
// Chrome profile loads one unpacked folder once, and re-pointing it every time
// work moves to another worktree would be a click nobody remembers to make.
// Because the folder never moves, nothing has to arbitrate which worktree is
// "the" source of the development build.
//
// The output path is passed to WXT through its JS API rather than an environment
// variable, so `npm run dev` behaves the same in PowerShell and in a POSIX shell.
import { homedir } from "node:os";
import { dirname, basename, resolve } from "node:path";
import { createServer } from "wxt";

const output =
  process.env.SIFT_DEV_OUTPUT || resolve(homedir(), ".sift-dev", "chrome-mv3-dev");

const server = await createServer({
  outDir: dirname(output),
  outDirTemplate: basename(output)
});

console.log(`[sift] development build: ${output}`);
console.log('[sift] first time only: load that folder into the development Chrome profile ("npm run dev:browser").');

await server.start();
