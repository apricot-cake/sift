import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { artifactHash } from "./compatibility/artifact.ts";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";

const root = path.resolve(import.meta.dirname, "..");
const candidate = JSON.parse(
  fs.readFileSync(path.join(root, ".output", "candidate.json"), "utf8"),
);
const expected = path.join(root, ".output", "candidate", "chrome-mv3");
if (
  candidate.output !== expected ||
  artifactHash(expected) !== candidate.sha256
)
  throw new Error("検証用成果物が作成時と一致しません");
const endpoint = await readDevBrowserEndpoint(
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile"),
  9224,
);
if (!endpoint) throw new Error("開発用Chromeが未起動です");
const browser = await chromium.connectOverCDP(endpoint.url);
const client = await browser.newBrowserCDPSession();
try {
  const result = await client.send("Extensions.loadUnpacked", {
    path: expected,
  });
  console.log(JSON.stringify({ ...candidate, loaded: result }, null, 2));
} finally {
  await client.detach();
  await browser.close();
}
