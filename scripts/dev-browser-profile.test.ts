// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  assertDevBrowserProfile,
  secureDevBrowserProfile,
} from "./dev-browser-profile.ts";

describe("開発専用 profile の境界", () => {
  const directories: string[] = [];
  const temporary = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sift-owned-profile-"));
    directories.push(dir);
    return dir;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      const resolved = path.resolve(directory);
      if (
        !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(resolved).startsWith("sift-owned-profile-")
      )
        throw Error("unexpected cleanup target");
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
  test("完全パスの custom profile を作り、Windows ACL を変更しない", () => {
    const dir = temporary();
    const profile = path.join(dir, "custom-browser-data");
    const chmod = vi.spyOn(fs, "chmodSync");
    secureDevBrowserProfile(profile, "win32", path.join(dir, "home"));
    expect(fs.statSync(profile).isDirectory()).toBe(true);
    expect(chmod).not.toHaveBeenCalled();
  });
  test("読取検査だけでは存在しない profile を作らない", () => {
    const profile = path.join(temporary(), "custom-browser-data");
    expect(assertDevBrowserProfile(profile)).toBe(profile);
    expect(fs.existsSync(profile)).toBe(false);
  });
  test.each([
    "google-chrome",
    "google-chrome-beta",
    "google-chrome-unstable",
    "google-chrome-canary",
    "google-chrome-for-testing",
    "chromium",
  ])("Linux channel %s とその子を変更しない", (channel) => {
    const parent = temporary();
    const home = path.join(parent, "home");
    const normal = path.join(home, ".config", channel);
    for (const profile of [normal, path.join(normal, "child")])
      expect(() => secureDevBrowserProfile(profile, "linux", home)).toThrow(
        "開発専用",
      );
    expect(fs.existsSync(normal)).toBe(false);
  });
  test.each([
    "Chrome",
    "Chrome Beta",
    "Chrome Dev",
    "Chrome SxS",
    "Chrome for Testing",
    "Chromium",
  ])("Windows channel %s の大小文字と子を変更しない", (channel) => {
    const parent = temporary();
    const normal = path.join(
      parent,
      "AppData",
      "Local",
      channel === "Chromium" ? "Chromium" : "Google",
      ...(channel === "Chromium" ? [] : [channel]),
      "uSeR dAtA",
    );
    expect(() =>
      secureDevBrowserProfile(
        path.join(normal, "child"),
        "win32",
        path.join(parent, "home"),
      ),
    ).toThrow("開発専用");
    expect(fs.existsSync(normal)).toBe(false);
  });
  test.each([
    "Chrome",
    "Chrome Beta",
    "Chrome Dev",
    "Chrome Canary",
    "Chrome for Testing",
  ])("macOS channel %s を変更しない", (channel) => {
    const parent = temporary();
    const normal = path.join(
      parent,
      "Library",
      "Application Support",
      "Google",
      channel,
    );
    expect(() =>
      secureDevBrowserProfile(normal, "darwin", path.join(parent, "home")),
    ).toThrow("開発専用");
    expect(fs.existsSync(normal)).toBe(false);
  });
  test("home と root は拒否する", () => {
    const home = temporary();
    for (const p of [home, path.parse(home).root])
      expect(() => secureDevBrowserProfile(p, process.platform, home)).toThrow(
        "開発専用",
      );
  });
  test("祖先 junction / symlink の先に profile を作らない", () => {
    const parent = temporary();
    const actual = path.join(parent, "actual");
    const alias = path.join(parent, "alias");
    fs.mkdirSync(actual);
    fs.symlinkSync(
      actual,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      secureDevBrowserProfile(path.join(alias, "missing", "profile")),
    ).toThrow("実体のある");
    expect(fs.existsSync(path.join(actual, "missing"))).toBe(false);
  });
  test("leaf junction / symlink は変更しない", () => {
    const parent = temporary();
    const actual = path.join(parent, "actual");
    const alias = path.join(parent, "alias");
    fs.mkdirSync(actual);
    fs.symlinkSync(
      actual,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => secureDevBrowserProfile(alias)).toThrow("実体のある");
    expect(fs.statSync(actual).isDirectory()).toBe(true);
  });

  test("home junction の実体も作成・chmod前に拒否する", () => {
    const parent = temporary();
    const actual = path.join(parent, "home-actual");
    const alias = path.join(parent, "home-alias");
    fs.mkdirSync(actual);
    fs.symlinkSync(
      actual,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const chmod = vi.spyOn(fs, "chmodSync");
    expect(() =>
      secureDevBrowserProfile(actual, process.platform, alias),
    ).toThrow("開発専用");
    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });
  test("cwd の relative dot と canonical alias を変更しない", () => {
    const parent = temporary();
    const actual = path.join(parent, "working-root");
    const alias = path.join(parent, "working-alias");
    fs.mkdirSync(actual);
    fs.symlinkSync(
      actual,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    vi.spyOn(process, "cwd").mockReturnValue(actual);
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const chmod = vi.spyOn(fs, "chmodSync");
    for (const target of [".", actual, alias])
      expect(() => secureDevBrowserProfile(target)).toThrow("開発専用");
    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });
  test("repository root を作成・chmod前に拒否する", () => {
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const chmod = vi.spyOn(fs, "chmodSync");
    expect(() =>
      secureDevBrowserProfile(path.resolve(import.meta.dirname, "..")),
    ).toThrow("開発専用");
    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });

  test("repository ancestor・.git・任意child を作成・chmod前に拒否する", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const chmod = vi.spyOn(fs, "chmodSync");
    for (const target of [
      path.dirname(root),
      path.join(root, ".git"),
      path.join(root, "custom"),
      path.join(root, ".git", "nested"),
    ])
      expect(() => secureDevBrowserProfile(target)).toThrow("作業領域");
    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });
  test("cwd の relative parent と child も拒否し、repo外のdedicated siblingは許容する", () => {
    const parent = temporary();
    const working = path.join(parent, "work");
    fs.mkdirSync(working);
    vi.spyOn(process, "cwd").mockReturnValue(working);
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const chmod = vi.spyOn(fs, "chmodSync");
    for (const target of [
      "..",
      path.join(working, ".git"),
      path.join(working, "custom"),
    ])
      expect(() => secureDevBrowserProfile(target)).toThrow("作業領域");
    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
    const dedicated = path.join(parent, "dedicated-profile");
    expect(assertDevBrowserProfile(dedicated)).toBe(dedicated);
  });
  test("home直下の標準 .sift-ext-profile は維持する", () => {
    const standard = path.join(os.homedir(), ".sift-ext-profile");
    expect(assertDevBrowserProfile(standard)).toBe(standard);
  });
  test
    .runIf(process.platform !== "win32")
    .each([0o755, 0o077, 0o000, undefined])(
    "POSIX mode %s を owner0700 に補正する",
    (mode) => {
      const parent = temporary();
      const profile = path.join(parent, "custom");
      if (mode !== undefined) fs.mkdirSync(profile, { mode });
      secureDevBrowserProfile(profile);
      expect(fs.statSync(profile).mode & 0o777).toBe(0o700);
    },
  );
});
