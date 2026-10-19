import type { ElementHandle, Page } from "puppeteer-core";
import { expect, type RunnerTask } from "vitest";
import { workerCommandTimeout } from "../scripts/browser-worker.ts";
import { callFunction } from "../scripts/cdp-call.ts";
import { selectPartialChoice } from "../scripts/compatibility/filter-choice.ts";
import { retryNameResolution } from "../scripts/compatibility/navigation.ts";
import {
  captureRoute,
  captureStructure,
  normalizeBlueskyFeedNavigation,
  type StructureNode,
  type StructureSnapshot,
} from "../scripts/compatibility/structure.ts";
import { parseMetric } from "../utils/filter-core.ts";
import {
  aria,
  element,
  evidence,
  fillNumber,
  text,
  visible,
} from "./browser-queries.ts";
import {
  type CompatibilityCase,
  cases,
  compatibilityEntry,
  groupByEntry,
} from "./cases.ts";
import {
  acquireCasePage,
  assertLivePage,
  closePanel,
  completeInitialLoad,
  type LiveSession,
  openPanel,
  readContext,
  releaseCasePage,
} from "./live.ts";
import type { LiveCase } from "./live-case.ts";
import { changeXSearch } from "./x-navigation.ts";

// サイドパネルでは背景タブ扱いでrequestAnimationFrameが停止することがある。
// 可視・有効を確認し、安定性待ちだけを省いてCDPの実ポインター入力を送る。
async function panelClick(handle: ElementHandle<Element>) {
  expect(await handle.isVisible()).toBe(true);
  expect(await handle.evaluate((node) => !node.hasAttribute("disabled"))).toBe(
    true,
  );
  await handle.click();
}
const regions = {
  x: {
    card: 'article[data-testid="tweet"]',
    metric: 'button[data-testid="like"], button[data-testid="unlike"]',
    sort: '[role="tablist"] [role="tab"]',
  },
  bluesky: {
    card: '[data-testid^="feedItem-by-"], [data-testid="searchScreen"] div[role="link"]:has(a[href*="/post/"]):not(div[role="link"] div[role="link"])',
    metric: '[data-testid="likeBtn"]',
    sort: '[data-testid^="profilePager-selector-"], [data-testid^="homeScreenFeedTabs-selector-"], [data-testid="searchScreen"] [role="tab"]',
  },
};
function regionFor(target: CompatibilityCase) {
  return regions[target.site];
}
async function selectTab(page: Page, target: CompatibilityCase) {
  if (target.tab) {
    // 初期タブが空でも、対象タブへの切り替えは可能。
    // 投稿カードの確認は切り替え後の navigate で行う。
    const navigation =
      target.site === "x" && target.tab === "ポスト"
        ? `a[role="tab"][href=${JSON.stringify(target.destination)}]`
        : target.site === "bluesky" && target.destination === "/search"
          ? `::-p-xpath(//*[@data-testid="searchScreen"]//*[@role="tab" and normalize-space(.)=${JSON.stringify(target.tab)}])`
          : aria("tab", target.tab);
    const locator = page.locator(navigation);
    await locator.wait();
    if (target.site === "bluesky") {
      const selected = await page.$eval(navigation, (node) => {
        const mark = node.querySelector('[style*="background-color"]');
        return (
          !!mark &&
          getComputedStyle(mark).display !== "none" &&
          mark.getBoundingClientRect().height > 0
        );
      });
      if (!selected)
        await locator
          .filter((node) => {
            if (!node.isConnected)
              throw new Error("対象タブが再描画されました");
            const rect = node.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + rect.height / 2;
            // 画面外ならクリック側の自動スクロールに任せる。
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
              return true;
            const hit = document.elementFromPoint(x, y);
            return !!hit && node.contains(hit);
          })
          .click();
    } else if (
      target.site !== "x" ||
      (await page.$eval(navigation, (node) =>
        node.getAttribute("aria-selected"),
      )) !== "true"
    )
      await locator.click();
    if (target.site === "bluesky")
      await expect
        .poll(async () =>
          page.$eval(navigation, (node) => {
            const mark = node.querySelector('[style*="background-color"]');
            return (
              !!mark &&
              getComputedStyle(mark).display !== "none" &&
              mark.getBoundingClientRect().height > 0
            );
          }),
        )
        .toBe(true);
    else if (target.site === "x")
      await expect
        .poll(() =>
          page.$eval(navigation, (node) => node.getAttribute("aria-selected")),
        )
        .toBe("true");
  }
}
async function navigate(
  session: LiveSession,
  page: Page,
  target: CompatibilityCase,
  task: RunnerTask,
  reused: boolean,
) {
  await assertLivePage(session, page);
  if (!reused)
    await retryNameResolution(
      () => page.goto(target.start, { waitUntil: "domcontentloaded" }),
      (message) =>
        evidence(task, "navigation-dns-retry", {
          body: JSON.stringify({ url: target.start, message, retries: 1 }),
          contentType: "application/json",
        }),
    );
  await assertLivePage(session, page);
  if (reused && target.site === "x" && target.destination === "/search")
    await changeXSearch(page, target.start);
  if (target.linkHref)
    await page.locator(`a[href="${target.linkHref}"]`).click();
  for (const href of target.linkHrefs ?? []) {
    // Blueskyの初期レイアウト中に、リンク位置へ重なるフィードタブを押さない。
    await page
      .locator(`a[href="${href}"]`)
      .filter((node) => {
        if (!node.isConnected)
          throw new Error("移動先リンクが再描画されました");
        const rect = node.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
        const hit = document.elementFromPoint(x, y);
        return !!hit && node.contains(hit);
      })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(href);
  }
  if (target.linkLabel) {
    const link = `::-p-xpath(//*[@role="link" or self::a][descendant::*[normalize-space(text()) = ${JSON.stringify(target.linkLabel)}]])`;
    // 一覧内容の取得はページ読み込みと同じ上限で待ち、操作時間と分ける。
    await expect.poll(() => visible(page, link), { timeout: 30000 }).toBe(true);
    await page.locator(link).click();
  }
  await selectTab(page, target);
  if (target.site === "bluesky" && target.destination === "/search")
    await evidence(task, "search-tabs", {
      body: JSON.stringify({
        tabs: await page.$$eval(
          '[data-testid="searchScreen"] [role="tab"]',
          (nodes) =>
            nodes.map((node) => {
              const mark = node.querySelector('[style*="background-color"]');
              return {
                text: node.textContent?.trim(),
                selected: node.getAttribute("aria-selected"),
                marked:
                  !!mark &&
                  getComputedStyle(mark).display !== "none" &&
                  mark.getBoundingClientRect().height > 0,
              };
            }),
        ),
      }),
      contentType: "application/json",
    });
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(target.destination);
  await expect
    .poll(() => visible(page, regionFor(target).card), { timeout: 30000 })
    .toBe(true);
  await assertLivePage(session, page);
}
async function snapshot(
  page: Page,
  target: CompatibilityCase,
): Promise<StructureSnapshot> {
  const selection = regionFor(target);
  const result: StructureSnapshot = {
    schema: 1,
    caseId: target.id,
    route: captureRoute(page.url()),
    regions: {},
  };
  const selections: [string, string][] = [
    target.feed
      ? ["navigation", '[data-testid="customFeedScreen"]']
      : target.list
        ? [
            "navigation",
            target.site === "bluesky"
              ? '[data-testid="profileListScreen"] [data-testid="headerTitle"]'
              : aria("heading"),
          ]
        : ["sort", selection.sort],
    ["card", selection.card],
    ["metric", selection.metric],
  ];
  const cards = await page.$$(selection.card);
  const visibleCards: ElementHandle<Element>[] = [];
  for (const card of cards) if (await card.isVisible()) visibleCards.push(card);
  for (const [name, locator] of selections) {
    const shapes: StructureNode[] = [];
    const selectedCards =
      name === "metric" ? visibleCards.slice(0, 1) : visibleCards;
    const elements =
      name === "metric"
        ? (
            await Promise.all(selectedCards.map((card) => card.$$(locator)))
          ).flat()
        : await page.$$(locator);
    for (const element of elements) {
      if (
        await element.evaluate((node) => {
          for (
            let parent = node.parentElement;
            parent;
            parent = parent.parentElement
          )
            if (parent.hidden || getComputedStyle(parent).display === "none")
              return true;
          return false;
        })
      )
        continue;
      const captured = await element.evaluate(
        captureStructure,
        name === "card" ? 2 : 1,
      );
      // 更新通知はスクロール位置や新着投稿で出入りする。実DOMは変更せず、
      // このフィード領域の任意ボタンだけ比較から除く。
      const shape =
        target.site === "bluesky" && target.feed && name === "navigation"
          ? normalizeBlueskyFeedNavigation(captured)
          : captured;
      if (!shapes.some((s) => JSON.stringify(s) === JSON.stringify(shape)))
        shapes.push(shape);
      if (shapes.length === 8) break;
    }
    expect(shapes.length, `${name} の構造を取得できません`).toBeGreaterThan(0);
    result.regions[name] = shapes.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return result;
}
async function observations(page: Page, target: CompatibilityCase) {
  const selection = regionFor(target);
  const rows = await page.$$eval(
    selection.card,
    (cards, metric) =>
      cards
        .filter((card) => {
          // サイトが別タブ用に退避した一覧は対象外。Siftが隠したカード自身は含める。
          for (
            let parent = card.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            if (parent.hidden || getComputedStyle(parent).display === "none")
              return false;
          }
          return true;
        })
        .map((card) => {
          const cell = card.closest('[data-testid="cellInnerDiv"]') ?? card;
          // 本文の語句ではなく、サイトが表示する投稿種別の案内を読む。
          const quotedCards = [
            ...card.querySelectorAll('div[role="link"]'),
          ].filter((node) =>
            node.querySelector('[data-testid="Tweet-User-Avatar"]'),
          );
          const labels = [...card.querySelectorAll("a, span, div[dir]")]
            .filter(
              (node) =>
                !quotedCards.some(
                  (quoted) => quoted.contains(node) || node.contains(quoted),
                ) &&
                !node.closest(
                  '[data-testid="tweetText"], [data-testid="postText"]',
                ),
            )
            .map((node) => node.textContent?.trim() ?? "")
            .filter((value) => value.length < 120);
          const links = [
            ...card.querySelectorAll('a[href*="/status/"], a[href*="/post/"]'),
          ]
            // 外部サイトの投稿URLや本文中のリンクは、引用カードの証拠ではない。
            .filter((node) => {
              if (
                node.closest(
                  '[data-testid="tweetText"], [data-testid="postText"]',
                )
              )
                return false;
              const url = new URL(
                node.getAttribute("href") ?? "",
                location.href,
              );
              return url.origin === location.origin;
            })
            .map(
              (node) =>
                node
                  .getAttribute("href")
                  ?.match(/\/(?:status|post)\/([^/?#]+)/)?.[1],
            )
            .filter(Boolean);
          return {
            reply:
              labels.some((text) =>
                /^(返信先[:：]|Replying to\b)/i.test(text),
              ) ||
              [...card.querySelectorAll('div[style*="width: 42px"]')].some(
                (column) =>
                  [...column.children].some((line) => {
                    const style = (line as HTMLElement).style;
                    return Boolean(style.backgroundColor && style.marginBottom);
                  }),
              ),
            quote:
              labels.some((text) => /^(引用|Quote)$/.test(text)) ||
              new Set(links).size > 1 ||
              Boolean(
                card.querySelector(
                  '[data-testid="contentHider-post"] div[role="link"] [data-testid="userAvatarImage"]',
                ),
              ),
            repost: labels.some((text) =>
              /(?:がリポスト(?:しました)?$|^あなたのリポスト$|\breposted$)/i.test(
                text,
              ),
            ),
            id:
              card.getAttribute("href") ??
              card
                .querySelector('a[href*="/status/"], a[href*="/post/"]')
                ?.getAttribute("href") ??
              null,
            metrics: [...card.querySelectorAll(metric)].map(
              (e) => e.getAttribute("aria-label") || e.textContent || "",
            ),
            display: getComputedStyle(cell).display,
            visibility: getComputedStyle(cell).visibility,
            filterReason: cell.getAttribute("data-sift-filter-reason"),
            profileHeader: card
              .querySelector('a[href^="/profile/"]')
              ?.textContent?.trim(),
            profileHeaderIcon: card.querySelector('a[href^="/profile/"]')
              ?.firstElementChild?.tagName,
            hiddenAncestors: (() => {
              const hidden: {
                tag: string;
                testId: string | null;
                visibility: string;
                opacity: string;
              }[] = [];
              for (
                let parent = cell.parentElement;
                parent;
                parent = parent.parentElement
              ) {
                const style = getComputedStyle(parent);
                if (style.visibility !== "visible" || style.opacity === "0")
                  hidden.push({
                    tag: parent.tagName,
                    testId: parent.getAttribute("data-testid"),
                    visibility: style.visibility,
                    opacity: style.opacity,
                  });
              }
              return hidden;
            })(),
            visible: cell.checkVisibility({
              checkVisibilityCSS: true,
              checkOpacity: true,
            }),
            height: cell.getBoundingClientRect().height,
            media: Boolean(
              card.querySelector(
                '[data-testid="tweetPhoto"], a[href*="/photo/"] img[src*="pbs.twimg.com/media/"], [data-testid="videoPlayer"], [data-testid="nestedQuotePreviewMedia"], button img[src*="/img/feed_thumbnail/"], [style*="video.bsky.app"], video[src*="t.gifs.bsky.app"]',
              ),
            ),
          };
        }),
    selection.metric,
  );
  return rows.map((row) => ({
    ...row,
    count: parseMetric(row.metrics[0] ?? ""),
  }));
}
async function inclusionFilter(
  session: LiveSession,
  page: Page,
  panel: Page,
  target: CompatibilityCase,
  task: RunnerTask,
) {
  session.loadGuard.setContext(target.id, "minimum-apply");
  const before = await observations(page, target);
  const combo = `[data-minimum-picker] >>> ${aria("combobox")}`;
  await panelClick(await element(panel, combo));
  const options = aria("option");
  await expect.poll(() => visible(panel, options)).toBe(true);
  const available = await panel.$$eval(options, (elements) =>
    elements.map((e, index) => ({
      index,
      label: [...(e.querySelector("[id]") ?? e).childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim(),
      count: Number(
        e
          .querySelector("[data-choice-count]")
          ?.textContent?.replace(/[^\d]/g, ""),
      ),
    })),
  );
  const total = available[0]?.count ?? 0;
  await evidence(task, "filter-options", {
    body: JSON.stringify(available),
    contentType: "application/json",
  });
  const choice = selectPartialChoice(
    available.filter((o) => Number.isFinite(parseMetric(o.label))),
    total,
  );
  let threshold: number;
  if (choice) {
    threshold = parseMetric(choice.label);
    // 投稿の追加取得で候補値と順序が変わるため、観測時のindexを操作に使わない。
    // ラベルが厳密に一致する実要素を保持し、消失・重複は失敗として扱う。
    const currentOptions = await panel.$$(options);
    try {
      const labels = await Promise.all(
        currentOptions.map((option) =>
          option.evaluate((node) =>
            [...(node.querySelector("[id]") ?? node).childNodes]
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .map((child) => child.textContent)
              .join("")
              .trim(),
          ),
        ),
      );
      const matches = currentOptions.filter(
        (_, index) => labels[index] === choice.label,
      );
      expect(
        matches,
        "観測した条件と同じラベルの選択肢が一意であること",
      ).toHaveLength(1);
      const selected = matches[0];
      if (!selected) throw new Error(`選択肢がありません: ${choice.label}`);
      await evidence(task, "filter-choice", {
        body: JSON.stringify({
          label: choice.label,
          threshold,
          observedIndex: choice.index,
          currentIndex: currentOptions.indexOf(selected),
        }),
        contentType: "application/json",
      });
      await panelClick(selected);
    } finally {
      await Promise.all(currentOptions.map((option) => option.dispose()));
    }
  } else {
    const counts = before.map((row) => row.count).filter(Number.isFinite);
    expect(
      counts.length,
      "数値入力の確認に必要な指標がありません",
    ).toBeGreaterThan(0);
    // 同値の投稿しかない場合は、全件が条件を満たす値で操作・誤除外・解除を確認する。
    // 除外効果は0件として記録し、別の代表ページでの確認を配備条件に残す。
    threshold = Math.min(...counts);
    await panelClick(
      await element(panel, `${options} >>> ${text("数値を入力")}`),
    );
    const input = aria("spinbutton", "数値を入力");
    await fillNumber(panel, input, threshold);
    await expect
      .poll(() =>
        panel.$eval(input, (node) => (node as HTMLInputElement).value),
      )
      .toBe(String(threshold));
  }
  // UI操作だけでなく、選んだ条件の保存完了を待つ。非同期の初期化との競合を検出する。
  const storageClient = await panel.createCDPSession();
  try {
    await expect
      .poll(async () => {
        const saved = (await callFunction(
          storageClient,
          "() => chrome.storage.sync.get('settings')",
          [],
          workerCommandTimeout,
        )) as {
          settings?: {
            siteSettings?: Record<
              string,
              {
                minReactionsEnabled?: boolean;
                minReactions?: number;
              }
            >;
          };
        };
        const stored = saved.settings?.siteSettings?.[target.site];
        return (
          stored?.minReactionsEnabled === true &&
          stored.minReactions === threshold
        );
      })
      .toBe(true);
  } finally {
    await storageClient.detach();
  }
  let lastRows: Awaited<ReturnType<typeof observations>> = [];
  try {
    await expect
      .poll(async () => {
        const rows = await observations(page, target);
        lastRows = rows;
        return (
          rows.length > 0 &&
          rows.every(
            (r) =>
              Number.isFinite(r.count) &&
              (r.count >= threshold ? r.visible && r.height > 0 : !r.visible),
          )
        );
      })
      .toBe(true);
  } finally {
    await evidence(task, "filter-observations", {
      body: JSON.stringify({ threshold, rows: lastRows }),
      contentType: "application/json",
    });
  }
  // 非同期で入れ替わる一覧は、条件と表示の一致を確認した同じ観測で判定する。
  const filtered = lastRows;
  const excludedBefore = before.filter((r) => r.count < threshold);
  expect(
    excludedBefore.every(
      (r) =>
        r.id && !filtered.some((after) => after.id === r.id && after.visible),
    ),
  ).toBe(true);
  expect(filtered.some((r) => r.visible)).toBe(
    filtered.some((r) => r.count >= threshold),
  );
  session.loadGuard.setContext(target.id, "minimum-clear");
  await panelClick(await element(panel, combo));
  await panelClick(await element(panel, aria("option")));
  await expect
    .poll(async () =>
      (await observations(page, target)).every(
        (r) => r.visible && r.height > 0,
      ),
    )
    .toBe(true);
  return {
    applied: true,
    cleared: true,
    noOverfilter: true,
    threshold,
    visible: filtered.filter((r) => r.visible).length,
    hidden: excludedBefore.length,
    status: excludedBefore.length ? "verified" : "operation-only",
  };
}
async function categoricalFilter(
  session: LiveSession,
  page: Page,
  panel: Page,
  target: CompatibilityCase,
  kind: "media" | "reply" | "quote" | "repost",
  task: RunnerTask,
) {
  const before = await observations(page, target);
  expect(before.length, "操作前の投稿が必要です").toBeGreaterThan(0);
  const excludes = (row: (typeof before)[number]) =>
    kind === "media" ? !row.media : row[kind];
  const excluded = before.filter(excludes);
  const apply = async (enabled: boolean) => {
    if (kind === "media") {
      await panelClick(
        await element(panel, aria("combobox", "コンテンツタイプ")),
      );
      await panelClick(
        await element(
          panel,
          aria("option", enabled ? "画像・動画のみ" : "すべて"),
        ),
      );
      await expect
        .poll(() =>
          panel.$eval(aria("combobox", "コンテンツタイプ"), (node) =>
            (node.textContent ?? "").trim(),
          ),
        )
        .toBe(enabled ? "画像・動画のみ" : "すべて");
    } else {
      const toggle = aria(
        "switch",
        {
          reply: "返信を除外",
          quote: "引用投稿を除外",
          repost: "リポストを除外",
        }[kind],
      );
      if (
        (await (
          await element(panel, toggle)
        ).evaluate((node, name) => node.getAttribute(name), "aria-checked")) !==
        String(enabled)
      )
        await panelClick(await element(panel, toggle));
      await expect
        .poll(() =>
          panel.$eval(
            toggle,
            (node, name) => node.getAttribute(name),
            "aria-checked",
          ),
        )
        .toBe(String(enabled));
    }
  };
  try {
    session.loadGuard.setContext(target.id, `${kind}-apply`);
    await apply(true);
    await expect
      .poll(async () =>
        (await observations(page, target)).every((row) =>
          excludes(row) ? !row.visible : row.visible,
        ),
      )
      .toBe(true);
    const after = await observations(page, target);
    if (before.some((row) => !excludes(row)))
      expect(
        after.some((row) => !excludes(row) && row.visible),
        "条件に合う投稿が残ること",
      ).toBe(true);
    expect(
      excluded.every(
        (row) =>
          row.id && !after.some((item) => item.id === row.id && item.visible),
      ),
    ).toBe(true);
  } finally {
    await evidence(task, `${kind}-observations`, {
      body: JSON.stringify({
        before,
        after: await observations(page, target),
        context: await readContext(session, page),
      }),
      contentType: "application/json",
    });
    session.loadGuard.setContext(target.id, `${kind}-clear`);
    await apply(false);
  }
  await expect
    .poll(async () => {
      const rows = await observations(page, target);
      return (
        rows.length > 0 && rows.every((row) => row.visible && row.height > 0)
      );
    })
    .toBe(true);
  await evidence(task, `${kind}-filter`, {
    body: JSON.stringify({
      excluded: excluded.length,
      status: excluded.length ? "verified" : "operation-only",
      applied: true,
      cleared: true,
      noOverfilter: true,
    }),
    contentType: "application/json",
  });
}
export function createCompatibilityCases(): LiveCase[] {
  const entries: LiveCase[] = [];
  for (const target of groupByEntry(cases, compatibilityEntry)) {
    const entry = compatibilityEntry(target);
    entries.push({
      id: target.id,
      entry,
      run: async (session, task) => {
        const { page, reused } = await acquireCasePage(session, entry);
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(30000);
        let cleanupError: unknown;
        let healthy = false;
        try {
          // 保存済みの強い条件で初期一覧を隠し、サイトの追加取得を誘発しない。
          // UIからの適用・解除と起動後の「指定なし」確認は、この後で個別に行う。
          await session.api.evaluate(`(async (site) => {
          const stored = await chrome.storage.sync.get('settings');
          const settings = stored.settings ?? {siteSettings:{}};
          const previous = settings.siteSettings?.[site] ?? {};
          const cleared = {...previous,minReactionsEnabled:false,mediaEnabled:false,mediaMode:'any',hideReplies:false,hideQuotes:false,hideReposts:false};
          if(JSON.stringify(previous) !== JSON.stringify(cleared)) {
            await chrome.storage.sync.set({settings:{...settings,siteSettings:{...settings.siteSettings,[site]:cleared}}});
          }
        })(${JSON.stringify(target.site)})`);
          await page.bringToFront();
          session.loadGuard.setContext(target.id, "navigate");
          await navigate(session, page, target, task, reused);
          await evidence(task, "page-load", {
            body: JSON.stringify({
              entry: target.start,
              reused,
              firstNavigation: !reused,
            }),
            contentType: "application/json",
          });
          session.loadGuard.setContext(target.id, "open-panel");
          const panel = await openPanel(session, page);
          await expect
            .poll(() => visible(panel, aria("heading", "最低いいね数")))
            .toBe(true);
          await expect
            .poll(async () => (await readContext(session, page)).health?.state)
            .toBe("ready");
          const context = await readContext(session, page);
          expect(context.site).toBe(target.site);
          expect(context.timelineAvailable).toBe(true);
          for (const toggle of await panel.$$(aria("switch"))) {
            if (
              (await toggle.evaluate((node) =>
                node.getAttribute("aria-checked"),
              )) === "true"
            ) {
              await panelClick(toggle);
              await expect
                .poll(() =>
                  toggle.evaluate((node) => node.getAttribute("aria-checked")),
                )
                .toBe("false");
            }
          }
          if (target.site === "x" || target.site === "bluesky") {
            const typePicker = aria("combobox", "コンテンツタイプ");
            if (
              (await panel.$eval(typePicker, (node) =>
                node.textContent?.trim(),
              )) !== "すべて"
            ) {
              await panelClick(await element(panel, typePicker));
              await panelClick(await element(panel, aria("option", "すべて")));
            }
          }
          const minimum = `[data-minimum-picker] >>> ${aria("combobox")}`;
          await panelClick(await element(panel, minimum));
          await panelClick(await element(panel, aria("option")));
          await expect
            .poll(async () => {
              const rows = await observations(page, target);
              return (
                rows.length > 0 &&
                rows.every((row) => row.visible && row.height > 0)
              );
            })
            .toBe(true);
          const structure = await snapshot(page, target);
          await completeInitialLoad(session, page, task, "ready");
          await evidence(task, "structure", {
            body: JSON.stringify(structure),
            contentType: "application/json",
          });
          // 基準未登録も失敗。更新は明示的な --update だけで行う。
          await expect
            .soft(JSON.stringify(structure, null, 2))
            .toMatchFileSnapshot(
              `../test/compatibility-baselines/${target.id}.json`,
            );
          if (target.site === "x" || target.site === "bluesky") {
            for (const kind of ["media", "reply", "quote", "repost"] as const)
              await categoricalFilter(session, page, panel, target, kind, task);
            // 全条件の解除を確認し、同じ一覧の先頭を最低値の独立した観測に使う。
            // 復元できなければ再読込で隠さず、このケースの失敗として記録する。
            const pageKey = (await readContext(session, page)).pageKey;
            await page.evaluate(() => window.scrollTo(0, 0));
            await expect
              .poll(() => visible(page, regionFor(target).card), {
                timeout: 30000,
              })
              .toBe(true);
            await expect
              .poll(
                async () => (await readContext(session, page)).health?.state,
              )
              .toBe("ready");
            await expect
              .poll(async () => (await readContext(session, page)).pageKey)
              .toBe(pageKey);
            await expect
              .poll(async () => {
                const rows = await observations(page, target);
                return (
                  rows.length > 0 &&
                  rows.every((row) => row.visible && row.height > 0)
                );
              })
              .toBe(true);
            await evidence(task, "restored-list", {
              body: JSON.stringify({
                pageKey,
                reloaded: false,
                rows: await observations(page, target),
              }),
              contentType: "application/json",
            });
          }
          // 最低値は追加読み込みを大きく進めることがあるため、種別の確認後に行う。
          {
            const result = await inclusionFilter(
              session,
              page,
              panel,
              target,
              task,
            );
            await evidence(task, "minimum-filter", {
              body: JSON.stringify(result),
              contentType: "application/json",
            });
          }
          await evidence(task, "candidate", {
            body: JSON.stringify(session.candidate),
            contentType: "application/json",
          });
          healthy = true;
        } catch (error) {
          await evidence(task, "failure-cause", {
            body: JSON.stringify({
              message: String(error),
              stack: error instanceof Error ? error.stack : undefined,
            }),
            contentType: "application/json",
          });
          await evidence(task, "failure-navigation", {
            body: JSON.stringify({
              url: page.url(),
              title: await page.title(),
              visibility: await page.evaluate(() => document.visibilityState),
              tabs: await page.$$eval('[role="tab"]', (nodes) =>
                nodes.map((node) => {
                  const r = node.getBoundingClientRect();
                  const hit = document.elementFromPoint(
                    r.x + r.width / 2,
                    r.y + r.height / 2,
                  );
                  return {
                    text: node.textContent,
                    href: node.getAttribute("href"),
                    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                    hit: hit?.outerHTML.slice(0, 500),
                  };
                }),
              ),
            }),
            contentType: "application/json",
          });
          await evidence(task, "failure-tabs", {
            body: JSON.stringify({
              pageUrl: page.url(),
              tabs: await session.api.evaluate(
                "chrome.tabs.query({}).then(tabs=>tabs.map(({id,url,active})=>({id,url,active})))",
              ),
            }),
            contentType: "application/json",
          });
          await evidence(task, "failure-context", {
            body: JSON.stringify(
              await readContext(session, page).catch((problem) => ({
                error: String(problem),
              })),
            ),
            contentType: "application/json",
          });
          throw error;
        } finally {
          try {
            await closePanel(session, page);
          } catch (error) {
            await evidence(task, "cleanup-error", {
              body: String(error),
              contentType: "text/plain",
            });
            cleanupError = error;
          } finally {
            await releaseCasePage(session, entry, healthy && !cleanupError);
          }
        }
        if (cleanupError) throw cleanupError;
      },
    });
  }
  return entries;
}
