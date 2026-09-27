import type { JSONReport } from "@playwright/test/reporter";
import { expect, test } from "vitest";
import type { CompatibilityCase } from "../../e2e/cases.ts";
import { assertLiveCoverage } from "./live-coverage.ts";

const target: CompatibilityCase = {
  id: "niconico-videos",
  site: "niconico",
  start: "https://www.nicovideo.jp/user/1",
  destination: "/user/1/video",
  period: false,
};
function report(names: string[], count = 1): JSONReport {
  return {
    suites: [
      {
        specs: [
          {
            title: target.id,
            tests: [
              {
                results: [
                  {
                    status: "passed",
                    errors: [],
                    attachments: names.map((name) => ({
                      name,
                      body: Buffer.from(
                        JSON.stringify({
                          hidden: count,
                          applied: true,
                          cleared: true,
                          noOverfilter: true,
                        }),
                      ).toString("base64"),
                      contentType: "application/json",
                    })),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as JSONReport;
}

function suiteOf(value: JSONReport) {
  const suite = value.suites[0];
  if (!suite) throw new Error("テスト用レポートのsuiteがありません");
  return suite;
}
function specOf(value: JSONReport) {
  const spec = suiteOf(value).specs[0];
  if (!spec) throw new Error("テスト用レポートのspecがありません");
  return spec;
}
test("ページの全項目で操作と除外効果を確認した結果を受け付ける", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter", "newer-filter"]), [target]),
  ).not.toThrow();
});

test("同じサイトの代表ページに効果確認があれば他ページは操作確認で受け付ける", () => {
  const combined = report(["minimum-filter", "newer-filter"]);
  const second = specOf(report(["minimum-filter", "newer-filter"], 0));
  second.title = "second";
  suiteOf(combined).specs.push(second);
  expect(() =>
    assertLiveCoverage(combined, [target, { ...target, id: "second" }]),
  ).not.toThrow();
});

test("別サイトの効果確認で代用しない", () => {
  const combined = report(["minimum-filter", "newer-filter"]);
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
  other.title = "x";
  suiteOf(combined).specs.push(other);
  expect(() =>
    assertLiveCoverage(combined, [target, { ...target, id: "x", site: "x" }]),
  ).toThrow("x: minimum-filter");
});

test("除外件数があっても解除確認の欠落を拒否する", () => {
  const value = report(["minimum-filter", "newer-filter"]);
  const attachment = specOf(value).tests[0]?.results[0]?.attachments[0];
  if (!attachment) throw new Error("テスト用の添付がありません");
  attachment.body = Buffer.from(
    JSON.stringify({ hidden: 1, applied: true, noOverfilter: true }),
  ).toString("base64");
  expect(() => assertLiveCoverage(value, [target])).toThrow(
    "操作・解除・誤除外",
  );
});
test("最低値だけ成功しても新しい動画の除外が未検証なら失敗する", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter"]), [target]),
  ).toThrow("newer-filter");
});
test("操作だけで除外対象がない結果は効果確認としない", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter", "newer-filter"], 0), [target]),
  ).toThrow("未確認");
});
test("未実行ページや重複実行がある結果を拒否する", () => {
  expect(() =>
    assertLiveCoverage(report(["minimum-filter", "newer-filter"]), [
      target,
      { ...target, id: "missing" },
    ]),
  ).toThrow("マトリクス");
});

test.each([
  ["filtered", "unsupported-cleared", "supported", "reopened-reset"],
  ["filtered", "supported", "reopened-reset"],
])("遷移記録の全段階を照合する: %j", (...stages) => {
  const value = report(["lifecycle"]);
  specOf(value).title = "transition";
  const attachment = specOf(value).tests[0]?.results[0]?.attachments[0];
  if (!attachment) throw new Error("テスト用の添付がありません");
  attachment.body = Buffer.from(JSON.stringify({ stages })).toString("base64");
  const check = () => assertLiveCoverage(value, [], [{ id: "transition" }]);
  if (stages.length === 4) expect(check).not.toThrow();
  else expect(check).toThrow("確認が不足");
});

test.each([false, true])(
  "対象外でフィルターが有効な結果は拒否する: %s",
  (timelineAvailable) => {
    const value = report(["unsupported-state"]);
    specOf(value).title = "unsupported";
    const attachment = specOf(value).tests[0]?.results[0]?.attachments[0];
    if (!attachment) throw new Error("テスト用の添付がありません");
    attachment.body = Buffer.from(
      JSON.stringify({
        state: "unsupported",
        timelineAvailable,
        controls: 0,
        hidden: 0,
      }),
    ).toString("base64");
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
    const attachment = specOf(value).tests[0]?.results[0]?.attachments[0];
    if (!attachment) throw new Error("テスト用の添付がありません");
    attachment.body = Buffer.from(
      JSON.stringify({ state: "empty", siteEmpty, controls: 0, hidden: 0 }),
    ).toString("base64");
    const check = () => assertLiveCoverage(value, [], [], [{ id: "empty" }]);
    if (siteEmpty) expect(check).not.toThrow();
    else expect(check).toThrow("確認が不足");
  },
);
