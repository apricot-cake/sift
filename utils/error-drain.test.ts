import { beforeEach, describe, expect, it } from "vitest";
import { createFakeStorageArea } from "../test/storage.ts";
import { drainErrorLog, ERROR_LOG_DRAINED_SEQ_KEY } from "./error-drain.ts";
import { ERROR_LOG_KEY, type ErrorLogEntry } from "./error-log.ts";

// The ring buffer lives in local storage and survives a restart; the mark saying
// how much of it has already gone out lives in session storage and does not.
let storage: { local: ReturnType<typeof createFakeStorageArea>; session: ReturnType<typeof createFakeStorageArea> };

beforeEach(() => {
  storage = {
    local: createFakeStorageArea({
      [ERROR_LOG_KEY]: [
        { source: "test", seq: 1, message: "first" },
        { source: "test", seq: 2, message: "second" }
      ]
    }),
    session: createFakeStorageArea()
  };
});

describe("drainErrorLog", () => {
  it("forwards the buffer and marks how far it got", async () => {
    const posted: ErrorLogEntry[][] = [];

    const result = await drainErrorLog({
      storage,
      post: (entries) => {
        posted.push(entries);
      }
    });

    expect(result).toEqual({ forwarded: 2 });
    expect(posted).toEqual([
      [
        { source: "test", seq: 1, message: "first" },
        { source: "test", seq: 2, message: "second" }
      ]
    ]);
    expect(storage.session.state[ERROR_LOG_DRAINED_SEQ_KEY]).toBe(2);
  });

  it("forwards nothing the second time round", async () => {
    let posts = 0;

    await drainErrorLog({ storage, post: () => {} });
    const result = await drainErrorLog({
      storage,
      post: () => {
        posts += 1;
      }
    });

    expect(result).toEqual({ forwarded: 0 });
    expect(posts).toBe(0);
  });

  // A post that fails leaves the mark alone so the entries go out next time.
  it("keeps the mark where it was when the post fails", async () => {
    await drainErrorLog({ storage, post: () => {} });
    storage.local.state[ERROR_LOG_KEY] = [
      { source: "test", seq: 1, message: "first" },
      { source: "test", seq: 2, message: "second" },
      { source: "test", seq: 3, message: "third" }
    ];

    await expect(
      drainErrorLog({
        storage,
        post: () => {
          throw new Error("the development server is down");
        }
      })
    ).rejects.toThrow();
    expect(storage.session.state[ERROR_LOG_DRAINED_SEQ_KEY]).toBe(2);

    const posted: ErrorLogEntry[][] = [];
    const result = await drainErrorLog({
      storage,
      post: (entries) => {
        posted.push(entries);
      }
    });

    expect(result).toEqual({ forwarded: 1 });
    expect(posted.at(-1)).toEqual([{ source: "test", seq: 3, message: "third" }]);
  });
});
