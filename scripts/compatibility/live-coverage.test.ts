import { expect, test } from "vitest";
import type { JsonTestResults } from "vitest/node";
import type { CompatibilityCase } from "../../e2e/cases.ts";
import {
  assertInitializationCoverage,
  assertLiveCoverage,
} from "./live-coverage.ts";

const target: CompatibilityCase = {
  id: "x-profile",
  site: "x",
  start: "https://x.com/NASA",
  destination: "/NASA",
};
function report(names: string[], count = 1): JsonTestResults {
  return {
    testResults: [
      {
        status: "passed",
        message: "",
        name: "compatibility.spec.ts",
        assertionResults: [
          {
            title: target.id,
            status: "passed",
            failureMessages: [],
            meta: {
              liveEvidence: names
                .concat(
                  [
                    "media-filter",
                    "reply-filter",
                    "quote-filter",
                    "repost-filter",
                  ].filter((name) => !names.includes(name)),
                )
                .map((name) => ({
                  name,
                  data: {
                    hidden: count,
                    applied: true,
                    cleared: true,
                    noOverfilter: true,
                  },
                })),
            },
          },
        ],
      },
    ],
  } as unknown as JsonTestResults;
}

function suiteOf(value: JsonTestResults) {
  const suite = value.testResults[0];
  if (!suite) throw new Error("テスト用レポートのsuiteがありません");
  return suite;
}
function specOf(value: JsonTestResults) {
  const spec = suiteOf(value).assertionResults[0];
  if (!spec) throw new Error("テスト用レポートのspecがありません");
  return spec;
}

test("キャッシュ無効の代表は成功と準備完了の証拠を必要とする", () => {
  const value = report([]);
  const spec = specOf(value);
  const proof = {
    site: "x",
    cacheDisabledDuringInitialization: true,
    cacheRestored: true,
    state: "ready",
  };
  spec.meta.liveEvidence = [{ name: "initialization-cache", data: proof }];
  expect(() => assertInitializationCoverage(value, ["x"])).not.toThrow();
  expect(() => assertInitializationCoverage(value, ["x", "bluesky"])).toThrow(
    "bluesky",
  );
  proof.cacheDisabledDuringInitialization = false;
  expect(() => assertInitializationCoverage(value, ["x"])).toThrow("x");
  proof.cacheDisabledDuringInitialization = true;
  spec.status = "failed";
  expect(() => assertInitializationCoverage(value, ["x"])).toThrow("x");
});
test("ページの全項目で操作と除外効果を確認した結果を受け付ける", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter"]), [target]),
  ).not.toThrow();
});

test("ライトボックスの設定・集計・表示・復帰・直接アクセスの証跡を要求する", () => {
  const value = report([]);
  const spec = specOf(value);
  spec.title = "lightbox-x";
  const proof = {
    settingPreserved: true,
    contextPreserved: true,
    modalVisible: true,
    closedRestored: true,
    directUnsupported: true,
  };
  spec.meta.liveEvidence = [{ name: "lightbox-gate", data: proof }];
  const verify = () =>
    assertLiveCoverage(value, [], [], [], [], [{ id: "lightbox-x" }]);
  expect(verify).not.toThrow();
  for (const key of Object.keys(proof) as (keyof typeof proof)[]) {
    proof[key] = false;
    expect(verify).toThrow("ライトボックス");
    proof[key] = true;
  }
});

test("同じサイトの代表ページに効果確認があれば他ページは操作確認で受け付ける", () => {
  const combined = report(["minimum-filter"]);
  const second = specOf(report(["minimum-filter"], 0));
  second.title = "second";
  suiteOf(combined).assertionResults.push(second);
  expect(() =>
    assertLiveCoverage(combined, [target, { ...target, id: "second" }]),
  ).not.toThrow();
});

test("別サイトの効果確認で代用しない", () => {
  const combined = report(["minimum-filter"]);
  const other = specOf(
    report(
      [
        "minimum-filter",
        "media-filter",
        "reply-filter",
        "quote-filter",
        "repost-filter",
      ],
      0,
    ),
  );
  other.title = "bluesky";
  suiteOf(combined).assertionResults.push(other);
  expect(() =>
    assertLiveCoverage(combined, [
      target,
      { ...target, id: "bluesky", site: "bluesky" },
    ]),
  ).toThrow("bluesky: minimum-filter");
});

test("除外件数があっても解除確認の欠落を拒否する", () => {
  const value = report(["minimum-filter"]);
  const attachment = specOf(value).meta.liveEvidence?.[0];
  if (!attachment) throw new Error("テスト用の添付がありません");
  attachment.data = { hidden: 1, applied: true, noOverfilter: true };
  expect(() => assertLiveCoverage(value, [target])).toThrow(
    "操作・解除・誤除外",
  );
});
test("操作だけで除外対象がない結果は効果確認としない", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter"], 0), [target]),
  ).toThrow("未確認");
});
test("未実行ページや重複実行がある結果を拒否する", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter"]), [
      target,
      { ...target, id: "missing" },
    ]),
  ).toThrow("マトリクス");
});

test("同名の成功ケースで未実行ケースを代用しない", () => {
  const value = report(["minimum-filter"]);
  suiteOf(value).assertionResults.push(specOf(value));
  expect(() =>
    assertLiveCoverage(value, [target, { ...target, id: "missing" }]),
  ).toThrow("完全な成功結果");
});

test.each(["failed", "skipped", "pending", "todo"] as const)(
  "証跡があっても %s の結果は受け付けない",
  (status) => {
    const value = report(["minimum-filter"]);
    specOf(value).status = status;
    expect(() => assertLiveCoverage(value, [target])).toThrow("完全な成功結果");
  },
);

test("同じ証跡を重ねた結果は受け付けない", () => {
  const value = report(["minimum-filter", "minimum-filter"]);
  expect(() => assertLiveCoverage(value, [target])).toThrow("検証記録");
});

test.each([
  [
    "filtered",
    "navigation-closed-cleared",
    "returned-inactive",
    "reopened-conditions-restored",
  ],
  ["filtered", "returned-inactive", "reopened-conditions-restored"],
  [
    "filtered",
    "unsupported-cleared",
    "supported",
    "reopened-conditions-restored",
  ],
])("遷移記録の全段階を照合する: %j", (...stages) => {
  const value = report(["lifecycle"]);
  specOf(value).title = "transition";
  const attachment = specOf(value).meta.liveEvidence?.[0];
  if (!attachment) throw new Error("テスト用の添付がありません");
  attachment.data = { stages };
  const check = () => assertLiveCoverage(value, [], [{ id: "transition" }]);
  if (stages[1] === "navigation-closed-cleared") expect(check).not.toThrow();
  else expect(check).toThrow("確認が不足");
});

test.each([false, true])(
  "対象外でフィルターが有効な結果は拒否する: %s",
  (timelineAvailable) => {
    const value = report(["unsupported-state"]);
    specOf(value).title = "unsupported";
    const attachment = specOf(value).meta.liveEvidence?.[0];
    if (!attachment) throw new Error("テスト用の添付がありません");
    attachment.data = {
      state: "unsupported",
      timelineAvailable,
      controls: 0,
      hidden: 0,
    };
    const check = () =>
      assertLiveCoverage(value, [], [], [], [{ id: "unsupported" }]);
    if (!timelineAvailable) expect(check).not.toThrow();
    else expect(check).toThrow("確認が不足");
  },
);

test.each([true, false])(
  "サイトの空表示の確認を必須にする: %s",
  (siteEmpty) => {
    const value = report(["empty-state"]);
    specOf(value).title = "empty";
    const attachment = specOf(value).meta.liveEvidence?.[0];
    if (!attachment) throw new Error("テスト用の添付がありません");
    attachment.data = { state: "empty", siteEmpty, controls: 0, hidden: 0 };
    const check = () => assertLiveCoverage(value, [], [], [{ id: "empty" }]);
    if (siteEmpty) expect(check).not.toThrow();
    else expect(check).toThrow("確認が不足");
  },
);
