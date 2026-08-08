import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { drainErrorLog } from "./error-drain.ts";
import { errorLogItem, type ErrorLogEntry } from "./error-log.ts";

const buffered: ErrorLogEntry[] = [
  { source: "test", seq: 1, message: "first" },
  { source: "test", seq: 2, message: "second" }
];

beforeEach(async () => {
  fakeBrowser.reset();
  await errorLogItem.setValue(buffered);
});

describe("drainErrorLog", () => {
  it("forwards the buffer and marks how far it got", async () => {
    const posted: ErrorLogEntry[][] = [];

    const result = await drainErrorLog({
      post: (entries) => {
        posted.push(entries);
      }
    });

    expect(result).toEqual({ forwarded: 2 });
    expect(posted).toEqual([buffered]);
  });

  it("forwards nothing the second time round", async () => {
    let posts = 0;

    await drainErrorLog({ post: () => {} });
    const result = await drainErrorLog({
      post: () => {
        posts += 1;
      }
    });

    expect(result).toEqual({ forwarded: 0 });
    expect(posts).toBe(0);
  });

  it("forwards only what was added since the last drain", async () => {
    await drainErrorLog({ post: () => {} });
    await errorLogItem.setValue([...buffered, { source: "test", seq: 3, message: "third" }]);

    const posted: ErrorLogEntry[][] = [];
    const result = await drainErrorLog({
      post: (entries) => {
        posted.push(entries);
      }
    });

    expect(result).toEqual({ forwarded: 1 });
    expect(posted).toEqual([[{ source: "test", seq: 3, message: "third" }]]);
  });

  // A post that fails leaves the mark alone so the entries go out next time.
  it("keeps the mark where it was when the post fails", async () => {
    await expect(
      drainErrorLog({
        post: () => {
          throw new Error("the development server is down");
        }
      })
    ).rejects.toThrow();

    const posted: ErrorLogEntry[][] = [];
    const result = await drainErrorLog({
      post: (entries) => {
        posted.push(entries);
      }
    });

    expect(result).toEqual({ forwarded: 2 });
    expect(posted).toEqual([buffered]);
  });

  // A buffer whose newest entry predates the mark was started over — storage
  // cleared, or the extension reinstalled — and goes out whole rather than
  // being withheld until the counter catches up again.
  it("forwards a buffer that restarted below the mark", async () => {
    await drainErrorLog({ post: () => {} });
    await errorLogItem.setValue([{ source: "test", seq: 1, message: "after a restart" }]);

    const result = await drainErrorLog({ post: () => {} });

    expect(result).toEqual({ forwarded: 1 });
  });
});
