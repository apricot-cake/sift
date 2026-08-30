import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  EXTENSION_ID,
  HOST_NAME,
  installReloadHost,
  publishBuildStamp,
  reloadHostDirectory,
  windowsUserContextMatches,
} from "./install.ts";

const originalDirectory = process.env.SIFT_RELOAD_HOST_DIR;

afterEach(() => {
  if (originalDirectory === undefined) delete process.env.SIFT_RELOAD_HOST_DIR;
  else process.env.SIFT_RELOAD_HOST_DIR = originalDirectory;
});

describe("自己リロードNative Hostの登録物", () => {
  test("既定のHostをChromeと共有するリポジトリ出力へ置く", () => {
    delete process.env.SIFT_RELOAD_HOST_DIR;
    expect(reloadHostDirectory()).toBe(
      path.resolve(import.meta.dirname, "..", ".output", "native-host"),
    );
  });

  test.runIf(process.platform === "win32")(
    "固定IDだけを許可するmanifestと再生成可能なHostを作る",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "sift-install-test-"));
      process.env.SIFT_RELOAD_HOST_DIR = root;
      try {
        const installed = installReloadHost({ register: false });
        const manifest = JSON.parse(
          fs.readFileSync(installed.manifest, "utf8"),
        );
        expect(manifest.name).toBe(HOST_NAME);
        expect(manifest.path).toBe(installed.launcher);
        expect(manifest.allowed_origins).toEqual([
          `chrome-extension://${EXTENSION_ID}/`,
        ]);
        expect(fs.existsSync(installed.host)).toBe(true);

        const stamp = publishBuildStamp("next", "C:\\build");
        expect(JSON.parse(fs.readFileSync(stamp, "utf8"))).toMatchObject({
          build: "next",
          output: "C:\\build",
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("Windowsユーザー領域の実行判定", () => {
  test("環境の所有者と同じWindowsユーザーを許可する", () => {
    expect(
      windowsUserContextMatches(
        "desktop-2ij7h91\\apricot\r\n",
        "DESKTOP-2IJ7H91",
        "apricot",
      ),
    ).toBe(true);
  });

  test("隔離された別ユーザーと不完全な環境を拒否する", () => {
    expect(
      windowsUserContextMatches(
        "desktop-2ij7h91\\sandbox",
        "DESKTOP-2IJ7H91",
        "apricot",
      ),
    ).toBe(false);
    expect(
      windowsUserContextMatches(
        "desktop-2ij7h91\\apricot",
        undefined,
        "apricot",
      ),
    ).toBe(false);
  });
});
