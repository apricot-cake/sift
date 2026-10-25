import { selectAdapter } from "../utils/adapters/index.ts";
import { TimelineViewport } from "../utils/timeline-viewport.ts";

const VIEWPORT_KEY = "__siftPanelViewport__";
const NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

/** 開く操作の幅変更だけを追跡し、ページの読み取りや絞り込みとは独立させる。 */
export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & {
    [VIEWPORT_KEY]?: () => void;
  };
  scope[VIEWPORT_KEY]?.();
  const adapter = selectAdapter(location.hostname);
  if (!adapter?.readPostId || adapter.isTimelineAvailable(document, location))
    return;

  const viewport = new TimelineViewport(adapter, { unfiltered: true });
  viewport.update();
  const handleResize = () => viewport.resize();
  const handleNavigation = (event: Event) => {
    if (
      event.isTrusted &&
      (!(event instanceof KeyboardEvent) || NAVIGATION_KEYS.has(event.key))
    )
      dispose();
  };
  const timer = window.setTimeout(dispose, 2500);
  function dispose(): void {
    window.clearTimeout(timer);
    viewport.cancel();
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pagehide", dispose);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      window.removeEventListener(event, handleNavigation, true);
    if (scope[VIEWPORT_KEY] === dispose) delete scope[VIEWPORT_KEY];
  }
  scope[VIEWPORT_KEY] = dispose;
  window.addEventListener("resize", handleResize);
  window.addEventListener("pagehide", dispose);
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
    window.addEventListener(event, handleNavigation, {
      capture: true,
      passive: true,
    });
});
