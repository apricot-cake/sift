import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const legacyManifest = JSON.parse(await readFile("manifest.legacy.json", "utf8"));
const generatedManifest = JSON.parse(
  await readFile("dist/manifest.json", "utf8")
);

assert.equal(generatedManifest.manifest_version, legacyManifest.manifest_version);
assert.equal(generatedManifest.name, legacyManifest.name);
assert.equal(generatedManifest.version, legacyManifest.version);
assert.equal(generatedManifest.description, legacyManifest.description);
assert.deepEqual(generatedManifest.permissions, legacyManifest.permissions);
assert.deepEqual(generatedManifest.action, legacyManifest.action);

assert.equal(generatedManifest.content_scripts.length, 1);
const [generatedContentScript] = generatedManifest.content_scripts;
const [legacyContentScript] = legacyManifest.content_scripts;
assert.deepEqual(
  [...generatedContentScript.matches].sort(),
  [...legacyContentScript.matches].sort()
);
assert.equal(generatedContentScript.run_at, legacyContentScript.run_at);
assert.equal(generatedContentScript.css.length, legacyContentScript.css.length);
assert.equal(generatedContentScript.js.length, 1);

console.log("generated manifest matches the legacy runtime configuration");
