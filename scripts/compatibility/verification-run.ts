export type VerificationTask = "check" | "test:live" | "smoke:connection";

/** 静的検証後は、E2Eの失敗時も必須の接続確認を実行する。 */
export function runVerificationTasks(run: (task: VerificationTask) => void) {
  run("check");
  const failures: Error[] = [];
  for (const task of ["test:live", "smoke:connection"] as const) {
    try {
      run(task);
    } catch (cause) {
      failures.push(new Error(`${task} が失敗しました。`, { cause }));
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      failures.map((error) => error.message).join("\n"),
    );
}

/** 検証や結果の照合に失敗した場合、以前の合格記録を残さない。 */
export function recordVerification(
  verify: () => void,
  record: (status: "running" | "passed" | "failed", error?: string) => void,
) {
  record("running");
  try {
    verify();
    record("passed");
  } catch (error) {
    record("failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
