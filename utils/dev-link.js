// Keeping the development worker attached to the development server.
//
// WHY THIS EXISTS: in dev mode WXT does NOT put the content script in the
// manifest. It builds the file, leaves `content_scripts` out, and registers the
// script at runtime — but only in answer to the service worker opening a
// WebSocket to the dev server and announcing itself. Nothing else ever performs
// that registration, so a worker that is not attached means a content script
// that does not exist, and pages load with no extension on them at all (#31).
//
// The worker's socket is opened once, when the worker starts, and is never
// retried. Two ordinary things therefore break the link for good:
//
//   - the browser was open before `npm run dev` was — the socket was refused,
//     the worker stays alive (WXT pings an API every 5s to keep it that way) and
//     never tries again
//   - the dev server was restarted — the socket closed, and again nothing
//     reconnects it
//
// The one thing that reliably re-establishes it is starting the worker over,
// which `chrome.runtime.reload()` does. So the worker watches for those two
// states and reloads itself out of them. The server's boot id is what makes them
// visible: "the id I saw when I started" versus "the id up now".
//
// Only the development build carries any of this — see entrypoints/background.js
// for how it is compiled out of a release.

// Which server generation this worker has already reloaded for. In session
// storage rather than memory because a reload IS the loss of memory: without it
// the worker would come back, see the same state and reload again forever.
export const DEV_LINK_RELOAD_KEY = "siftDevLinkReloadedBoot";

// A content script announcing that it ran. It is the only evidence from outside
// Chrome that the registration took effect, and it doubles as the event that
// wakes a sleeping worker when a matching page loads.
export const DEV_CONTENT_STARTED = "sift:dev-content-started";

/**
 * What to do about the link, given one probe of the development server.
 *
 * Split out from the worker because every interesting case is a combination of
 * "is the server up", "is it the same server" and "have I already tried" — which
 * is exactly the shape that is miserable to reproduce in a browser and trivial
 * to state in a test.
 *
 * @param {object} probe
 * @param {string|null} probe.boot        server generation, null when it is down
 * @param {boolean} probe.isFirstProbe    is this the worker's first probe
 * @param {string} [probe.bootAtStart]    generation adopted when the worker started
 * @param {number} probe.registeredCount  content scripts registered right now
 * @param {string} [probe.reloadedForBoot] generation already reloaded for
 * @returns {"server-down"|"adopt"|"linked"|"reload"|"waiting"}
 */
export function decideDevLinkAction({
  boot,
  isFirstProbe,
  bootAtStart,
  registeredCount,
  reloadedForBoot
}) {
  if (boot == null) {
    return "server-down";
  }

  // The worker's socket was opened moments ago against this same server, so it
  // is attached — or will be within the second it takes to answer.
  if (isFirstProbe) {
    return "adopt";
  }

  if (boot === bootAtStart && registeredCount > 0) {
    return "linked";
  }

  // One reload per server generation. If coming back did not fix it, something
  // else is wrong and a loop would only hide it.
  if (reloadedForBoot === boot) {
    return "waiting";
  }

  return "reload";
}
