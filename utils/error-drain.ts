import {
  collectUndrainedEntries,
  ERROR_LOG_KEY,
  type ErrorLogEntry,
  type ErrorLogStorage
} from "./error-log.ts";

export const ERROR_LOG_DRAINED_SEQ_KEY = "siftErrorLogDrainedSeq";

export interface DrainErrorLogDeps {
  storage: {
    local: ErrorLogStorage;
    session: ErrorLogStorage;
  };
  post: (entries: ErrorLogEntry[]) => void | Promise<void>;
}

// Carries the error ring buffer out of browser.storage.local and into a file the
// development server owns, which is the only form of it a diagnosis running
// outside Chrome can read. The mark of what has already been forwarded lives in
// session storage: it survives the worker being torn down and restarted, and is
// gone by the time a new browser session starts over.
//
// A failed post leaves the mark untouched on purpose — the entries stay in the
// buffer and go out on the next attempt.
export async function drainErrorLog({
  storage,
  post
}: DrainErrorLogDeps): Promise<{ forwarded: number }> {
  const [stored, drained] = await Promise.all([
    storage.local.get(ERROR_LOG_KEY),
    storage.session.get(ERROR_LOG_DRAINED_SEQ_KEY)
  ]);

  const pending = collectUndrainedEntries(
    stored?.[ERROR_LOG_KEY],
    drained?.[ERROR_LOG_DRAINED_SEQ_KEY]
  );
  const lastPending = pending.at(-1);
  if (lastPending === undefined) {
    return { forwarded: 0 };
  }

  await post(pending);
  await storage.session.set({
    [ERROR_LOG_DRAINED_SEQ_KEY]: lastPending.seq
  });

  return { forwarded: pending.length };
}
