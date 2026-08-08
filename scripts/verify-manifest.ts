// Checks that the release build carries what the sources declare — and holds no
// declaration of its own. Every expected value below is read from the one place
// that owns it: wxt.config.ts for the manifest WXT is given, utils/site-matches.ts
// for the sites, package.json for the version. There is nothing here to keep in
// sync by hand.
//
// This replaces a comparison against manifest.legacy.json, the hand-written
// manifest the extension carried before WXT generated one (through CRXJS, then
// back to WXT). That file was a second copy of the same decisions: every change
// to wxt.config.ts had to be repeated in it before the check would pass, so it
// never caught a change — it only recorded one twice, and left the version
// number in two places.
//
// What is worth checking is the step the sources cannot show: `wxt build` exits
// 0 whether or not the content script reached the manifest, and an extension
// whose content script is missing loads, runs its worker, and does nothing
// visible at all.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SITE_MATCHES } from "../utils/site-matches.ts";
import config from "../wxt.config.ts";

// Which build to read. `wxt build -b <target>` writes to
// .output/<target>-mv3-release, and everything below holds for both targets —
// the manifest is one declaration in wxt.config.ts, and the point of checking
// the second target is that it stays that way.
const TARGETS = new Set(["chrome", "firefox"]);
const target = process.argv[2] ?? "chrome";
if (!TARGETS.has(target)) {
  throw new Error(
    `unknown build target: ${target} (expected one of ${[...TARGETS].join(", ")})`,
  );
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const generatedManifest = JSON.parse(
  await readFile(`.output/${target}-mv3-release/manifest.json`, "utf8"),
);

// WXT accepts a function or a promise here as well as an object. This project
// declares a plain object, and reading one of the other two as if it were an
// object would compare against `undefined` and pass every assertion below.
const declaredManifest = config.manifest;
if (
  typeof declaredManifest !== "object" ||
  declaredManifest === null ||
  declaredManifest instanceof Promise
) {
  throw new Error(
    "wxt.config.ts no longer declares its manifest as a plain object — this check reads it as one",
  );
}

assert.equal(generatedManifest.manifest_version, config.manifestVersion);
assert.equal(generatedManifest.name, declaredManifest.name);
assert.equal(generatedManifest.description, declaredManifest.description);
// The fixed signing key, and with it the extension id every profile has already
// installed. A build that lost it would install as a different extension.
assert.equal(generatedManifest.key, declaredManifest.key);
assert.deepEqual(generatedManifest.permissions, declaredManifest.permissions);
assert.deepEqual(
  generatedManifest.optional_host_permissions,
  declaredManifest.optional_host_permissions,
);

// The version lives in package.json alone; WXT copies it here.
assert.equal(generatedManifest.version, packageJson.version);

// The description is a message name rather than a sentence, and the browser's
// manifest parser is what resolves it — silently, leaving the extension with no
// description at all if the name is wrong or the file never made it into the
// build. Nothing else would say so: `wxt build` neither reads the name nor
// checks that public/_locales was copied.
assert.equal(generatedManifest.default_locale, declaredManifest.default_locale);
const defaultMessages = JSON.parse(
  await readFile(
    `.output/${target}-mv3-release/_locales/${generatedManifest.default_locale}/messages.json`,
    "utf8",
  ),
);
const descriptionKey = generatedManifest.description.replace(
  /^__MSG_(.+)__$/,
  "$1",
);
assert.notEqual(
  descriptionKey,
  generatedManifest.description,
  "the manifest's description is a literal — it should name a message",
);
assert.ok(
  descriptionKey in defaultMessages,
  `the manifest's description names ${descriptionKey}, which the ${generatedManifest.default_locale} messages file does not have`,
);

// `action` is the one entry both sides write to: the title comes from
// wxt.config.ts, the popup from the entrypoint existing at all.
assert.equal(
  generatedManifest.action.default_title,
  declaredManifest.action?.default_title,
);
assert.equal(generatedManifest.action.default_popup, "popup.html");

// The settings page, and the one thing about it that is a decision rather than
// a consequence: `open_in_tab`. Embedded in chrome://extensions instead, it
// would be a surface Chrome can tear down when the host-permission dialog
// appears, which is the failure adding a Misskey instance used to hit (#28).
// wxt.config.ts does not declare any of this — it comes from the meta tags in
// entrypoints/options/index.html, which nothing else reads back.
assert.equal(generatedManifest.options_ui.page, "options.html");
assert.equal(generatedManifest.options_ui.open_in_tab, true);

// The one entry the two targets genuinely differ on: Chrome MV3 takes a service
// worker, Firefox MV3 takes a list of scripts. Both are built from the same
// entrypoints/background.ts, so this is what says WXT shaped the output for the
// target it was asked for rather than emitting the Chrome one twice.
if (target === "firefox") {
  assert.deepEqual(generatedManifest.background.scripts, ["background.js"]);
} else {
  assert.equal(generatedManifest.background.service_worker, "background.js");
}

// The content script, which no declaration in wxt.config.ts produces — it is
// here only because entrypoints/content/index.ts was built into it.
assert.equal(generatedManifest.content_scripts.length, 1);
const [generatedContentScript] = generatedManifest.content_scripts;
assert.deepEqual(
  [...generatedContentScript.matches].sort(),
  [...SITE_MATCHES].sort(),
);
// One bundle and one stylesheet: the script's imports and its `import
// "./style.css"` both came through.
assert.equal(generatedContentScript.js.length, 1);
assert.equal(generatedContentScript.css.length, 1);

console.log(
  `the generated ${target} manifest carries what the sources declare`,
);
