import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attribute, hasClass, parseHtmlElements } from "./build-html.mjs";

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
for (const { elements } of pages) {
  const recording = elements.find(
    (element) => attribute(element, "data-recording-link") !== undefined,
  );
  assert.ok(recording, "操作録画へのリンクがありません");
  assert.match(
    attribute(recording, "href") ?? "",
    /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+$/i,
    "操作録画にはGitHubの添付ファイルURLを指定してください",
  );
}
console.log("公開用HTMLの素材・リンクと、操作録画への導線を確認しました。");
