import { describe, expect, it } from "vitest";
import { formatErrorLogLines } from "./dev-error-log.ts";

// One JSON object per line is what makes the log file readable by `tail` and by
// anything else that takes a line at a time.
describe("formatErrorLogLines", () => {
  it("writes one entry per line", () => {
    expect(formatErrorLogLines([{ seq: 1, message: "first" }, { seq: 2 }])).toBe(
      '{"seq":1,"message":"first"}\n{"seq":2}\n'
    );
  });

  it("writes nothing for nothing", () => {
    expect(formatErrorLogLines(undefined)).toBe("");
  });
});
