import { describe, expect, test } from "vitest";
import { deployLocalExtension } from "./deploy-extension.ts";

describe("ローカル拡張機能の配備", () => {
  test("検査済みビルド、Host登録、通知の順に実行する", () => {
    const events: string[] = [];
    const result = deployLocalExtension({
      assertContext: () => events.push("context"),
      build: () => {
        events.push("build");
        return { buildId: "next", output: "C:\\output" };
      },
      installHost: () => events.push("install"),
      publish: (build, output) => {
        events.push(`publish:${build}:${output}`);
        return "C:\\stamp";
      },
    });

    expect(events).toEqual([
      "context",
      "build",
      "install",
      "publish:next:C:\\output",
    ]);
    expect(result).toEqual({
      buildId: "next",
      output: "C:\\output",
      stamp: "C:\\stamp",
    });
  });

  test("ビルドに失敗した場合はHost登録も通知もしない", () => {
    const events: string[] = [];
    expect(() =>
      deployLocalExtension({
        assertContext: () => events.push("context"),
        build: () => {
          throw new Error("build failed");
        },
        installHost: () => events.push("install"),
        publish: () => {
          events.push("publish");
          return "stamp";
        },
      }),
    ).toThrow("build failed");
    expect(events).toEqual(["context"]);
  });

  test("ユーザー領域から隔離された実行ではビルド前に失敗する", () => {
    const events: string[] = [];
    expect(() =>
      deployLocalExtension({
        assertContext: () => {
          throw new Error("isolated");
        },
        build: () => {
          events.push("build");
          return { buildId: "next", output: "C:\\output" };
        },
        installHost: () => events.push("install"),
        publish: () => {
          events.push("publish");
          return "stamp";
        },
      }),
    ).toThrow("isolated");
    expect(events).toEqual([]);
  });
});
