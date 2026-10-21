import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { artifactHash } from "./artifact.ts";
import { promoteLocalBuild, sourceHash } from "./verification.ts";

const temporary: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sift-verification-"));
  temporary.push(root);
  const output = path.join(root, ".output", "local", "chrome-mv3");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "background.js"), "new-build");
  const current = path.join(root, ".output", "chrome-mv3");
  fs.mkdirSync(current);
  fs.writeFileSync(path.join(current, "background.js"), "daily-build");
  const build = {
    buildId: "build-1",
    output,
    sha256: artifactHash(output),
    sourceHash: "source-1",
  };
  return {
    root,
    current,
    build,
  };
}
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("日常版成果物と配備の整合性", () => {
  test("別ビルドのサイト編集は除き、拡張機能の実装・テスト・未追跡ファイルの変更は検出する", () => {
    const { root } = fixture();
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    fs.mkdirSync(path.join(root, "website"));
    fs.writeFileSync(path.join(root, "website", "page.html"), "website");
    fs.writeFileSync(path.join(root, "runtime.ts"), "runtime");
    fs.writeFileSync(path.join(root, "runtime.test.ts"), "test");
    execFileSync("git", ["add", "runtime.ts", "runtime.test.ts"], {
      cwd: root,
    });
    const initial = sourceHash(root);
    fs.writeFileSync(
      path.join(root, "website", "page.html"),
      "changed website",
    );
    fs.writeFileSync(path.join(root, "website", "new.ts"), "new website");
    expect(sourceHash(root)).toBe(initial);
    fs.writeFileSync(path.join(root, "runtime.ts"), "changed runtime");
    expect(sourceHash(root)).not.toBe(initial);
    fs.writeFileSync(path.join(root, "runtime.ts"), "runtime");
    fs.writeFileSync(path.join(root, "runtime.test.ts"), "changed test");
    expect(sourceHash(root)).not.toBe(initial);
    fs.writeFileSync(path.join(root, "runtime.test.ts"), "test");
    fs.writeFileSync(path.join(root, "new-runtime.ts"), "untracked runtime");
    expect(sourceHash(root)).not.toBe(initial);
  }, 15000);
  test("同じバイト列を配備し、日常版の旧成果物を退避する", () => {
    const { build, root, current } = fixture();
    const candidateOutput = path.join(
      root,
      ".output",
      "candidate",
      "chrome-mv3",
    );
    fs.mkdirSync(candidateOutput, { recursive: true });
    fs.writeFileSync(
      path.join(candidateOutput, "background.js"),
      "candidate-build",
    );
    const candidateHash = artifactHash(candidateOutput);
    const candidateRecord = path.join(root, ".output", "candidate.json");
    fs.writeFileSync(candidateRecord, "candidate-record");
    expect(promoteLocalBuild(root, build)).toBe(current);
    expect(artifactHash(current)).toBe(build.sha256);
    expect(artifactHash(candidateOutput)).toBe(candidateHash);
    expect(fs.readFileSync(candidateRecord, "utf8")).toBe("candidate-record");
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
  test("日常版以外のディレクトリは配備しない", () => {
    const { build, root, current } = fixture();
    expect(() =>
      promoteLocalBuild(root, { ...build, output: current }),
    ).toThrow("場所");
  });
});
