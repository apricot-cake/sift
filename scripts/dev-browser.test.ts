// @vitest-environment node

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ profile: "" }));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      disconnect: vi.fn(),
      unref: vi.fn(),
    });
    queueMicrotask(() => child.emit("message", "ready"));
    return child;
  }),
}));
vi.mock("./dev-browser-endpoint.ts", () => ({
  readDevBrowserEndpoint: vi.fn().mockResolvedValue(null),
}));
vi.mock("./managed-dev-browser.ts", () => ({
  devBrowserProfile: () => state.profile,
}));

const originalArgv = process.argv;
const parent = fs.mkdtempSync(path.join(os.tmpdir(), "sift-manual-profile-"));

beforeAll(() => {
  state.profile = path.join(parent, "manual-custom-profile");
  process.argv = [process.execPath, "scripts/dev-browser.ts"];
});

afterAll(() => {
  process.argv = originalArgv;
  fs.rmSync(parent, { recursive: true, force: true });
});

test("手動起動は新規 custom profile を作ってからログを開く", async () => {
  await import("./dev-browser.ts");

  expect(fs.statSync(state.profile).isDirectory()).toBe(true);
  expect(
    fs.statSync(path.join(state.profile, "chrome-stderr.log")).isFile(),
  ).toBe(true);
});
