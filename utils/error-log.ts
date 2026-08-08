// Uncaught exceptions in an extension reach only the error box of
// chrome://extensions, which nothing outside Chrome can read: an extension
// cannot inject into chrome://, chrome.developerPrivate is exposed to internal
// pages only, and Chrome 136 disabled CDP against the default profile. Anything
// that diagnoses Sift automatically is therefore blind to them.
//
// What follows is the capture half of ordinary error telemetry — the same two
// global event subscriptions a Sentry-style SDK installs inside an extension —
// with a local destination instead of a server. Every surface writes to a ring
// buffer in browser.storage.local, in every build. In development the service
// worker forwards that buffer to the development server, which appends it to
// ~/.sift/extension-errors.log (scripts/dev-error-log.ts). A release build keeps
// filling the buffer and has nobody to forward it to.
//
// Best-effort by construction: nothing here throws, and nothing here is awaited
// by the code it watches. A lost diagnostic line is always better than a
// diagnostic that breaks filtering.
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";

// The key the buffer is kept under, and how many entries it holds.
const ERROR_LOG_KEY = "siftErrorLog";
const ERROR_LOG_LIMIT = 50;

const MESSAGE_LIMIT = 500;
const STACK_LIMIT = 4000;

export interface UncaughtEventDetails {
  message: string | null;
  stack: string | null;
  filename: string | null;
}

export type UncaughtEventKind = "error" | "unhandledrejection";

// The minimum either a real ErrorEvent/PromiseRejectionEvent or the test's
// fakes carry. Both event shapes are read through this one type, since which
// fields are meaningful depends on `kind`, not on the DOM event class.
export interface UncaughtEventLike {
  message?: unknown;
  filename?: unknown;
  error?: unknown;
  reason?: unknown;
}

export interface ErrorLogEntry {
  at?: string;
  source: string;
  kind?: string;
  message?: string | null;
  stack?: string | null;
  url?: string | null;
  seq: number;
}

// The ring buffer itself. Local rather than sync: it is about this browser on
// this machine, it turns over constantly, and sync's quota is for settings.
export const errorLogItem = storage.defineItem<ErrorLogEntry[]>(
  `local:${ERROR_LOG_KEY}`,
  { fallback: [] },
);

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

// A `seq` read off a value of unknown shape — storage can hold whatever an
// older version of this extension put there. Untyped on purpose: callers
// re-check the result with isInteger() before trusting it.
function readSeq(value: unknown): unknown {
  return typeof value === "object" && value !== null && "seq" in value
    ? (value as { seq: unknown }).seq
    : undefined;
}

function truncate(value: unknown, limit: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function readMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }

  try {
    return String(reason);
  } catch {
    // A thrown value need not be stringifiable (a null-prototype object, a
    // Proxy that traps toString). Losing its text beats losing the whole entry.
    return "(unstringifiable value)";
  }
}

// A `.stack` read off a value of unknown shape, the same way readSeq() reads
// `.seq` — reason/error is whatever was thrown, not necessarily an Error.
function readStack(value: unknown): unknown {
  return typeof value === "object" && value !== null && "stack" in value
    ? (value as { stack: unknown }).stack
    : undefined;
}

// Whether an error raised on a shared window came from Sift rather than from the
// page hosting it. `browser.runtime.getURL("")` is the right prefix in both
// builds: WXT bundles the content script into the extension in development too,
// so Sift's own frames always carry chrome-extension://<id>/ and only the dev
// server's own socket ever names localhost.
export function isOwnExtensionError(
  details: Partial<UncaughtEventDetails> | null | undefined,
  extensionUrlPrefix: string,
): boolean {
  if (typeof extensionUrlPrefix !== "string" || extensionUrlPrefix === "") {
    return false;
  }

  const { filename = null, stack = null } = details ?? {};
  return (
    (typeof filename === "string" && filename.startsWith(extensionUrlPrefix)) ||
    (typeof stack === "string" && stack.includes(extensionUrlPrefix))
  );
}

// The two event shapes differ: an ErrorEvent carries the location the exception
// escaped from, a PromiseRejectionEvent carries only the rejected value.
export function describeUncaughtEvent(
  event: UncaughtEventLike,
  kind: UncaughtEventKind,
): UncaughtEventDetails {
  if (kind === "unhandledrejection") {
    const reason = event?.reason;
    return {
      message: truncate(readMessage(reason), MESSAGE_LIMIT),
      stack: truncate(readStack(reason), STACK_LIMIT),
      filename: null,
    };
  }

  return {
    message: truncate(
      typeof event?.message === "string" && event.message !== ""
        ? event.message
        : readMessage(event?.error),
      MESSAGE_LIMIT,
    ),
    stack: truncate(readStack(event?.error), STACK_LIMIT),
    filename: typeof event?.filename === "string" ? event.filename : null,
  };
}

// `seq` is minted from the buffer itself so that the development drain can tell
// what it has already forwarded without a second counter to keep in step.
export function appendErrorEntry(
  entries: unknown,
  entry: Omit<ErrorLogEntry, "seq">,
  limit = ERROR_LOG_LIMIT,
): ErrorLogEntry[] {
  const existing = Array.isArray(entries) ? entries : [];
  const lastSeq = readSeq(existing.at(-1));
  const seq = (isInteger(lastSeq) ? lastSeq : 0) + 1;

  return [...existing, { ...entry, seq }].slice(-limit) as ErrorLogEntry[];
}

export function collectUndrainedEntries(
  entries: unknown,
  drainedSeq: unknown,
): ErrorLogEntry[] {
  const existing: unknown[] = Array.isArray(entries) ? entries : [];
  const lastSeq = readSeq(existing.at(-1));
  // A buffer whose newest entry predates the drain mark was started over
  // (storage cleared, extension reinstalled). Forward all of it rather than
  // silently discarding everything until the counter catches up again.
  const from =
    isInteger(drainedSeq) && isInteger(lastSeq) && lastSeq >= drainedSeq
      ? drainedSeq
      : 0;

  return existing.filter(
    (entry) => isInteger(readSeq(entry)) && (readSeq(entry) as number) > from,
  ) as ErrorLogEntry[];
}

// Serialized within a context so two errors in the same tick cannot each write
// the buffer they both read. Surfaces still race with one another, which can
// drop a line; diagnostics are best-effort and a lock would cost more than it
// saves here.
let pendingWrite: Promise<void> = Promise.resolve();

export function recordErrorEntry(
  entry: Omit<ErrorLogEntry, "seq">,
  limit = ERROR_LOG_LIMIT,
): Promise<void> {
  pendingWrite = pendingWrite
    .then(async () => {
      const stored = await errorLogItem.getValue();
      await errorLogItem.setValue(appendErrorEntry(stored, entry, limit));
    })
    .catch(() => {
      // The extension context can be invalidated mid-write after a reload.
    });

  return pendingWrite;
}

// The surface `window`, a service worker's `globalThis`, and the test's fake
// targets all satisfy. Narrower than EventTarget on purpose: the fakes have no
// dispatchEvent, and nothing here needs one.
export interface UncaughtReportingTarget {
  location?: { href?: string | null } | null;
  addEventListener(
    type: string,
    listener: (event: UncaughtEventLike) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: UncaughtEventLike) => void,
  ): void;
}

export interface InstallUncaughtReportingOptions {
  target: UncaughtReportingTarget;
  source: string;
  extensionUrlPrefix?: string | null;
  record: (entry: Omit<ErrorLogEntry, "seq">) => unknown;
  now?: () => string;
  readPageUrl?: () => string | null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

export function installUncaughtReporting({
  target,
  source,
  extensionUrlPrefix = null,
  record,
  now = () => new Date().toISOString(),
  readPageUrl = () => target.location?.href ?? null,
}: InstallUncaughtReportingOptions): () => void {
  function report(event: UncaughtEventLike, kind: UncaughtEventKind) {
    try {
      const details = describeUncaughtEvent(event, kind);
      if (
        extensionUrlPrefix !== null &&
        !isOwnExtensionError(details, extensionUrlPrefix)
      ) {
        return;
      }

      const written = record({
        at: now(),
        source,
        kind,
        message: details.message,
        stack: details.stack,
        url: readPageUrl(),
      });
      // A rejection escaping here would be caught by this very handler.
      if (isThenable(written)) {
        written.then(undefined, () => {});
      }
    } catch {
      // Diagnostics must never break the code they watch.
    }
  }

  const handleError = (event: UncaughtEventLike) => report(event, "error");
  const handleRejection = (event: UncaughtEventLike) =>
    report(event, "unhandledrejection");

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleRejection);

  return function stopUncaughtReporting() {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleRejection);
  };
}

export interface StartUncaughtReportingOptions {
  target: UncaughtReportingTarget;
  source: string;
  filterToOwnCode: boolean;
}

// The browser-side wiring the three surfaces share. `filterToOwnCode` is on only
// where the page's own exceptions land on the same target.
export function startUncaughtReporting({
  target,
  source,
  filterToOwnCode,
}: StartUncaughtReportingOptions): () => void {
  return installUncaughtReporting({
    target,
    source,
    extensionUrlPrefix: filterToOwnCode ? browser.runtime.getURL("") : null,
    record: (entry) => recordErrorEntry(entry),
  });
}
