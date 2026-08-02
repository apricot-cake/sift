// `npm run dev:browser` — open the DEVELOPMENT Chrome profile.
//
// A separate profile is the whole point: the daily browser carries release
// builds and nothing else, so everything about developing the extension — the
// dev server's bundle, tab reloads on every save — happens over here instead.
//
// It is its own `--user-data-dir`, so it runs alongside the daily Chrome as a
// second process with its own sessions. Signing in to X is a one-time human
// step, and the profile keeps that login.
//
// NO --load-extension: Chrome 137+ ignores it (measured on Chrome 151), and it
// is not needed — an unpacked extension loaded once through chrome://extensions
// is remembered by the profile. That first load is the only part a person does.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PROFILE = process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const OUTPUT = process.env.SIFT_DEV_OUTPUT || path.join(homedir(), ".sift-dev", "chrome-mv3-dev");

// Where Chrome actually is, asked of Windows rather than guessed: the 32-bit
// install path exists on plenty of machines and a hardcoded 64-bit path would
// fail there with a message about the wrong thing.
function chromePath() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const found = execFileSync("where.exe", ["chrome"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* not on PATH either */
  }
  throw new Error("Chrome was not found. Set SIFT_CHROME to its full path.");
}

const chrome = process.env.SIFT_CHROME || chromePath();

// `--print` resolves everything and opens nothing. Opening a browser window
// takes the screen and the keyboard away from whoever is using the machine, so
// checking that the paths are right must not require paying that.
if (process.argv.includes("--print")) {
  console.log(`chrome:  ${chrome}`);
  console.log(`profile: ${PROFILE}`);
  console.log(`build:   ${OUTPUT}${fs.existsSync(path.join(OUTPUT, "manifest.json")) ? "" : "  (not built yet)"}`);
  process.exit(0);
}

fs.mkdirSync(PROFILE, { recursive: true });

// Detached: this command opens a browser and returns, rather than owning it for
// as long as it is up. Closing the terminal must not close the browser.
const child = spawn(chrome, [`--user-data-dir=${PROFILE}`], { detached: true, stdio: "ignore" });
child.unref();

console.log(`[sift] opened the development Chrome profile: ${PROFILE}`);
if (fs.existsSync(path.join(OUTPUT, "manifest.json"))) {
  console.log(`[sift] development build to load: ${OUTPUT}`);
} else {
  console.log(`[sift] no development build yet — run "npm run dev" first (it writes ${OUTPUT})`);
}
console.log("[sift] first time only: chrome://extensions → developer mode → load unpacked → the folder above.");
console.log("[sift] do NOT load it into the daily profile: both builds carry the same extension id.");
