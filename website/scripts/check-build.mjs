import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoPosts } from "../src/data/demo-posts.ts";
import {
  attribute,
  hasClass,
  parseHtmlElements,
  scriptText,
} from "./build-html.mjs";

const dist = new URL("../dist/", import.meta.url);
const home = readFileSync(new URL("index.html", dist), "utf8");
const alternative = readFileSync(
  new URL("alternative/index.html", dist),
  "utf8",
);
const pages = [home, alternative].map((html) => ({
  html,
  elements: parseHtmlElements(html),
}));

// 公開用HTMLの静的な素材パスとリンクを検査する。
for (const { elements } of pages) {
  assert.ok(
    !elements.some((element) => element.tagName === "astro-island"),
    "不要なフレームワークが残っています",
  );
  for (const element of elements.filter((node) =>
    ["img", "link", "script"].includes(node.tagName),
  )) {
    for (const name of ["src", "href"]) {
      const value = attribute(element, name);
      if (value === undefined) continue;
      if (/^(?:https?:|data:)/.test(value)) continue;
      assert.ok(value.startsWith("/sift/"), `公開パスが不正です: ${value}`);
      assert.ok(
        existsSync(fileURLToPath(new URL(value.slice(6), dist))),
        `素材がありません: ${value}`,
      );
    }
  }
  for (const element of elements.filter((node) => node.tagName === "a")) {
    const href = attribute(element, "href");
    if (href === undefined) continue;
    if (href.startsWith("#")) {
      assert.ok(
        elements.some((node) => attribute(node, "id") === href.slice(1)),
        `区間がありません: ${href}`,
      );
    } else if (href.startsWith("/sift/")) {
      const route = href.endsWith("/") ? `${href}index.html` : href;
      assert.ok(
        existsSync(fileURLToPath(new URL(route.slice(6), dist))),
        `ページがありません: ${href}`,
      );
    }
  }
  assert.ok(
    elements.some(
      (element) =>
        element.tagName === "meta" &&
        attribute(element, "name") === "theme-color" &&
        attribute(element, "content") === "#ffffff",
    ),
  );
  assert.equal(
    elements.filter((element) => element.tagName === "h1").length,
    1,
  );
}
assert.ok(
  pages[0].elements.some((element) => hasClass(element, "product-github")),
);
assert.ok(existsSync(new URL("demo/", dist)), "デモ画像がありません");
assert.ok(demoPosts.length > 0, "投稿データがありません");
assert.equal(demoPosts.filter((post) => post.likes >= 100).length, 2);
for (const { html, elements } of pages) {
  assert.ok(
    !elements.some((element) =>
      attribute(element, "src")?.startsWith("/sift/screenshots/"),
    ),
    "置き換え前の画面画像が残っています",
  );
  assert.ok(
    elements.some(
      (element) => attribute(element, "data-replay-demo") !== undefined,
    ),
    "操作デモの初期画面がありません",
  );
  assert.equal(
    elements.filter((element) =>
      /^[0-3]$/.test(attribute(element, "data-step") ?? ""),
    ).length,
    4,
    "各デモの再生位置は4区間にしてください",
  );
  assert.equal(
    elements.filter((element) => hasClass(element, "replay-post")).length,
    demoPosts.length,
    "投稿が静的HTMLに出力されていません",
  );
  assert.ok(
    !elements.some(
      (element) => attribute(element, "data-pause") !== undefined,
    ) && !html.includes("一時停止"),
    "不要な一時停止の操作が残っています",
  );
  for (const post of demoPosts) {
    assert.ok(
      elements.some(
        (element) => attribute(element, "data-likes") === String(post.likes),
      ),
      `投稿の反応数がありません: ${post.handle}`,
    );
  }
  const scripts = elements.filter((element) => element.tagName === "script");
  assert.ok(scripts.length > 0, "操作デモのスクリプトが登録されていません");
  let replayRegistered = false;
  for (const script of scripts) {
    assert.equal(
      attribute(script, "type"),
      "module",
      "デモのスクリプトはESモジュールで登録してください",
    );
    const source = attribute(script, "src");
    let body = scriptText(script);
    if (source) {
      assert.ok(
        source.startsWith("/sift/_astro/"),
        `スクリプトの公開パスが不正です: ${source}`,
      );
      body = readFileSync(new URL(source.slice(6), dist), "utf8");
    }
    assert.ok(body.trim().length > 0, "空のスクリプトが登録されています");
    replayRegistered ||=
      body.includes("[data-replay-demo]") &&
      body.includes("querySelectorAll") &&
      body.includes("forEach");
  }
  assert.ok(replayRegistered, "操作デモを初期化する処理がありません");
}
console.log(
  "公開用HTMLの画像・リンクと、操作デモのスクリプト登録を確認しました。",
);
