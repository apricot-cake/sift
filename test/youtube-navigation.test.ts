import { describe, expect, it } from "vitest";
import {
  youtubeChannelSearchInputSelector,
  youtubeSearchQuery,
  youtubeSearchRoute,
} from "../e2e/youtube-navigation.ts";

describe("YouTube の検索結果を共用する範囲", () => {
  it("検索語と追跡引数が変わっても同じチャンネル内検索として扱う", () => {
    expect(
      youtubeSearchRoute(
        "https://www.youtube.com/@example/search?query=first&feature=channel",
      ),
    ).toBe(
      youtubeSearchRoute(
        "https://www.youtube.com/@example/search?query=second",
      ),
    );
  });

  it("別チャンネルの検索結果は共用しない", () => {
    expect(
      youtubeSearchRoute("https://www.youtube.com/@first/search?query=same"),
    ).not.toBe(
      youtubeSearchRoute("https://www.youtube.com/@second/search?query=same"),
    );
  });

  it.each([
    "https://www.youtube.com/results?search_query=example",
    "https://www.youtube.com/@example/videos?query=example",
    "https://example.com/@example/search?query=example",
  ])("チャンネル内検索以外を拒否する: %s", (url) => {
    expect(() => youtubeSearchRoute(url)).toThrow();
  });

  it.each([
    "https://www.youtube.com/@example/search",
    "https://www.youtube.com/@example/search?query=",
  ])("現在の未入力検索画面は共用できるが検索先にはできない: %s", (url) => {
    expect(youtubeSearchRoute(url)).toBe(
      "https://www.youtube.com/@example/search",
    );
    expect(() => youtubeSearchQuery(url)).toThrow("検索語が必要");
  });

  it("検索先の日本語と記号を保持する", () => {
    expect(
      youtubeSearchQuery(
        "https://www.youtube.com/@example/search?query=%E7%8C%AB%20%26%20dog",
      ),
    ).toBe("猫 & dog");
  });

  it("実構造のチャンネル検索欄だけを選び、グローバル検索と旧画面を除く", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <yt-searchbox><input name="search_query"></yt-searchbox>
      <ytd-browse hidden><input name="query" value="old"></ytd-browse>
      <ytd-browse>
        <input name="unrelated">
        <tp-yt-iron-input><input type="text" name="query" value="WARDOGS"></tp-yt-iron-input>
      </ytd-browse>`;
    const inputs = root.querySelectorAll<HTMLInputElement>(
      youtubeChannelSearchInputSelector,
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.value).toBe("WARDOGS");
  });
});
