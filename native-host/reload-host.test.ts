import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { encodeNativeMessage, readBuildId } from "./reload-host.ts";

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
});
