import { expect, it } from "vitest";
import { isOwnedPanelEvent, isOwnedPanelUrl } from "./panel-target.ts";

it("同じパネルでも別タブと別拡張機能のターゲットを区別する", () => {
  const url = "chrome-extension://sift/sidepanel.html?tabId=12";
  expect(isOwnedPanelUrl(url, "sift", 12)).toBe(true);
  expect(isOwnedPanelUrl(url, "sift", 13)).toBe(false);
  expect(isOwnedPanelUrl(url, "other", 12)).toBe(false);
});

it("パネルイベントはqueryの有無に依存せず通知のtabIdで所有を判定する", () => {
  for (const path of ["/sidepanel.html", "sidepanel.html?tabId=12"]) {
    expect(isOwnedPanelEvent({ path, tabId: 12 }, "sift", 12)).toBe(true);
    expect(isOwnedPanelEvent({ path, tabId: 13 }, "sift", 12)).toBe(false);
    expect(isOwnedPanelEvent({ path }, "sift", 12)).toBe(false);
  }
  expect(isOwnedPanelEvent({ path: "other.html", tabId: 12 }, "sift", 12)).toBe(
    false,
  );
});

it("所有タブがない既定パネルや曖昧なIDを受け入れない", () => {
  for (const query of ["", "?tabId=012", "?tabId=12&tabId=13", "?tabId=0"]) {
    expect(
      isOwnedPanelUrl(
        `chrome-extension://sift/sidepanel.html${query}`,
        "sift",
        12,
      ),
    ).toBe(false);
  }
  expect(isOwnedPanelUrl("invalid", "sift", 12)).toBe(false);
  expect(isOwnedPanelEvent({ path: "http://[", tabId: 12 }, "sift", 12)).toBe(
    false,
  );
  expect(
    isOwnedPanelUrl("https://sift/sidepanel.html?tabId=12", "sift", 12),
  ).toBe(false);
  expect(
    isOwnedPanelUrl(
      "chrome-extension://sift/sidepanel.html?tabId=0",
      "sift",
      0,
    ),
  ).toBe(false);
});
