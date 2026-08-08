import { describe, expect, it } from "vitest";
import { classifyPost, parseMetric } from "./filter-core.ts";

const settings = {
  minLikes: 500,
  risingEnabled: true,
  risingMinLikes: 100,
  risingMaxAgeHours: 6,
  hideReposts: true,
};

const now = Date.parse("2026-08-01T12:00:00Z");

describe("parseMetric", () => {
  it("reads the shapes a reaction count is written in", () => {
    expect(parseMetric("1,234")).toBe(1234);
    expect(parseMetric("1.2K")).toBe(1200);
    expect(parseMetric("1.2万 件のいいね")).toBe(12000);
    expect(parseMetric("３５０ 件のいいね")).toBe(350);
    expect(parseMetric("11788 件のいいね。いいねする")).toBe(11788);
  });

  it("answers 0 for nothing readable", () => {
    expect(parseMetric("")).toBe(0);
  });
});

describe("classifyPost", () => {
  it("keeps a post that reaches the minimum reaction count", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: 500,
          createdAtMs: now - 24 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hit", reason: "minimum-likes" });
  });

  it("keeps a young post that reaches the lower rising count", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: 120,
          createdAtMs: now - 2 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "rising", reason: "rising" });
  });

  it("hides the same post once it is past the rising window", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: 120,
          createdAtMs: now - 7 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "below-threshold" });
  });

  it("hides a post with no media whatever it scored", () => {
    expect(
      classifyPost(
        { hasMedia: false, likeCount: 1000, createdAtMs: now, isRepost: false },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "no-media" });
  });

  it("hides a repost while the setting is on", () => {
    expect(
      classifyPost(
        { hasMedia: true, likeCount: 1000, createdAtMs: now, isRepost: true },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "repost" });
  });
});
