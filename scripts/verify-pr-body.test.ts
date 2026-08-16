import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/verify-pr-body.ts");

function verify(body: string) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, PR_BODY: body },
  });
}

describe("PR 本文の検査", () => {
  it("実際の改行を許可する", () => {
    expect(verify("1段落目\n\n2段落目").status).toBe(0);
  });

  it("文字列としての改行を拒否する", () => {
    const result = verify("1段落目\\n\\n2段落目");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("実際の改行");
  });
});
