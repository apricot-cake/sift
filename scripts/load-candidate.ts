import { loadDevCandidate } from "./dev-browser-candidate.ts";
import { withDevBrowser } from "./managed-dev-browser.ts";

await withDevBrowser(async (browser) => {
  const { worker, ...candidate } = await loadDevCandidate(browser);
  try {
    console.log(JSON.stringify(candidate, null, 2));
  } finally {
    await worker.dispose();
  }
});
