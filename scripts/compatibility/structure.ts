export interface StructureNode {
  tag: string;
  role?: string;
  testId?: string;
  attributes?: string[];
  children?: StructureNode[];
}

/** 並び順の意味を持つURL引数だけを残し、検索語・追跡用引数を除く。 */
export function captureRoute(input: string): string {
  const url = new URL(input);
  const query = new URLSearchParams();
  for (const key of ["f", "filter", "sort", "sortKey", "sortOrder"]) {
    for (const value of url.searchParams.getAll(key).sort())
      query.append(key, value);
  }
  return url.pathname + (query.size ? `?${query}` : "");
}

/** ブラウザ内でも実行する自己完結関数。テキストと属性値は保存しない。 */
export function captureStructure(element: Element, depth = 12): StructureNode {
  const visit = (node: Element, remaining: number): StructureNode => {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute("role");
    const rawTestId = node.getAttribute("data-testid");
    // 投稿者名や投稿IDを含むtestidは形式だけを残す。
    const testId = rawTestId
      ?.replace(/^unlike$/, "like")
      ?.replace(/((?:feedItem|postThreadItem)-by-).+/, "$1*")
      .replace(/\d+/g, "#");
    const attributes = [
      "aria-label",
      "aria-selected",
      "datetime",
      "href",
      "src",
      "title",
    ].filter((name) => node.hasAttribute(name));
    const children =
      remaining > 0
        ? Array.from(node.children)
            .filter(
              (child) =>
                !["SCRIPT", "STYLE", "SVG", "IMG"].includes(child.tagName),
            )
            .map((child) => visit(child, remaining - 1))
        : [];
    // 投稿件数や同形のメタデータの繰り返し数は、構造変更としない。
    const unique = children.filter(
      (child, index) =>
        index === 0 ||
        JSON.stringify(child) !== JSON.stringify(children[index - 1]),
    );
    return {
      tag,
      ...(role ? { role } : {}),
      ...(testId ? { testId } : {}),
      ...(attributes.length ? { attributes } : {}),
      ...(unique.length ? { children: unique } : {}),
    };
  };
  return visit(element, depth);
}

export interface StructureSnapshot {
  schema: 1;
  caseId: string;
  route: string;
  regions: Record<string, StructureNode[]>;
}

export interface StructureDifference {
  region: string;
  kind: "added" | "removed" | "changed";
}

export function compareStructures(
  baseline: StructureSnapshot,
  current: StructureSnapshot,
): StructureDifference[] {
  if (baseline.schema !== current.schema || baseline.caseId !== current.caseId)
    throw new Error("構造基準の形式または検証ケースが一致しません");
  const differences: StructureDifference[] = [];
  if (baseline.route !== current.route)
    differences.push({ region: "route", kind: "changed" });
  for (const name of new Set([
    ...Object.keys(baseline.regions),
    ...Object.keys(current.regions),
  ])) {
    const before = baseline.regions[name] ?? [];
    const after = current.regions[name] ?? [];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    differences.push({
      region: name,
      kind:
        before.length === 0
          ? "added"
          : after.length === 0
            ? "removed"
            : "changed",
    });
  }
  return differences;
}
