import { metricThresholdSuggestions } from "../../../utils/metric-threshold-suggestions.ts";
import { PUBLICATION_PERIODS } from "../../../utils/publication-period.ts";

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
export function isReplayItemVisible(
  mode: "social" | "youtube",
  value: number,
  time: number,
) {
  return (
    getReplayState(time).stage !== 3 ||
    (mode === "youtube" ? value <= 90 : value >= 100)
  );
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
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = 0;
  let last = performance.now();
  let visible = true;
  let optionOffset: Point | undefined;
  function updatePanel() {
    const youtube = root.dataset.mode === "youtube";
    get("[data-label]").textContent = youtube ? "投稿期間" : "最低いいね数";
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(
        youtube ? ".replay-video" : ".replay-post",
      ),
    );
    get("[data-panel-note]").textContent = youtube
      ? `読み込み済み動画${items.length}本を集計しています`
      : `読み込み済み投稿${items.length}件を集計しています`;
    const values = items.map((item) =>
      Number(youtube ? item.dataset.days : item.dataset.likes),
    );
    const choices = youtube
      ? PUBLICATION_PERIODS.map((period) => ({
          label: `${period.value}${period.unit === "week" ? "週間" : period.unit === "month" ? "か月" : "年"}以内`,
          count: values.filter((days) => days <= period.days).length,
          selected: period.days === 90,
        }))
      : metricThresholdSuggestions(values, 100).map((suggestion) => ({
          label: new Intl.NumberFormat("ja", { notation: "compact" }).format(
            suggestion.minimum,
          ),
          count: suggestion.count,
          selected: suggestion.minimum === 100,
        }));
    const suffix = youtube ? "本" : "件";
    const entry = (label: string, count?: number, selected = false) => {
      const element = document.createElement("div");
      const text = document.createElement("span");
      text.textContent = label;
      element.append(text);
      if (count !== undefined) {
        const total = document.createElement("span");
        total.textContent = `${count}${suffix}`;
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
      entry(youtube ? "期間を入力" : "数値を入力"),
    );
    optionOffset = undefined;
  }
  const resize = new ResizeObserver(() => {
    screen.style.transform = `scale(${viewport.clientWidth / screen.offsetWidth})`;
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
    const youtube = root.dataset.mode === "youtube";
    root.dataset.stage = String(stage);
    get(".replay-panel").setAttribute("aria-hidden", String(stage === 0));
    menu.hidden = !menuOpen;
    get(".replay-option").classList.toggle("chosen", chosen);
    cursor.classList.toggle("click", clicked);
    get(".replay-extension").classList.toggle(
      "pressed",
      clicked && stage === 0,
    );
    get("[data-value]").textContent =
      stage === 3 ? (youtube ? "3か月以内" : "100") : "指定なし";
    root
      .querySelectorAll<HTMLElement>("[data-step]")
      .forEach((button, index) => {
        if (stage === index) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
        const start = boundaries[index] ?? 0;
        const end = boundaries[index + 1] ?? 15700;
        const fill = button.querySelector<HTMLElement>(".replay-progress");
        if (fill)
          fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (time - start) / (end - start)))})`;
      });
    root.querySelectorAll<HTMLElement>(".replay-post").forEach((post) => {
      const removed = !isReplayItemVisible(
        "social",
        Number(post.dataset.likes),
        time,
      );
      post.classList.toggle("removed", removed);
      post.setAttribute("aria-hidden", String(removed));
    });
    root.querySelectorAll<HTMLElement>(".replay-video").forEach((video) => {
      const removed = !isReplayItemVisible(
        "youtube",
        Number(video.dataset.days),
        time,
      );
      video.hidden = removed;
      video.setAttribute("aria-hidden", String(removed));
    });
    const items = [
      ...root.querySelectorAll<HTMLElement>(
        youtube ? ".replay-video" : ".replay-post",
      ),
    ];
    const count = items.filter((item) =>
      youtube ? !item.hidden : !item.classList.contains("removed"),
    ).length;
    get(youtube ? "[data-video-count]" : "[data-social-count]").textContent =
      `${count} / ${items.length}件を表示`;
    get("[data-selected-count]").textContent =
      `${count}${youtube ? "本" : "件"}`;
    cursor.hidden = stage === 3;
    if (stage === 3) return;
    const icon = point(get(".replay-extension"));
    const picker = point(get(".replay-picker"));
    if (!menu.hidden || !optionOffset) {
      const wasHidden = menu.hidden;
      menu.hidden = false;
      const option = point(get(".replay-option"));
      optionOffset = { x: option.x - picker.x, y: option.y - picker.y };
      menu.hidden = wasHidden;
    }
    const option = {
      x: picker.x + optionOffset.x,
      y: picker.y + optionOffset.y,
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
      const index = Number(button.dataset.step);
      elapsed = seekReplayTime(index, reduced.matches);
      render(elapsed);
    });
  });
  function frame(now: number) {
    const next = advanceReplayTime(
      elapsed,
      now - last,
      !reduced.matches && visible && !document.hidden,
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
  requestAnimationFrame(frame);
}
