import type {
  JSONReport,
  JSONReportSpec,
  JSONReportSuite,
} from "@playwright/test/reporter";
import {
  type CompatibilityCase,
  requiredFilterEvidence,
} from "../../e2e/cases.ts";

/** 起動や最低値だけの成功を、ページの全フィルター検証完了として扱わない。 */
export function assertLiveCoverage(
  report: JSONReport,
  cases: readonly CompatibilityCase[],
  lifecycle: readonly { id: string }[] = [],
  empty: readonly { id: string }[] = [],
  unsupported: readonly { id: string }[] = [],
): void {
  const flatten = (suites: JSONReportSuite[]): JSONReportSpec[] =>
    suites.flatMap((suite) => [...suite.specs, ...flatten(suite.suites ?? [])]);
  const specs = flatten(report.suites);
  if (
    specs.length !==
    cases.length + lifecycle.length + empty.length + unsupported.length
  )
    throw new Error("対象マトリクスが一致しません。");
  const requiredEffects = new Set<string>();
  const verifiedEffects = new Set<string>();
  for (const target of cases) {
    const matches = specs.filter((spec) => spec.title === target.id);
    const result = matches[0]?.tests[0]?.results[0];
    if (
      matches.length !== 1 ||
      matches[0]?.tests.length !== 1 ||
      matches[0]?.tests[0]?.results.length !== 1 ||
      result?.status !== "passed" ||
      result.errors.length
    )
      throw new Error(`${target.id}: 完全な成功結果ではありません。`);
    for (const name of requiredFilterEvidence(target)) {
      const effect = `${target.site}: ${name}`;
      requiredEffects.add(effect);
      const attachments = result.attachments.filter(
        (item) => item.name === name,
      );
      const body = attachments[0]?.body;
      if (attachments.length !== 1 || !body)
        throw new Error(`${target.id}: ${name} の検証記録がありません。`);
      const evidence = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
      if (
        evidence.applied !== true ||
        evidence.cleared !== true ||
        evidence.noOverfilter !== true
      )
        throw new Error(
          `${target.id}: ${name} の操作・解除・誤除外の確認が不足しています。`,
        );
      const count = evidence.hidden ?? evidence.excluded;
      if (!Number.isInteger(count) || count < 0)
        throw new Error(`${target.id}: ${name} の除外件数が不正です。`);
      if (count > 0) verifiedEffects.add(effect);
    }
  }
  const missing = [...requiredEffects].filter(
    (key) => !verifiedEffects.has(key),
  );
  for (const target of lifecycle) {
    const matches = specs.filter((spec) => spec.title === target.id);
    const test = matches[0]?.tests[0];
    const result = test?.results[0];
    const attachments = result?.attachments.filter(
      (item) => item.name === "lifecycle",
    );
    const body = attachments?.[0]?.body;
    if (
      matches.length !== 1 ||
      matches[0]?.tests.length !== 1 ||
      test?.results.length !== 1 ||
      result?.status !== "passed" ||
      result.errors.length ||
      attachments?.length !== 1 ||
      !body
    )
      throw new Error(`${target.id}: 遷移の検証記録が不足しています。`);
    const evidence = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
    if (
      JSON.stringify(evidence.stages) !==
      JSON.stringify([
        "filtered",
        "unsupported-cleared",
        "supported",
        "reopened-reset",
      ])
    )
      throw new Error(
        `${target.id}: 遷移・解除・再起動の確認が不足しています。`,
      );
  }
  for (const target of [
    ...empty.map((item) => ({ ...item, state: "empty" })),
    ...unsupported.map((item) => ({ ...item, state: "unsupported" })),
  ]) {
    const matches = specs.filter((spec) => spec.title === target.id);
    const test = matches[0]?.tests[0];
    const result = test?.results[0];
    const attachments = result?.attachments.filter(
      (item) => item.name === `${target.state}-state`,
    );
    const body = attachments?.[0]?.body;
    if (
      matches.length !== 1 ||
      matches[0]?.tests.length !== 1 ||
      test?.results.length !== 1 ||
      result?.status !== "passed" ||
      result.errors.length ||
      attachments?.length !== 1 ||
      !body
    )
      throw new Error(
        `${target.id}: ${target.state} の検証記録が不足しています。`,
      );
    const evidence = JSON.parse(Buffer.from(body, "base64").toString("utf8"));
    if (
      evidence.state !== target.state ||
      (target.state === "empty"
        ? evidence.siteEmpty !== true
        : evidence.timelineAvailable !== false) ||
      evidence.controls !== 0 ||
      evidence.hidden !== 0
    )
      throw new Error(
        `${target.id}: ${target.state} の判定・操作欄・非表示状態の確認が不足しています。`,
      );
  }
  if (missing.length)
    throw new Error(`代表ページで除外効果が未確認です: ${missing.join(", ")}`);
}
