import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoPosts, demoVideos } from "../src/data/demo-posts.ts";

const dist = new URL("../dist/", import.meta.url);
const home = readFileSync(new URL("index.html", dist), "utf8");
const alternative = readFileSync(
  new URL("alternative/index.html", dist),
  "utf8",
);

// 公開用HTMLの静的な素材パスとリンクを検査する。
for (const html of [home, alternative]) {
  assert.doesNotMatch(
    html,
    /<astro-island\b/i,
    "不要なフレームワークが残っています",
  );
  for (const [tag] of html.matchAll(/<(?:img|link|script)\b[^>]*>/gi)) {
    for (const [, value] of tag.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:https?:|data:)/.test(value)) continue;
      assert.ok(value.startsWith("/sift/"), `公開パスが不正です: ${value}`);
      assert.ok(
        existsSync(fileURLToPath(new URL(value.slice(6), dist))),
        `素材がありません: ${value}`,
      );
    }
  }
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    if (href.startsWith("#")) {
      assert.ok(
        html.includes(`id="${href.slice(1)}"`),
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
  assert.match(html, /name="theme-color" content="#ffffff"/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
}
assert.match(home, /class="product-github"/);
assert.match(home, /youtube-nocookie\.com\/embed\/KqO-4fv2Qsw/);
assert.match(alternative, /youtube-nocookie\.com\/embed\/KqO-4fv2Qsw/);
assert.ok(existsSync(new URL("demo/", dist)), "デモ画像がありません");
assert.equal(demoPosts.length, 5, "投稿データは5件にしてください");
assert.equal(demoVideos.length, 6, "動画データは6件にしてください");
assert.equal(demoPosts.filter((post) => post.likes >= 100).length, 2);
assert.equal(demoVideos.filter((video) => video.publishedDays <= 90).length, 3);
assert.ok(
  demoVideos.every(
    (video, index) => index === 0 || demoVideos[index - 1].views >= video.views,
  ),
  "動画が人気順になっていません",
);
for (const html of [home, alternative]) {
  assert.doesNotMatch(
    html,
    /src="\/sift\/screenshots\//,
    "置き換え前の画面画像が残っています",
  );
  assert.match(
    html,
    /投稿内容・数値はデモ用です/,
    "デモ用データの注記がありません",
  );
  assert.match(html, /data-replay-demo/, "操作デモの初期画面がありません");
  assert.equal(
    [...html.matchAll(/data-step="[0-3]"/g)].length,
    8,
    "各デモの再生位置は4区間にしてください",
  );
  assert.match(html, /data-mode="social"/);
  assert.match(html, /data-mode="youtube"/);
  assert.equal(
    [...html.matchAll(/class="replay-post"/g)].length,
    5,
    "投稿が静的HTMLに出力されていません",
  );
  assert.equal(
    [...html.matchAll(/class="replay-video"/g)].length,
    6,
    "動画が静的HTMLに出力されていません",
  );
  assert.doesNotMatch(
    html,
    /(?:data-pause|一時停止)/,
    "不要な一時停止の操作が残っています",
  );
  for (const post of demoPosts) {
    assert.ok(
      html.includes(`data-likes="${post.likes}"`),
      `投稿の反応数がありません: ${post.handle}`,
    );
  }
  for (const video of demoVideos) {
    assert.ok(
      html.includes(`data-days="${video.publishedDays}"`),
      `動画の公開時期がありません: ${video.id}`,
    );
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "操作デモのスクリプトが登録されていません");
  let replayRegistered = false;
  for (const [, attributes, inlineBody] of scripts) {
    assert.match(
      attributes,
      /type="module"/,
      "デモのスクリプトはESモジュールで登録してください",
    );
    const source = /\bsrc="([^"]+)"/.exec(attributes)?.[1];
    let body = inlineBody;
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
