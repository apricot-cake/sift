import { afterAll, beforeAll, test } from "vitest";
import { groupByEntry } from "./cases.ts";
import { createCompatibilityCases } from "./compatibility.cases.ts";
import { createEmptyCases } from "./empty.cases.ts";
import { createLifecycleCases } from "./lifecycle.cases.ts";
import { createLightboxCases } from "./lightbox.cases.ts";
import { connectLive, finishLive, type LiveSession } from "./live.ts";
import { createUnsupportedCases } from "./unsupported.cases.ts";

let session: LiveSession;
beforeAll(async () => {
  session = await connectLive();
});
afterAll(async () => {
  if (session) await finishLive(session);
});

// ファイルをまたいでも同じ入口を連続させ、各caseの判定・証拠は個別に残す。
const entries = groupByEntry(
  [
    ...createCompatibilityCases(),
    ...createLifecycleCases(),
    ...createUnsupportedCases(),
    ...createEmptyCases(),
    ...createLightboxCases(),
  ],
  (entry) => entry.entry,
);
for (const entry of entries) {
  test(entry.id, async ({ task }) => {
    session.loadGuard.setContext(entry.id, "prepare");
    try {
      await entry.run(session, task);
    } finally {
      session.loadGuard.setContext(entry.id, "finished");
    }
  });
}
