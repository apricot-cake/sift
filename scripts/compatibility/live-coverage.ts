import type { JsonTestResults } from "vitest/node";
import {
  type CompatibilityCase,
  requiredFilterEvidence,
} from "../../e2e/cases.ts";

export interface LiveEvidence {
  name: string;
  data: Record<string, unknown>;
}

declare module "vitest" {
  interface TaskMeta {
    liveEvidence?: LiveEvidence[];
  }
}

/** 起動や最低値だけの成功を、ページの全フィルター検証完了として扱わない。 */
export function assertLiveCoverage(
  report: JsonTestResults,
  cases: readonly CompatibilityCase[],
  lifecycle: readonly { id: string }[] = [],
  empty: readonly { id: string }[] = [],
  unsupported: readonly { id: string }[] = [],
  lightbox: readonly { id: string }[] = [],
): void {
  const specs = report.testResults.flatMap((suite) => suite.assertionResults);
  if (
    specs.length !==
    cases.length +
      lifecycle.length +
      empty.length +
      unsupported.length +
      lightbox.length
  )
    throw new Error("対象マトリクスが一致しません。");
  const requiredEffects = new Set<string>();
  const verifiedEffects = new Set<string>();
  for (const target of cases) {
    const matches = specs.filter((spec) => spec.title === target.id);
    const result = matches[0];
    if (
      matches.length !== 1 ||
      result?.status !== "passed" ||
      result.failureMessages?.length
    )
      throw new Error(`${target.id}: 完全な成功結果ではありません。`);
    for (const name of requiredFilterEvidence(target)) {
      const effect = `${target.site}: ${name}`;
      requiredEffects.add(effect);
      const attachments = (result.meta.liveEvidence ?? []).filter(
        (item) => item.name === name,
      );
      const evidence = attachments[0]?.data;
      if (attachments.length !== 1 || !evidence)
        throw new Error(`${target.id}: ${name} の検証記録がありません。`);
      if (
        evidence.applied !== true ||
        evidence.cleared !== true ||
        evidence.noOverfilter !== true
      )
        throw new Error(
          `${target.id}: ${name} の操作・解除・誤除外の確認が不足しています。`,
        );
      const count = evidence.hidden ?? evidence.excluded;
      if (!Number.isInteger(count) || typeof count !== "number" || count < 0)
        throw new Error(`${target.id}: ${name} の除外件数が不正です。`);
      if (typeof count === "number" && count > 0) verifiedEffects.add(effect);
    }
  }
  const missing = [...requiredEffects].filter(
    (key) => !verifiedEffects.has(key),
  );
  for (const target of lifecycle) {
    const matches = specs.filter((spec) => spec.title === target.id);
    const result = matches[0];
    const attachments = result?.meta.liveEvidence?.filter(
      (item) => item.name === "lifecycle",
    );
    const evidence = attachments?.[0]?.data;
    if (
      matches.length !== 1 ||
      result?.status !== "passed" ||
      result.failureMessages?.length ||
      attachments?.length !== 1 ||
      !evidence
    )
      throw new Error(`${target.id}: 遷移の検証記録が不足しています。`);
    if (
      JSON.stringify(evidence.stages) !==
      JSON.stringify([
        "filtered",
        "navigation-closed-cleared",
        "returned-inactive",
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
    const result = matches[0];
    const attachments = result?.meta.liveEvidence?.filter(
      (item) => item.name === `${target.state}-state`,
    );
    const evidence = attachments?.[0]?.data;
    if (
      matches.length !== 1 ||
      result?.status !== "passed" ||
      result.failureMessages?.length ||
      attachments?.length !== 1 ||
      !evidence
    )
      throw new Error(
        `${target.id}: ${target.state} の検証記録が不足しています。`,
      );
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
  for (const target of lightbox) {
    const matches = specs.filter((spec) => spec.title === target.id);
    const result = matches[0];
    const attachments = result?.meta.liveEvidence?.filter(
      (item) => item.name === "lightbox-gate",
    );
    const evidence = attachments?.[0]?.data;
    if (
      matches.length !== 1 ||
      result?.status !== "passed" ||
      result.failureMessages?.length ||
      attachments?.length !== 1 ||
      !evidence ||
      evidence.settingPreserved !== true ||
      evidence.contextPreserved !== true ||
      evidence.modalVisible !== true ||
      evidence.closedRestored !== true ||
      evidence.directUnsupported !== true
    )
      throw new Error(
        `${target.id}: ライトボックスの検証記録が不足しています。`,
      );
  }
}

/** 完了した代表ケースの記録で、動的な一覧の初期化までcache無効を維持したことを確認する。 */
export function assertInitializationCoverage(
  report: JsonTestResults,
  sites: readonly string[],
): void {
  const records = report.testResults
    .flatMap((suite) => suite.assertionResults)
    .filter((spec) => spec.status === "passed" && !spec.failureMessages?.length)
    .flatMap((spec) => spec.meta.liveEvidence ?? []);
  for (const site of new Set(sites)) {
    if (
      !records.some(
        (item) =>
          item.name === "initialization-cache" &&
          item.data.site === site &&
          item.data.cacheDisabledDuringInitialization === true &&
          item.data.cacheRestored === true &&
          ["ready", "empty", "unsupported"].includes(String(item.data.state)),
      )
    )
      throw new Error(`${site}: キャッシュ無効の初期化確認が不足しています。`);
  }
}
