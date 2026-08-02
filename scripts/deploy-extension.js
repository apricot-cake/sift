// `npm run deploy` — put a verified release build into the folder the daily
// Chrome has loaded.
//
// This is the only writer of .output/chrome-mv3. The daily browser carries
// release builds and nothing else: development happens in a separate Chrome
// profile against a separate output (wxt.config.js), so the daily extension does
// not depend on a dev server being alive, and a build that fails verification
// never reaches it.
//
// WHO CALLS THIS: the post-merge hook (.githooks/post-merge), after main is
// pulled into the MAIN working tree — so what the author browses with is
// whatever last landed on main. Safe to run by hand too.
//
// HOW THE BROWSER FINDS OUT: it does not, on its own. Chrome does not re-read an
// unpacked extension when its files change, so the new build starts running at
// the next browser start, or when the reload button in chrome://extensions is
// pressed. That is a deliberate choice (issue #20): making the extension reload
// itself is possible — a build id file it fetches would be enough — but it buys
// exactly one click, at the cost of a release service worker and a hold-off rule
// for tabs that are mid-filter.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, ".output", "chrome-mv3-release");
const DAILY = path.join(ROOT, ".output", "chrome-mv3");

// Deploy only where the destination is a folder a browser has loaded. A linked
// worktree has its own .output that nothing reads, and writing there would be a
// deploy that never reaches anything.
//
// `.git` is a directory in the main working tree and a FILE in a linked one,
// which is git's own way of saying the same thing.
function isMainWorkingTree() {
  try {
    return fs.statSync(path.join(ROOT, ".git")).isDirectory();
  } catch {
    return true; // not a git checkout at all — nothing to protect
  }
}

function listFiles(root, base = root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, base));
    else files.push(path.relative(base, absolute));
  }
  return files;
}

// Replaced IN PLACE, file by file, rather than by renaming a staged folder into
// position. Renaming is the usual way to make a swap atomic and it CANNOT be
// used here: Chrome holds an open handle on this directory for as long as the
// unpacked extension is loaded, so Windows fails the rename with EPERM.
// Un-loading the extension to free the handle would cost more clicks than the
// whole path saves.
//
// In-place is safe because nothing reads this folder until the browser is told
// to — and the browser is told to by being restarted or reloaded, after this has
// finished. Files the previous build had and this one does not are removed, so a
// renamed entrypoint cannot linger and be injected by name.
function swapIn(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const wanted = new Set(listFiles(source));
  for (const stale of listFiles(destination)) {
    if (!wanted.has(stale)) fs.rmSync(path.join(destination, stale), { force: true });
  }
  fs.cpSync(source, destination, { recursive: true, force: true });
  for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(destination, entry.name);
    if (!listFiles(absolute, destination).length) fs.rmSync(absolute, { recursive: true, force: true });
  }
}

if (!isMainWorkingTree()) {
  console.log("[sift] not the main working tree — skipping the deploy (no browser has loaded this output)");
  process.exit(0);
}

// Build and verify first: what reaches the daily folder is never an unchecked
// bundle.
execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit", shell: true });

swapIn(RELEASE, DAILY);
console.log(`[sift] deployed the verified release to ${DAILY}`);
console.log("[sift] the daily Chrome picks it up at its next start, or on reload in chrome://extensions.");
