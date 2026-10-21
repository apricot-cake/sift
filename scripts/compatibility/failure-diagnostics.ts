type Diagnostic = () => unknown | Promise<unknown>;
type RecordEvidence = (name: string, data: unknown) => void | Promise<void>;

/** 診断用ページやAPIも失効し得るため、診断の失敗で元の例外を置き換えない。 */
export async function rethrowWithDiagnostics(
  cause: unknown,
  diagnostics: Record<string, Diagnostic>,
  record: RecordEvidence,
): Promise<never> {
  const save = async (name: string, data: unknown) => {
    try {
      await record(name, data);
    } catch {
      // 証拠の保存に失敗した場合も、テスト本来の失敗を報告する。
    }
  };
  await save("failure-cause", {
    message: String(cause),
    stack: cause instanceof Error ? cause.stack : undefined,
  });
  for (const [name, diagnose] of Object.entries(diagnostics)) {
    try {
      await save(name, await diagnose());
    } catch (error) {
      await save("failure-diagnostic-error", { name, message: String(error) });
    }
  }
  throw cause;
}
