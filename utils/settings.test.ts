import { describe, expect, it } from "vitest";
import {
  defaults,
  LIKE_THRESHOLDS,
  MISSKEY_REACTION_THRESHOLDS,
  normalizeSettings,
  thresholdsFor
} from "./settings.ts";

describe("normalizeSettings", () => {
  // Re-validated on every read, not just on write: storage can hold whatever an
  // older version of this extension put there.
  it("clamps a threshold into its own range", () => {
    expect(normalizeSettings({ misskeyMinReactions: "35" }).misskeyMinReactions).toBe(35);
    expect(normalizeSettings({ misskeyMinReactions: -4 }).misskeyMinReactions).toBe(0);
  });

  it("falls back to the default for a value that is not a number at all", () => {
    expect(
      normalizeSettings({ misskeyRisingMinReactions: "not a number" })
        .misskeyRisingMinReactions
    ).toBe(defaults.misskeyRisingMinReactions);
  });

  // The same normalization utils/instances.ts applies: invalid and duplicate
  // entries are dropped, and a missing or non-array value becomes an empty list
  // rather than throwing.
  it("drops the invalid and duplicate hosts out of the instance list", () => {
    expect(
      normalizeSettings({
        misskeyInstances: ["misskey.io", "misskey.io", "http://bad", "x.com"]
      }).misskeyInstances
    ).toEqual(["misskey.io", "x.com"]);
  });

  it("answers an empty instance list for anything unreadable", () => {
    expect(normalizeSettings({}).misskeyInstances).toEqual([]);
    expect(normalizeSettings({ misskeyInstances: "not-an-array" }).misskeyInstances).toEqual(
      []
    );
    expect(defaults.misskeyInstances).toEqual([]);
  });
});

// The classification takes one pair of numbers, and which pair depends on the
// service. Everything else it takes is shared by all of them.
describe("thresholdsFor", () => {
  const stored = normalizeSettings({
    minLikes: 500,
    risingMinLikes: 100,
    misskeyMinReactions: 20,
    misskeyRisingMinReactions: 5,
    risingMaxAgeHours: 6,
    hideReposts: true
  });

  it("fills the classification in from the like thresholds", () => {
    expect(thresholdsFor(stored, LIKE_THRESHOLDS)).toEqual({
      hideReposts: true,
      minLikes: 500,
      risingEnabled: true,
      risingMinLikes: 100,
      risingMaxAgeHours: 6
    });
  });

  it("fills it in from Misskey's own pair, leaving the rest shared", () => {
    expect(thresholdsFor(stored, MISSKEY_REACTION_THRESHOLDS)).toEqual({
      hideReposts: true,
      minLikes: 20,
      risingEnabled: true,
      risingMinLikes: 5,
      risingMaxAgeHours: 6
    });
  });
});
