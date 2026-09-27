import { describe, expect, test } from "vitest";
import {
  recordVerification,
  runVerificationTasks,
  type VerificationTask,
} from "./verification-run.ts";

describe("候補の全検証", () => {
  test("E2E失敗後も接続確認を実行し、全体は不合格にする", () => {
    const tasks: VerificationTask[] = [];
    expect(() =>
      runVerificationTasks((task) => {
        tasks.push(task);
        if (task === "test:live") throw new Error("E2E failure");
      }),
    ).toThrow("test:live が失敗しました。");
    expect(tasks).toEqual(["check", "test:live", "smoke:connection"]);
  });

  test("静的検証失敗時は実サイトを操作しない", () => {
    const tasks: VerificationTask[] = [];
    expect(() =>
      runVerificationTasks((task) => {
        tasks.push(task);
        throw new Error("check failure");
      }),
    ).toThrow("check failure");
    expect(tasks).toEqual(["check"]);
  });

  test("両方の実機検証の失敗を残す", () => {
    expect(() =>
      runVerificationTasks((task) => {
        if (task !== "check") throw new Error(task);
      }),
    ).toThrow("test:live が失敗しました。\nsmoke:connection が失敗しました。");
  });

  test("全検証成功時だけ合格を記録する", () => {
    const states: string[] = [];
    const tasks: VerificationTask[] = [];
    recordVerification(
      () => runVerificationTasks((task) => tasks.push(task)),
      (status) => states.push(status),
    );
    expect(tasks).toEqual(["check", "test:live", "smoke:connection"]);
    expect(states).toEqual(["running", "passed"]);
  });

  test("事前確認や結果照合の失敗も終了状態として記録する", () => {
    const states: unknown[] = [];
    expect(() =>
      recordVerification(
        () => {
          throw new Error("成果物不一致");
        },
        (status, error) => states.push({ status, error }),
      ),
    ).toThrow("成果物不一致");
    expect(states).toEqual([
      { status: "running", error: undefined },
      { status: "failed", error: "成果物不一致" },
    ]);
  });
});
