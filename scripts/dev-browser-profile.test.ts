// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { secureDevBrowserProfile } from "./dev-browser-profile.ts";

describe("開発専用プロファイルの権限", () => {
  const temporaryDirectories: string[] = [];
  const temporaryDirectory = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sift-profile-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0))
      fs.rmSync(directory, { recursive: true, force: true });
  });

  test.each([0o755, undefined])(
    "POSIX の既存・新規プロファイルを 0700 にする: %s",
    (mode) => {
      const parent = temporaryDirectory();
      const profile = path.join(parent, ".sift-ext-profile");
      if (mode !== undefined) fs.mkdirSync(profile, { mode });

      secureDevBrowserProfile(profile, "linux", path.join(parent, "home"));

      expect(fs.statSync(profile).mode & 0o777).toBe(0o700);
    },
  );

  test("シンボリックリンクの参照先を chmod しない", () => {
    const parent = temporaryDirectory();
    const actual = path.join(parent, "actual");
    const profile = path.join(parent, ".sift-ext-profile");
    fs.mkdirSync(actual, { mode: 0o755 });
    fs.symlinkSync(actual, profile, "dir");

    expect(() =>
      secureDevBrowserProfile(profile, "linux", path.join(parent, "home")),
    ).toThrow("実体のあるディレクトリ");
    expect(fs.statSync(actual).mode & 0o777).toBe(0o755);
  });

  test.each(["root", "home", "通常プロファイル"])(
    "%s の指定ミスを chmod しない",
    (kind) => {
      const parent = temporaryDirectory();
      const home = path.join(parent, "home");
      fs.mkdirSync(home, { mode: 0o755 });
      const profile =
        kind === "root"
          ? path.parse(parent).root
          : kind === "home"
            ? home
            : path.join(parent, "Default");
      const chmod = vi.spyOn(fs, "chmodSync");

      expect(() => secureDevBrowserProfile(profile, "linux", home)).toThrow(
        "開発専用プロファイル以外",
      );
      expect(chmod).not.toHaveBeenCalled();
    },
  );

  test("Windows では既存 ACL に触れない", () => {
    const parent = temporaryDirectory();
    const profile = path.join(parent, ".sift-ext-profile");
    const mkdir = vi.spyOn(fs, "mkdirSync");
    const chmod = vi.spyOn(fs, "chmodSync");

    secureDevBrowserProfile(profile, "win32", path.join(parent, "home"));

    expect(mkdir).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });
});
