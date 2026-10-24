import assert from "node:assert/strict";
import test from "node:test";
import {
  attribute,
  hasClass,
  parseHtmlElements,
  scriptText,
} from "./build-html.mjs";

test("空白や属性を含む閉じタグでもスクリプトを分離する", () => {
  const elements = parseHtmlElements(`<SCRIPT TYPE='module'>first()</script >
    <script type=module>second()</SCRIPT ignored='value'>
    <h1>見出し</h1>`);
  const scripts = elements.filter((element) => element.tagName === "script");
  assert.equal(scripts.length, 2);
  assert.deepEqual(scripts.map(scriptText), ["first()", "second()"]);
  assert.ok(scripts.every((script) => attribute(script, "type") === "module"));
  assert.equal(
    elements.filter((element) => element.tagName === "h1").length,
    1,
  );
});

test("引用符・大小文字・文字参照をHTMLの属性として読む", () => {
  const elements = parseHtmlElements(
    `<script TYPE=module SRC='&#47;sift/_astro/main.js' data-note='a > b'></script>`,
  );
  const script = elements.find((element) => element.tagName === "script");
  assert.equal(attribute(script, "type"), "module");
  assert.equal(attribute(script, "src"), "/sift/_astro/main.js");
  assert.equal(attribute(script, "data-note"), "a > b");
});

test("コメント・文字列・template内のタグを実行対象として数えない", () => {
  const elements =
    parseHtmlElements(`<!-- <script type="module">fake()</script> -->
    <p>&lt;h1&gt;見出しではない&lt;/h1&gt;</p>
    <script type="module">const text = '<h1>文字列</h1>';</script>
    <template><script type="module">inert()</script></template>`);
  assert.equal(
    elements.filter((element) => element.tagName === "script").length,
    1,
  );
  assert.equal(
    elements.filter((element) => element.tagName === "h1").length,
    0,
  );
});

test("実際の属性を読み、似た名前の属性やスクリプト内の記述を区別する", () => {
  const elements =
    parseHtmlElements(`<a id='section' class='extra\tproduct-github' href='#section'>移動</a>
    <script data-type='module'>const attributes = 'type="module" data-step="0"';</script>`);
  const link = elements.find((element) => element.tagName === "a");
  const script = elements.find((element) => element.tagName === "script");
  assert.equal(attribute(link, "id"), "section");
  assert.equal(attribute(link, "href"), "#section");
  assert.equal(hasClass(link, "product-github"), true);
  assert.equal(attribute(script, "type"), undefined);
  assert.equal(attribute(script, "data-step"), undefined);
});
