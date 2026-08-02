// Uncaught exceptions in an extension reach only the error box of
// chrome://extensions, which nothing outside Chrome can read: an extension
// cannot inject into chrome://, chrome.developerPrivate is exposed to internal
// pages only, and Chrome 136 disabled CDP against the default profile. Anything
// that diagnoses Sift automatically is therefore blind to them.
//
// What follows is the capture half of ordinary error telemetry — the same two
// global event subscriptions a Sentry-style SDK installs inside an extension —
// with a local destination instead of a server. Every surface writes to a ring
// buffer in chrome.storage.local, in every build. In development the service
// worker forwards that buffer to the development server, which appends it to
// ~/.sift/extension-errors.log (scripts/dev-error-log.js). A release build keeps
// filling the buffer and has nobody to forward it to.
//
// Best-effort by construction: nothing here throws, and nothing here is awaited
// by the code it watches. A lost diagnostic line is always better than a
// diagnostic that breaks filtering.

export const ERROR_LOG_KEY = "siftErrorLog";
export const ERROR_LOG_LIMIT = 50;

const MESSAGE_LIMIT = 500;
const STACK_LIMIT = 4000;

function truncate(value, limit) {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function readMessage(reason) {
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

// Whether an error raised on a shared window came from Sift rather than from the
// page hosting it. `chrome.runtime.getURL("")` is the right prefix in both
// builds: WXT bundles the content script into the extension in development too,
// so Sift's own frames always carry chrome-extension://<id>/ and only the dev
// server's own socket ever names localhost.
export function isOwnExtensionError(details, extensionUrlPrefix) {
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
export function describeUncaughtEvent(event, kind) {
  if (kind === "unhandledrejection") {
    const reason = event?.reason;
    return {
      message: truncate(readMessage(reason), MESSAGE_LIMIT),
      stack: truncate(reason?.stack, STACK_LIMIT),
      filename: null
    };
  }

  return {
    message: truncate(
      typeof event?.message === "string" && event.message !== ""
        ? event.message
        : readMessage(event?.error),
      MESSAGE_LIMIT
    ),
    stack: truncate(event?.error?.stack, STACK_LIMIT),
    filename: typeof event?.filename === "string" ? event.filename : null
  };
}

// `seq` is minted from the buffer itself so that the development drain can tell
// what it has already forwarded without a second counter to keep in step.
export function appendErrorEntry(entries, entry, limit = ERROR_LOG_LIMIT) {
  const existing = Array.isArray(entries) ? entries : [];
  const lastSeq = existing.at(-1)?.seq;
  const seq = (Number.isInteger(lastSeq) ? lastSeq : 0) + 1;

  return [...existing, { ...entry, seq }].slice(-limit);
}

export function collectUndrainedEntries(entries, drainedSeq) {
  const existing = Array.isArray(entries) ? entries : [];
  const lastSeq = existing.at(-1)?.seq;
  // A buffer whose newest entry predates the drain mark was started over
  // (storage cleared, extension reinstalled). Forward all of it rather than
  // silently discarding everything until the counter catches up again.
  const from =
    Number.isInteger(drainedSeq) &&
    Number.isInteger(lastSeq) &&
    lastSeq >= drainedSeq
      ? drainedSeq
      : 0;

  return existing.filter((entry) => Number.isInteger(entry?.seq) && entry.seq > from);
}

// Serialized within a context so two errors in the same tick cannot each write
// the buffer they both read. Surfaces still race with one another, which can
// drop a line; diagnostics are best-effort and a lock would cost more than it
// saves here.
let pendingWrite = Promise.resolve();

export function recordErrorEntry(storage, entry, limit = ERROR_LOG_LIMIT) {
  pendingWrite = pendingWrite
    .then(async () => {
      const stored = await storage.get(ERROR_LOG_KEY);
      await storage.set({
        [ERROR_LOG_KEY]: appendErrorEntry(stored?.[ERROR_LOG_KEY], entry, limit)
      });
    })
    .catch(() => {
      // The extension context can be invalidated mid-write after a reload.
    });

  return pendingWrite;
}

export function installUncaughtReporting({
  target,
  source,
  extensionUrlPrefix = null,
  record,
  now = () => new Date().toISOString(),
  readPageUrl = () => target?.location?.href ?? null
}) {
  function report(event, kind) {
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
        url: readPageUrl()
      });
      // A rejection escaping here would be caught by this very handler.
      if (typeof written?.then === "function") {
        written.then(undefined, () => {});
      }
    } catch {
      // Diagnostics must never break the code they watch.
    }
  }

  const handleError = (event) => report(event, "error");
  const handleRejection = (event) => report(event, "unhandledrejection");

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleRejection);

  return function stopUncaughtReporting() {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleRejection);
  };
}

// The browser-side wiring the three surfaces share. `filterToOwnCode` is on only
// where the page's own exceptions land on the same target.
export function startUncaughtReporting({ target, source, filterToOwnCode }) {
  return installUncaughtReporting({
    target,
    source,
    extensionUrlPrefix: filterToOwnCode ? chrome.runtime.getURL("") : null,
    record: (entry) => recordErrorEntry(chrome.storage.local, entry)
  });
}
