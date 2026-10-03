import fs from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { artifactHash } from "./compatibility/artifact.ts";

export async function loadDevCandidate(browser: Browser) {
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
  const client = await browser.newBrowserCDPSession();
  try {
    const loaded = await client.send("Extensions.loadUnpacked", {
      path: expected,
    });
    return { ...candidate, loaded };
  } finally {
    await client.detach();
  }
}
