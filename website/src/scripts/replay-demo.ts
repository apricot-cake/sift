import { metricThresholdSuggestions } from "../../../utils/metric-threshold-suggestions.ts";

const boundaries = [0, 2600, 5000, 8900, 15700];
type Point = { x: number; y: number };
export function interpolateCursor(
  from: Point,
  to: Point,
  progress: number,
  bend: number,
) {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const arc = 4 * eased * (1 - eased) * bend;
  return {
    x: from.x + dx * eased - (dy / distance) * arc,
    y: from.y + dy * eased + (dx / distance) * arc,
  };
}
export function getReplayState(time: number) {
  return {
    stage: time < 2600 ? 0 : time < 5000 ? 1 : time < 8900 ? 2 : 3,
    menuOpen: time >= 5700 && time < 8100,
    chosen: time >= 7500 && time < 8100,
    clicked:
      (time >= 2150 && time < 2600) ||
      (time >= 5500 && time < 5900) ||
      (time >= 7800 && time < 8200),
  };
}
export function advanceReplayTime(time: number, delta: number, enabled = true) {
  return enabled ? (time + Math.max(0, Math.min(delta, 100))) % 15700 : time;
}
export function seekReplayTime(index: number, reducedMotion = false) {
  return reducedMotion && index === 2 ? 7000 : (boundaries[index] ?? 0);
}
export function isReplayItemVisible(value: number, time: number) {
  return getReplayState(time).stage !== 3 || value >= 100;
}
export function initializeReplayDemos() {
  document
    .querySelectorAll<HTMLElement>("[data-replay-demo]")
    .forEach(initialize);
}
function initialize(root: HTMLElement) {
  if (root.dataset.initialized) return;
  root.dataset.initialized = "true";
  const get = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`デモの要素が見つかりません: ${selector}`);
    return element;
  };
  const screen = get(".replay-screen");
  const viewport = get(".replay-viewport");
  const cursor = get(".replay-cursor");
  const menu = get(".replay-menu");
  const startOverlay = get(".replay-start-overlay");
  const startButton = get<HTMLButtonElement>(".replay-start");
  const timeline = get<HTMLFieldSetElement>(".replay-timeline");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let started = false;
  let elapsed = 0;
  let last = performance.now();
  let visible = true;
  let optionOffset: Point | undefined;
  let renderedState = "";
  function updatePanel() {
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(".replay-post"),
    );
    get("[data-panel-note]").textContent =
      `読み込み済み投稿${items.length}件を集計しています`;
    const values = items.map((item) => Number(item.dataset.likes));
    const choices = metricThresholdSuggestions(values, 100).map(
      (suggestion) => ({
        label: new Intl.NumberFormat("ja", { notation: "compact" }).format(
          suggestion.minimum,
        ),
        count: suggestion.count,
        selected: suggestion.minimum === 100,
      }),
    );
    const entry = (label: string, count?: number, selected = false) => {
      const element = document.createElement("div");
      const text = document.createElement("span");
      text.textContent = label;
      element.append(text);
      if (count !== undefined) {
        const total = document.createElement("span");
        total.textContent = `${count}件`;
        element.append(total);
      }
      if (selected) element.className = "replay-option";
      return element;
    };
    menu.replaceChildren(
      entry("指定なし", values.length),
      ...choices.map((choice) =>
        entry(choice.label, choice.count, choice.selected),
      ),
      entry("数値を入力"),
    );
    optionOffset = undefined;
  }
  const resize = new ResizeObserver(() => {
    screen.style.transform = `scale(${viewport.clientWidth / screen.offsetWidth})`;
    optionOffset = undefined;
    render(elapsed);
  });
  resize.observe(viewport);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
  });
  intersection.observe(root);
  const point = (element: HTMLElement) => {
    const origin = screen.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const scale = origin.width / screen.offsetWidth || 1;
    return {
      x: (box.left + box.width / 2 - origin.left) / scale,
      y: (box.top + box.height / 2 - origin.top) / scale,
    };
  };
  function render(time: number) {
    const { stage, menuOpen, chosen, clicked } = getReplayState(time);
    cursor.hidden = !started || stage === 3;
    const state = `${stage}:${menuOpen}:${chosen}:${clicked}`;
    const changed = state !== renderedState;
    if (changed) {
      renderedState = state;
      root.dataset.stage = String(stage);
      get(".replay-panel").setAttribute("aria-hidden", String(stage === 0));
      menu.hidden = !menuOpen;
      get(".replay-option").classList.toggle("chosen", chosen);
      cursor.classList.toggle("click", clicked);
      get(".replay-extension").classList.toggle(
        "pressed",
        clicked && stage === 0,
      );
      get("[data-value]").textContent = stage === 3 ? "100" : "指定なし";
    }
    root
      .querySelectorAll<HTMLElement>("[data-step]")
      .forEach((button, index) => {
        if (changed) {
          if (stage === index) button.setAttribute("aria-current", "step");
          else button.removeAttribute("aria-current");
        }
        const start = boundaries[index] ?? 0;
        const end = boundaries[index + 1] ?? 15700;
        const fill = button.querySelector<HTMLElement>(".replay-progress");
        if (fill)
          fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (time - start) / (end - start)))})`;
      });
    if (changed) {
      root.querySelectorAll<HTMLElement>(".replay-post").forEach((post) => {
        const removed = !isReplayItemVisible(Number(post.dataset.likes), time);
        post.classList.toggle("removed", removed);
        post.setAttribute("aria-hidden", String(removed));
      });
      const items = [...root.querySelectorAll<HTMLElement>(".replay-post")];
      const count = items.filter(
        (item) => !item.classList.contains("removed"),
      ).length;
      get("[data-selected-count]").textContent = `${count}件`;
    }
    if (stage === 3) return;
    const icon = point(get(".replay-extension"));
    const picker = point(get(".replay-picker"));
    if (!optionOffset && menuOpen) {
      const option = point(get(".replay-option"));
      optionOffset = { x: option.x - picker.x, y: option.y - picker.y };
    }
    const option = {
      x: picker.x + (optionOffset?.x ?? 0),
      y: picker.y + (optionOffset?.y ?? 0),
    };
    const start = { x: icon.x * 0.6, y: 110 };
    let from = start;
    let to = icon;
    let progress = (time - 650) / 1400;
    let bend = 24;
    if (time >= 2600 && time < 5900) {
      from = icon;
      to = picker;
      progress = (time - 3500) / 1700;
      bend = -20;
    }
    if (time >= 5900 && time < 8200) {
      from = picker;
      to = option;
      progress = (time - 6200) / 1400;
      bend = 8;
    }
    if (time >= 8200) {
      from = option;
      to = option;
      progress = 1;
    }
    const position = interpolateCursor(from, to, progress, bend);
    cursor.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }
  root.querySelectorAll<HTMLElement>("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!started) return;
      const index = Number(button.dataset.step);
      elapsed = seekReplayTime(index, reduced.matches);
      render(elapsed);
    });
  });
  function frame(now: number) {
    const next = advanceReplayTime(
      elapsed,
      now - last,
      started && !reduced.matches && visible && !document.hidden,
    );
    last = now;
    if (next !== elapsed) {
      elapsed = next;
      render(elapsed);
    }
    requestAnimationFrame(frame);
  }
  updatePanel();
  render(0);
  startButton.disabled = false;
  startButton.addEventListener("click", () => {
    if (started) return;
    const keyboardFocus = startButton.matches(":focus-visible");
    started = true;
    elapsed = 0;
    last = performance.now();
    timeline.disabled = false;
    startOverlay.hidden = true;
    render(0);
    if (keyboardFocus) {
      timeline
        .querySelector<HTMLButtonElement>("[data-step]")
        ?.focus({ preventScroll: true });
    }
  });
  requestAnimationFrame(frame);
}
