import { chromium } from "@playwright/test";
import { loadDevCandidate } from "./dev-browser-candidate.ts";
import { readManagedDevBrowserEndpoint } from "./managed-dev-browser.ts";

const endpoint = await readManagedDevBrowserEndpoint();
const browser = await chromium.connectOverCDP(endpoint.url);
try {
  console.log(JSON.stringify(await loadDevCandidate(browser), null, 2));
} finally {
  await browser.close();
}
