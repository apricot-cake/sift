import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function findChromePath(): string {
  if (process.platform !== "win32") {
    for (const command of [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
    ]) {
      try {
        const found = execFileSync("which", [command], {
          encoding: "utf8",
        }).trim();
        if (found && fs.existsSync(found)) return found;
      } catch {
        // 次の候補を探す。
      }
    }
    throw new Error(
      "Chrome が見つからない。SIFT_CHROME にその完全な経路を設定してください。",
    );
  }
  const candidates = [
    path.join(
      process.env.PROGRAMFILES || "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const found = execFileSync("where.exe", ["chrome"], { encoding: "utf8" })
      .split(/\r?\n/)
      .find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch {
    // PATH にも無い。
  }
  throw new Error(
    "Chrome が見つからない。SIFT_CHROME にその完全な経路を設定すること。",
  );
}
