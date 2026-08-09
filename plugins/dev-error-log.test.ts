import { describe, expect, it } from "vitest";
import { formatErrorLogLines } from "./dev-error-log.ts";

// 1行に JSON 1つという形が、このログファイルを `tail` や、1行ずつ受け取る他の
// ものから読めるようにしている。
describe("formatErrorLogLines", () => {
  it("1行に記録1つを書く", () => {
    expect(
      formatErrorLogLines([{ seq: 1, message: "first" }, { seq: 2 }]),
    ).toBe('{"seq":1,"message":"first"}\n{"seq":2}\n');
  });

  it("何も無ければ何も書かない", () => {
    expect(formatErrorLogLines(undefined)).toBe("");
  });
});
