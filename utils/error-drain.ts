import { storage } from "wxt/utils/storage";
import {
  collectUndrainedEntries,
  type ErrorLogEntry,
  errorLogItem,
} from "./error-log.ts";

const ERROR_LOG_DRAINED_SEQ_KEY = "siftErrorLogDrainedSeq";

// How far the buffer has already been forwarded. Session rather than local: it
// survives the worker being torn down and restarted, and is gone by the time a
// new browser session starts over — which is when forwarding everything again
// is the right answer.
//
// No fallback, so an unset mark reads as null and collectUndrainedEntries()
// takes the whole buffer.
const drainedSeqItem = storage.defineItem<number>(
  `session:${ERROR_LOG_DRAINED_SEQ_KEY}`,
);

export interface DrainErrorLogDeps {
  post: (entries: ErrorLogEntry[]) => void | Promise<void>;
}

// Carries the error ring buffer out of local storage and into a file the
// development server owns, which is the only form of it a diagnosis running
// outside Chrome can read.
//
// A failed post leaves the mark untouched on purpose — the entries stay in the
// buffer and go out on the next attempt.
export async function drainErrorLog({
  post,
}: DrainErrorLogDeps): Promise<{ forwarded: number }> {
  const [stored, drained] = await Promise.all([
    errorLogItem.getValue(),
    drainedSeqItem.getValue(),
  ]);

  const pending = collectUndrainedEntries(stored, drained);
  const lastPending = pending.at(-1);
  if (lastPending === undefined) {
    return { forwarded: 0 };
  }

  await post(pending);
  await drainedSeqItem.setValue(lastPending.seq);

  return { forwarded: pending.length };
}
