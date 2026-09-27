import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  captureRoute,
  captureStructure,
  type StructureNode,
  type StructureSnapshot,
} from "../scripts/compatibility/structure.ts";
import { parseMetric } from "../utils/filter-core.ts";
import { type CompatibilityCase, cases } from "./cases.ts";
import {
  closePanel,
  connectLive,
  finishLive,
  type LiveSession,
  openPanel,
  readContext,
} from "./live.ts";

let session: LiveSession;

// サイドパネルでは背景タブ扱いでrequestAnimationFrameが停止することがある。
// 可視・有効を確認し、安定性待ちだけを省いてCDPの実ポインター入力を送る。
async function panelClick(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.click({ force: true });
}
test.beforeAll(async () => {
  session = await connectLive();
});
test.afterAll(async () => {
  if (session) await finishLive(session);
});

const regions = {
  youtube: {
    card: "ytd-browse:not([hidden]) ytd-rich-item-renderer",
    metric:
      "#metadata-line span, .ytContentMetadataViewModelMetadataText, [class*='MetadataSubhead']",
    sort: 'ytd-browse:not([hidden]) [role="combobox"], ytd-browse:not([hidden]) button[role="tab"], ytd-browse:not([hidden]) yt-chip-cloud-chip-renderer',
  },
  niconico: {
    card: "[data-decoration-video-id], [data-video-id], .NC-VideoMediaObject, main article",
    metric: ".NC-VideoMetaCount_view, time + *, p span",
    sort: ".Selectbox-label",
  },
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

async function selectTab(page: Page, target: CompatibilityCase) {
  if (target.tab) {
    const navigation =
      target.site === "niconico"
        ? page.getByRole("link", { name: target.tab, exact: true })
        : page.getByRole("tab", { name: target.tab, exact: true });
    await navigation.first().click();
    if (target.site === "bluesky")
      await expect(
        navigation.first().locator('[style*="background-color"]').first(),
      ).toBeVisible();
    else if (target.site === "x")
      await expect(navigation.first()).toHaveAttribute("aria-selected", "true");
  }
}

async function navigate(page: Page, target: CompatibilityCase) {
  await page.goto(target.start, { waitUntil: "domcontentloaded" });
  if (target.linkHref)
    await page.locator(`a[href="${target.linkHref}"]`).click();
  if (target.linkLabel)
    await page
      .getByRole("link")
      .filter({ has: page.getByText(target.linkLabel, { exact: true }) })
      .click();
  await selectTab(page, target);
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(target.destination);
  if (target.niconicoSort) {
    const sort = page.locator(".Selectbox-button");
    await expect(sort).toBeVisible();
    if ((await sort.innerText()).trim() !== target.niconicoSort) {
      await sort.click();
      await page.getByText(target.niconicoSort, { exact: true }).click();
    }
    await expect(sort).toHaveText(target.niconicoSort);
    const query = new URL(page.url()).searchParams;
    expect(query.get("sortKey") ?? "registeredAt").toBe(
      target.niconicoSort === "再生数が多い順" ? "viewCount" : "registeredAt",
    );
    expect(query.get("sortOrder") ?? "desc").toBe("desc");
  }
  if (target.sort) {
    const label =
      target.sort === "popular"
        ? /^(人気の動画|Popular|Most popular)$/
        : /^(新しい順|Latest|Newest)$/;
    const combo = page.locator('ytd-browse:not([hidden]) [role="combobox"]');
    await expect(
      combo.or(page.getByRole("tab", { name: label })).first(),
    ).toBeVisible();
    if (await combo.count()) {
      if (!label.test((await combo.first().innerText()).trim())) {
        await combo.first().click();
        await page.getByRole("menuitem", { name: label }).click();
      }
    } else {
      await page.getByRole("tab", { name: label }).click();
    }
  }
  if (target.membersOnly) {
    const tab = page.getByRole("tab", { name: "メンバー限定", exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(
        async () =>
          await page.locator(regions.youtube.card).first().innerText(),
      )
      .toContain("メンバー限定");
  }
  await expect(
    page.locator(regions[target.site].card).filter({ visible: true }).first(),
  ).toBeVisible();
}

async function snapshot(
  page: Page,
  target: CompatibilityCase,
): Promise<StructureSnapshot> {
  const selection = regions[target.site];
  const result: StructureSnapshot = {
    schema: 1,
    caseId: target.id,
    route: captureRoute(page.url()),
    regions: {},
  };
  const selections: [string, Locator][] = [
    target.list
      ? [
          "navigation",
          target.site === "bluesky"
            ? page.locator(
                '[data-testid="profileListScreen"] [data-testid="headerTitle"]',
              )
            : page.getByRole("heading"),
        ]
      : ["sort", page.locator(selection.sort)],
    ["card", page.locator(selection.card)],
    [
      "metric",
      page
        .locator(selection.card)
        .filter({ visible: true })
        .first()
        .locator(selection.metric),
    ],
  ];
  if (target.site === "youtube" && !target.destination.endsWith("/shorts")) {
    selections.push([
      "date",
      page
        .locator(selection.card)
        .first()
        .locator(selection.metric)
        .filter({ hasText: /前|ago/i }),
    ]);
  }
  for (const [name, locator] of selections) {
    const shapes: StructureNode[] = [];
    for (const element of await locator.all()) {
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
      const shape = await element.evaluate(
        captureStructure,
        name === "card" ? 2 : 1,
      );
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
  const selection = regions[target.site];
  const rows = await page.locator(selection.card).evaluateAll(
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
          const cell =
            card.closest(
              '[data-testid="cellInnerDiv"], ytd-rich-item-renderer',
            ) ?? card;
          // 本文の語句ではなく、サイトが表示する投稿種別の案内を読む。
          const labels = [...card.querySelectorAll("a, span, div[dir]")]
            .filter(
              (node) =>
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
              card
                .querySelector(
                  'a[href*="/status/"], a[href*="/post/"], a[href*="/watch"], a[href*="/shorts/"]',
                )
                ?.getAttribute("href") ?? null,
            date:
              card.querySelector("time[datetime]")?.getAttribute("datetime") ||
              card.querySelector(".NC-VideoRegisteredAtText-text")
                ?.textContent ||
              "",
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
                '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="nestedQuotePreviewMedia"], button img[src*="/img/feed_thumbnail/"], [style*="video.bsky.app"], video[src*="t.gifs.bsky.app"]',
              ),
            ),
            members: [
              ...card.querySelectorAll(
                "[aria-label], yt-badge-view-model, .badge",
              ),
            ].some((node) =>
              /^(メンバー限定|Members only)$/i.test(
                (
                  node.getAttribute("aria-label") ||
                  node.textContent ||
                  ""
                ).trim(),
              ),
            ),
          };
        }),
    selection.metric,
  );
  return rows.map((row) => ({
    ...row,
    count: parseMetric(
      target.site === "youtube"
        ? (row.metrics.find((t) => /回視聴|views/i.test(t)) ?? "")
        : (row.metrics[0] ?? ""),
    ),
    ageDays:
      target.site === "niconico"
        ? (Date.now() - Date.parse(row.date)) / 86400000
        : youtubeAge(row.metrics.find((t) => /前|ago/i.test(t)) ?? ""),
  }));
}

// テスト側の独立した期待値。未対応表記を0日として合格させない。
function youtubeAge(text: string): number {
  const match = text.match(
    /([\d.]+)\s*(秒|分|時間|日|週間|か月|ヶ月|年|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*(前|ago)/i,
  );
  if (!match) return Number.NaN;
  const unit = match[2]?.toLowerCase() ?? "";
  const multiplier = /^(秒|second)/.test(unit)
    ? 1 / 86400
    : /^(分|minute)/.test(unit)
      ? 1 / 1440
      : /^(時間|hour)/.test(unit)
        ? 1 / 24
        : /^(日|day)/.test(unit)
          ? 1
          : /^(週間|week)/.test(unit)
            ? 7
            : /^(か月|ヶ月|month)/.test(unit)
              ? 30
              : 365;
  return Number(match[1]) * multiplier;
}

async function minimumFilter(
  page: Page,
  panel: Page,
  target: CompatibilityCase,
) {
  const before = await observations(page, target);
  const combo = panel.locator("[data-minimum-picker]").getByRole("combobox");
  await panelClick(combo);
  const options = panel.getByRole("option");
  await expect(options.first()).toBeVisible();
  const available = await options.evaluateAll((elements) =>
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
  await test.info().attach("filter-options", {
    body: JSON.stringify(available),
    contentType: "application/json",
  });
  const choice = available.find(
    (o) =>
      o.index > 0 &&
      o.count > 0 &&
      o.count < total &&
      Number.isFinite(
        target.period ? periodDays(o.label) : parseMetric(o.label),
      ),
  );
  let threshold: number;
  if (choice) {
    threshold = target.period
      ? periodDays(choice.label)
      : parseMetric(choice.label);
    await panelClick(options.nth(choice.index));
  } else if (target.period) {
    const ages = [
      ...new Set(
        (await observations(page, target))
          .map((r) => r.ageDays)
          .filter(Number.isFinite),
      ),
    ].sort((a, b) => a - b);
    expect(
      ages.length,
      "期間の適用を確認できる投稿日が必要です",
    ).toBeGreaterThan(1);
    threshold = Math.ceil(((ages[0] ?? 0) + (ages[1] ?? 0)) / 2);
    await panelClick(options.getByText("期間を入力", { exact: true }));
    const input = panel.getByRole("spinbutton", {
      name: "投稿期間",
      exact: true,
    });
    await input.fill(String(threshold));
    await input.press("Enter");
  } else {
    const counts = before.map((row) => row.count).filter(Number.isFinite);
    expect(
      counts.length,
      "数値入力の確認に必要な指標がありません",
    ).toBeGreaterThan(0);
    // 同値の投稿しかない場合は、全件が条件を満たす値で操作・誤除外・解除を確認する。
    // 除外効果は0件として記録し、別の代表ページでの確認を配備条件に残す。
    threshold = Math.min(...counts);
    await panelClick(options.getByText("数値を入力", { exact: true }));
    const input = panel.getByRole("spinbutton", {
      name: "数値を入力",
      exact: true,
    });
    await input.fill(String(threshold));
    await input.press("Enter");
    await expect(input).toHaveValue(String(threshold));
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
              Number.isFinite(target.period ? r.ageDays : r.count) &&
              ((target.period ? r.ageDays <= threshold : r.count >= threshold)
                ? r.visible && r.height > 0
                : !r.visible),
          )
        );
      })
      .toBe(true);
  } finally {
    await test.info().attach("filter-observations", {
      body: JSON.stringify({ threshold, rows: lastRows }),
      contentType: "application/json",
    });
  }
  const filtered = await observations(page, target);
  const excludedBefore = before.filter((r) =>
    target.period ? r.ageDays > threshold : r.count < threshold,
  );
  expect(
    excludedBefore.every(
      (r) =>
        r.id && !filtered.some((after) => after.id === r.id && after.visible),
    ),
  ).toBe(true);
  expect(filtered.some((r) => r.visible)).toBe(true);
  await panelClick(combo);
  await panelClick(panel.getByRole("option").first());
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

function periodDays(label: string): number {
  const match = label.match(/(\d+)\s*(週間|か月|ヶ月|年)/);
  return match
    ? Number(match[1]) *
        (match[2] === "週間" ? 7 : match[2] === "年" ? 365 : 30)
    : Number.NaN;
}

async function newerFilter(page: Page, panel: Page, target: CompatibilityCase) {
  const before = await observations(page, target);
  const ages = [
    ...new Set(before.map((row) => row.ageDays).filter(Number.isFinite)),
  ].sort((a, b) => a - b);
  expect(
    ages.length,
    "新しい動画の除外を確認できる投稿日が必要です",
  ).toBeGreaterThan(1);
  const wantedHours = Math.max(
    1,
    Math.round(((ages[0] ?? 0) + (ages[1] ?? 0)) * 12),
  );
  const unitHours = wantedHours <= 1000 ? 1 : wantedHours <= 24000 ? 24 : 168;
  const amount = Math.max(1, Math.round(wantedHours / unitHours));
  const hours = amount * unitHours;
  const group = panel.getByRole("group", {
    name: "新しい動画を除外",
    exact: true,
  });
  const input = group.getByRole("spinbutton");
  await input.fill(String(amount));
  await input.press("Enter");
  await panelClick(group.getByRole("combobox"));
  await panelClick(
    panel.getByRole("option", {
      name: unitHours === 1 ? "時間" : unitHours === 24 ? "日" : "週間",
      exact: true,
    }),
  );
  await expect(input).toHaveValue(String(amount));
  const toggle = group.getByRole("switch");
  await panelClick(toggle);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () =>
      (await observations(page, target)).every(
        (row) =>
          Number.isFinite(row.ageDays) &&
          (row.ageDays * 24 < hours ? !row.visible : row.visible),
      ),
    )
    .toBe(true);
  const filtered = await observations(page, target);
  const excluded = before.filter((row) => row.ageDays * 24 < hours);
  expect(excluded.length).toBeGreaterThan(0);
  expect(
    excluded.every(
      (row) =>
        row.id &&
        !filtered.some((after) => after.id === row.id && after.visible),
    ),
  ).toBe(true);
  expect(filtered.some((row) => row.visible)).toBe(true);
  await panelClick(toggle);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(async () =>
      (await observations(page, target)).every(
        (row) => row.visible && row.height > 0,
      ),
    )
    .toBe(true);
  await test.info().attach("newer-filter", {
    body: JSON.stringify({
      hours,
      excluded: excluded.length,
      applied: true,
      cleared: true,
      noOverfilter: true,
    }),
    contentType: "application/json",
  });
}

async function categoricalFilter(
  page: Page,
  panel: Page,
  target: CompatibilityCase,
  kind: "media" | "members" | "reply" | "quote" | "repost",
) {
  const before = await observations(page, target);
  expect(before.length, "操作前の投稿が必要です").toBeGreaterThan(0);
  const excludes = (row: (typeof before)[number]) =>
    kind === "media" ? !row.media : row[kind];
  const excluded = before.filter(excludes);
  const apply = async (enabled: boolean) => {
    if (kind === "media") {
      await panelClick(
        panel.getByRole("combobox", { name: "コンテンツタイプ", exact: true }),
      );
      await panelClick(
        panel.getByRole("option", {
          name: enabled ? "画像・動画のみ" : "すべて",
          exact: true,
        }),
      );
      await expect(
        panel.getByRole("combobox", { name: "コンテンツタイプ", exact: true }),
      ).toHaveText(enabled ? "画像・動画のみ" : "すべて");
    } else {
      const toggle = panel.getByRole("switch", {
        name: {
          members: "メンバー限定を除外",
          reply: "返信を除外",
          quote: "引用投稿を除外",
          repost: "リポストを除外",
        }[kind],
        exact: true,
      });
      if ((await toggle.getAttribute("aria-checked")) !== String(enabled))
        await panelClick(toggle);
      await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    }
  };
  try {
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
    await test.info().attach(`${kind}-observations`, {
      body: JSON.stringify({
        before,
        after: await observations(page, target),
        context: await readContext(session, page),
      }),
      contentType: "application/json",
    });
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
  await test.info().attach(`${kind}-filter`, {
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

for (const target of cases) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwrightはfixture引数の分割代入を要求する。
  test(target.id, async ({}, testInfo) => {
    const page = await session.context.newPage();
    let cleanupError: unknown;
    try {
      await page.bringToFront();
      await navigate(page, target);
      const panel = await openPanel(session, page);
      await expect(
        panel.getByRole("heading", {
          name: target.period
            ? "投稿期間"
            : target.site === "x" || target.site === "bluesky"
              ? "最低いいね数"
              : "最低再生回数",
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe(target.membersOnly ? "degraded" : "ready");
      const context = await readContext(session, page);
      expect(context.site).toBe(target.site);
      expect(context.timelineAvailable).toBe(true);
      if (target.sort) expect(context.sortOrder).toBe(target.sort);
      for (const toggle of await panel.getByRole("switch").all()) {
        if ((await toggle.getAttribute("aria-checked")) === "true") {
          await panelClick(toggle);
          await expect(toggle).toHaveAttribute("aria-checked", "false");
        }
      }
      if (target.site === "x" || target.site === "bluesky") {
        await panelClick(
          panel.getByRole("combobox", {
            name: "コンテンツタイプ",
            exact: true,
          }),
        );
        await panelClick(
          panel.getByRole("option", { name: "すべて", exact: true }),
        );
      }
      const structure = await snapshot(page, target);
      // 基準未登録も失敗。更新は明示的な --update-snapshots だけで行う。
      expect
        .soft(JSON.stringify(structure, null, 2))
        .toMatchSnapshot(`${target.id}.json`);
      if (
        (target.site === "youtube" &&
          !target.membersOnly &&
          !target.period &&
          !target.destination.endsWith("/shorts")) ||
        target.site === "niconico"
      ) {
        await newerFilter(page, panel, target);
      }
      if (target.site === "youtube")
        await categoricalFilter(page, panel, target, "members");
      if (target.site === "x" || target.site === "bluesky") {
        for (const kind of ["media", "reply", "quote", "repost"] as const)
          await categoricalFilter(page, panel, target, kind);
        // 仮想化で差し替わった表示範囲を戻し、最低値を独立した一覧で検証する。
        await page.reload({ waitUntil: "domcontentloaded" });
        await selectTab(page, target);
        await expect(
          page
            .locator(regions[target.site].card)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
        await expect
          .poll(async () => (await readContext(session, page)).health?.state)
          .toBe("ready");
      }
      // 最低値は追加読み込みを大きく進めることがあるため、種別の確認後に行う。
      if (!target.membersOnly) {
        const result = await minimumFilter(page, panel, target);
        await testInfo.attach(
          target.period ? "period-filter" : "minimum-filter",
          {
            body: JSON.stringify(result),
            contentType: "application/json",
          },
        );
      }
      await testInfo.attach("candidate", {
        body: JSON.stringify(session.candidate),
        contentType: "application/json",
      });
    } finally {
      try {
        await closePanel(session, page);
      } catch (error) {
        await testInfo.attach("cleanup-error", {
          body: String(error),
          contentType: "text/plain",
        });
        cleanupError = error;
      } finally {
        await page.close();
      }
    }
    if (cleanupError) throw cleanupError;
  });
}
