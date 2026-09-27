import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { artifactHash } from "./artifact.ts";
import { assertVerified, promoteCandidate } from "./verification.ts";

const temporary: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sift-verification-"));
  temporary.push(root);
  const output = path.join(root, ".output", "candidate", "chrome-mv3");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "background.js"), "new-build");
  const current = path.join(root, ".output", "chrome-mv3");
  fs.mkdirSync(current);
  fs.writeFileSync(path.join(current, "background.js"), "daily-build");
  const candidate = {
    buildId: "build-1",
    output,
    sha256: artifactHash(output),
    sourceHash: "source-1",
  };
  return {
    root,
    current,
    candidate,
    receipt: { ...candidate, status: "passed" },
  };
}
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("検証済み成果物の配備", () => {
  test.each(["running", "failed", "incomplete"])(
    "%sは配備できない",
    (status) => {
      const { candidate, receipt, current } = fixture();
      expect(() =>
        assertVerified(candidate, { ...receipt, status }, candidate.sourceHash),
      ).toThrow();
      expect(fs.readFileSync(path.join(current, "background.js"), "utf8")).toBe(
        "daily-build",
      );
    },
  );
  test("検証後のソース変更と別ビルドの結果を拒否する", () => {
    const { candidate, receipt } = fixture();
    expect(() =>
      assertVerified(candidate, receipt, "changed-source"),
    ).toThrow();
    expect(() =>
      assertVerified(
        candidate,
        { ...receipt, buildId: "other" },
        candidate.sourceHash,
      ),
    ).toThrow();
  });
  test("検証後の成果物への追記を拒否する", () => {
    const { candidate, receipt } = fixture();
    fs.writeFileSync(path.join(candidate.output, "extra.js"), "changed");
    expect(() =>
      assertVerified(candidate, receipt, candidate.sourceHash),
    ).toThrow("成果物");
  });
  test("同じバイト列を配備し、日常版の旧成果物を退避する", () => {
    const { candidate, receipt, root, current } = fixture();
    assertVerified(candidate, receipt, candidate.sourceHash);
    expect(promoteCandidate(root, candidate)).toBe(current);
    expect(artifactHash(current)).toBe(candidate.sha256);
    const backup = fs
      .readdirSync(path.join(root, ".output"))
      .find((name) => name.startsWith("promote-"));
    if (!backup) throw new Error("退避先がありません");
    expect(
      fs.readFileSync(
        path.join(root, ".output", backup, "previous", "background.js"),
        "utf8",
      ),
    ).toBe("daily-build");
  });
  test("候補以外のディレクトリは昇格しない", () => {
    const { candidate, root, current } = fixture();
    expect(() =>
      promoteCandidate(root, { ...candidate, output: current }),
    ).toThrow("場所");
  });
});
