import { describe, expect, it } from "vitest";
import { createFakeStorageArea } from "../test/storage.ts";
import {
  appendErrorEntry,
  collectUndrainedEntries,
  describeUncaughtEvent,
  ERROR_LOG_KEY,
  installUncaughtReporting,
  isOwnExtensionError,
  recordErrorEntry,
  type ErrorLogEntry
} from "./error-log.ts";

const extensionPrefix = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";

const uncaughtError = new Error("boom");
uncaughtError.stack = `Error: boom\n    at ${extensionPrefix}src/content/index.js:3:1`;

// The window an uncaught exception reaches, with a way to fire one and to count
// what is still subscribed. A content script shares its window with the page's
// own code, which is why what is subscribed — and what is left behind after
// dispose — is part of the reading.
function createFakeTarget(href: string | null = null) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    location: href === null ? undefined : { href },
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener)
      );
    },
    emit(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

// X's own exceptions reach the same window a content script does, and recording
// them would be a false report. Only frames naming the extension's origin are
// Sift's.
describe("isOwnExtensionError", () => {
  it("reads a frame naming the extension's own origin", () => {
    expect(
      isOwnExtensionError(
        { filename: `${extensionPrefix}src/content/index.js`, stack: null },
        extensionPrefix
      )
    ).toBe(true);
  });

  it("reads the origin out of the stack when there is no filename", () => {
    expect(
      isOwnExtensionError(
        {
          filename: null,
          stack: `Error: broke\n    at readLikeCount (${extensionPrefix}src/filter-core.js:12:5)`
        },
        extensionPrefix
      )
    ).toBe(true);
  });

  it("leaves the page's own exceptions alone", () => {
    expect(
      isOwnExtensionError(
        {
          filename: "https://x.com/bundle.js",
          stack: "TypeError: x\n    at https://x.com/bundle.js:1:1"
        },
        extensionPrefix
      )
    ).toBe(false);
  });

  it("claims nothing when there is nothing to read", () => {
    expect(isOwnExtensionError({ filename: null, stack: null }, extensionPrefix)).toBe(false);
    expect(isOwnExtensionError({ filename: `${extensionPrefix}a.js` }, "")).toBe(false);
  });
});

describe("describeUncaughtEvent", () => {
  it("reads an error event", () => {
    expect(
      describeUncaughtEvent(
        {
          message: "Uncaught Error: boom",
          filename: `${extensionPrefix}src/content/index.js`,
          error: uncaughtError
        },
        "error"
      )
    ).toEqual({
      message: "Uncaught Error: boom",
      stack: uncaughtError.stack,
      filename: `${extensionPrefix}src/content/index.js`
    });
  });

  it("reads a rejection carrying an Error", () => {
    expect(describeUncaughtEvent({ reason: uncaughtError }, "unhandledrejection")).toEqual({
      message: "Error: boom",
      stack: uncaughtError.stack,
      filename: null
    });
  });

  it("reads a rejection carrying a bare value", () => {
    expect(describeUncaughtEvent({ reason: "plain string" }, "unhandledrejection")).toEqual({
      message: "plain string",
      stack: null,
      filename: null
    });
  });

  // The reason is whatever the failing code threw, so reading it must not be a
  // second way to throw.
  it("survives a reason whose message throws", () => {
    expect(
      describeUncaughtEvent(
        {
          reason: {
            get message() {
              throw new Error("hostile");
            }
          }
        },
        "unhandledrejection"
      ).message
    ).toBe("[object Object]");
  });

  it("survives a reason that cannot be turned into a string at all", () => {
    expect(
      describeUncaughtEvent(
        { reason: Object.assign(Object.create(null), { toString: null }) },
        "unhandledrejection"
      ).message
    ).toBe("(unstringifiable value)");
  });

  // The buffer lives in chrome.storage, so one enormous message must not be
  // able to fill it.
  it("cuts an overlong message down", () => {
    expect(describeUncaughtEvent({ message: "x".repeat(600) }, "error").message).toHaveLength(
      501
    );
  });
});

describe("appendErrorEntry", () => {
  it("numbers the first entry from one", () => {
    expect(appendErrorEntry(undefined, { source: "content" })).toEqual([
      { source: "content", seq: 1 }
    ]);
  });

  it("carries the numbering on from what is already stored", () => {
    expect(appendErrorEntry([{ source: "popup", seq: 4 }], { source: "content" })).toEqual([
      { source: "popup", seq: 4 },
      { source: "content", seq: 5 }
    ]);
  });

  it("keeps the newest entries and drops the oldest", () => {
    let ringBuffer: ErrorLogEntry[] = [];
    for (let index = 0; index < 5; index += 1) {
      ringBuffer = appendErrorEntry(ringBuffer, { source: "test", message: `error ${index}` }, 3);
    }

    expect(ringBuffer.map((entry) => entry.seq)).toEqual([3, 4, 5]);
    expect(ringBuffer[0]?.message).toBe("error 2");
  });
});

describe("collectUndrainedEntries", () => {
  it("takes what is past the drain mark", () => {
    expect(collectUndrainedEntries([{ seq: 1 }, { seq: 2 }, { seq: 3 }], 2)).toEqual([
      { seq: 3 }
    ]);
  });

  it("takes everything when nothing has been drained", () => {
    expect(collectUndrainedEntries([{ seq: 1 }, { seq: 2 }], undefined)).toEqual([
      { seq: 1 },
      { seq: 2 }
    ]);
  });

  // A buffer that restarted below the drain mark is forwarded whole rather than
  // silently withheld until the counter catches up.
  it("forwards a buffer that restarted below the mark", () => {
    expect(collectUndrainedEntries([{ seq: 1 }], 9)).toEqual([{ seq: 1 }]);
    expect(collectUndrainedEntries([], 9)).toEqual([]);
  });
});

describe("recordErrorEntry", () => {
  it("appends to the buffer in storage", async () => {
    const storage = createFakeStorageArea();

    await recordErrorEntry(storage, { source: "content", message: "first" });
    await recordErrorEntry(storage, { source: "popup", message: "second" });

    expect(storage.state[ERROR_LOG_KEY]).toEqual([
      { source: "content", message: "first", seq: 1 },
      { source: "popup", message: "second", seq: 2 }
    ]);
  });

  // The extension being reloaded under a live content script invalidates its
  // context, and every storage call from then on throws. Recording an error
  // must not become an error.
  it("swallows a storage that is gone", async () => {
    const brokenStorage = {
      async get() {
        throw new Error("Extension context invalidated.");
      },
      async set() {}
    };

    await expect(recordErrorEntry(brokenStorage, { source: "content" })).resolves.not.toThrow();
  });
});

describe("installUncaughtReporting", () => {
  it("records the extension's own exceptions and leaves the page's alone", () => {
    const target = createFakeTarget("https://x.com/home");
    const recorded: Omit<ErrorLogEntry, "seq">[] = [];
    installUncaughtReporting({
      target,
      source: "content",
      extensionUrlPrefix: extensionPrefix,
      record: (entry) => {
        recorded.push(entry);
      },
      now: () => "2026-08-02T00:00:00.000Z"
    });

    target.emit("error", {
      message: "Uncaught Error: boom",
      filename: `${extensionPrefix}src/content/index.js`,
      error: uncaughtError
    });
    target.emit("error", {
      message: "Uncaught TypeError: page broke",
      filename: "https://x.com/bundle.js",
      error: new Error("page broke")
    });
    target.emit("unhandledrejection", { reason: uncaughtError });
    target.emit("unhandledrejection", { reason: "a bare page rejection" });

    expect(recorded).toEqual([
      {
        at: "2026-08-02T00:00:00.000Z",
        source: "content",
        kind: "error",
        message: "Uncaught Error: boom",
        stack: uncaughtError.stack,
        url: "https://x.com/home"
      },
      {
        at: "2026-08-02T00:00:00.000Z",
        source: "content",
        kind: "unhandledrejection",
        message: "Error: boom",
        stack: uncaughtError.stack,
        url: "https://x.com/home"
      }
    ]);
  });

  // The injection that replaces a content script disposes the previous runtime
  // first, and what it leaves subscribed would report into a dead context.
  it("unsubscribes everything it subscribed", () => {
    const target = createFakeTarget("https://x.com/home");
    const recorded: Omit<ErrorLogEntry, "seq">[] = [];
    const stop = installUncaughtReporting({
      target,
      source: "content",
      extensionUrlPrefix: extensionPrefix,
      record: (entry) => {
        recorded.push(entry);
      }
    });

    stop();

    expect(target.count("error")).toBe(0);
    expect(target.count("unhandledrejection")).toBe(0);
    target.emit("error", {
      filename: `${extensionPrefix}src/content/index.js`,
      error: uncaughtError
    });
    expect(recorded).toEqual([]);
  });

  // Everything running on an extension page is the extension's own, so nothing
  // is filtered out there.
  it("records everything on an extension page", () => {
    const target = createFakeTarget("chrome-extension://abc/popup.html");
    const recorded: Omit<ErrorLogEntry, "seq">[] = [];
    installUncaughtReporting({
      target,
      source: "popup",
      record: (entry) => {
        recorded.push(entry);
      }
    });

    target.emit("error", { message: "anything on an extension page", error: null });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.source).toBe("popup");
  });

  // A recorder that fails must not take the watched code down with it.
  it("survives a recorder that throws", () => {
    const target = createFakeTarget();
    installUncaughtReporting({
      target,
      source: "popup",
      record: () => {
        throw new Error("storage is gone");
      }
    });

    expect(() => target.emit("error", { message: "x" })).not.toThrow();
  });

  // And a rejected write must not become the next unhandled rejection.
  it("survives a recorder that rejects", async () => {
    const target = createFakeTarget();
    installUncaughtReporting({
      target,
      source: "popup",
      record: () => Promise.reject(new Error("storage is gone"))
    });

    target.emit("unhandledrejection", { reason: "x" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
