import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { encodeNativeMessage, readBuildId } from "./reload-host.ts";

const host = path.join(import.meta.dirname, "reload-host.ts");
const request = encodeNativeMessage({ type: "check-build" });

function decodeResponse(frame: Buffer): unknown {
  const length = frame.readUInt32LE(0);
  expect(frame.length).toBe(length + 4);
  return JSON.parse(frame.subarray(4).toString("utf8"));
}

describe("自己リロードNative Host", () => {
  test("Chrome Native Messagingの長さ付きJSONを作る", () => {
    const frame = encodeNativeMessage({
      type: "build-available",
      build: "next",
    });
    const length = frame.readUInt32LE(0);
    expect(length).toBe(frame.length - 4);
    expect(JSON.parse(frame.subarray(4).toString("utf8"))).toEqual({
      type: "build-available",
      build: "next",
    });
  });

  test("完全な配備スタンプだけを読む", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sift-host-test-"));
    const stamp = path.join(root, "extension-build.json");
    try {
      expect(readBuildId(stamp)).toBeNull();
      fs.writeFileSync(stamp, "{", "utf8");
      expect(readBuildId(stamp)).toBeNull();
      fs.writeFileSync(stamp, JSON.stringify({ build: "next" }), "utf8");
      expect(readBuildId(stamp)).toBe("next");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each(["missing", "invalid", "empty", "available"])(
    "単発問い合わせへ応答して終了する: %s",
    (state) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "sift-host-request-"));
      const stamp = path.join(root, "extension-build.json");
      try {
        if (state === "invalid") fs.writeFileSync(stamp, "{");
        if (state === "empty") fs.writeFileSync(stamp, '{"build":""}');
        if (state === "available") fs.writeFileSync(stamp, '{"build":"next"}');
        const result = execFileSync(process.execPath, [host], {
          input: request,
          env: { ...process.env, SIFT_RELOAD_STAMP: stamp },
          timeout: 3000,
          windowsHide: true,
        });
        expect(decodeResponse(result)).toEqual({
          type: "build-available",
          build: state === "available" ? "next" : null,
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test("要求が分割されても読み切り、入力の切断を待たずに応答・終了する", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sift-host-fragments-"));
    const stamp = path.join(root, "extension-build.json");
    fs.writeFileSync(stamp, '{"build":"next"}');
    const child = spawn(process.execPath, [host], {
      env: { ...process.env, SIFT_RELOAD_STAMP: stamp },
      windowsHide: true,
      stdio: "pipe",
    });
    try {
      const output: Buffer[] = [];
      child.stdout.on("data", (chunk) => output.push(chunk));
      const completed = new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error("単発Hostが入力の切断を待っている"));
        }, 3000);
        child.once("error", reject);
        child.once("close", (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
      });
      child.stdin.write(request.subarray(0, 2));
      await new Promise<void>((resolve) => setImmediate(resolve));
      child.stdin.write(request.subarray(2, 5));
      await new Promise<void>((resolve) => setImmediate(resolve));
      child.stdin.write(request.subarray(5));
      // stdin.end() は呼ばない。Chrome側が接続を保持していてもHostは終了する。
      expect(await completed).toBe(0);
      expect(decodeResponse(Buffer.concat(output))).toEqual({
        type: "build-available",
        build: "next",
      });
    } finally {
      child.kill();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
