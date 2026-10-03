import { FILTER_CONTEXT_METRIC_LIMIT } from "../filter-context.ts";

export interface MetricCards {
  readonly cards: readonly Element[];
  readonly truncated: boolean;
}
// 全件のNodeListを作らず、候補カード数と走査要素数の両方で集計を打ち切る。
export function collectMetricCards(
  root: ParentNode,
  readCard: (element: Element) => Element | null,
  readKey: (card: Element) => Element = (card) => card,
  maxVisitedElements = 100_000,
  maxCards = FILTER_CONTEXT_METRIC_LIMIT,
): MetricCards {
  if (
    !Number.isSafeInteger(maxCards) ||
    maxCards < 1 ||
    maxCards > FILTER_CONTEXT_METRIC_LIMIT
  )
    throw new RangeError("Invalid metric card limit");
  if (
    !Number.isSafeInteger(maxVisitedElements) ||
    maxVisitedElements < 1 ||
    maxVisitedElements > 100_000
  )
    throw new RangeError("Invalid metric traversal limit");
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const cards: Element[] = [];
  const keys = new Set<Element>();
  let visited = 0;
  while (true) {
    const element = walker.nextNode();
    if (element === null) return { cards, truncated: false };
    if (++visited > maxVisitedElements) return { cards, truncated: true };
    const card = readCard(element as Element);
    if (card === null) continue;
    const key = readKey(card);
    if (keys.has(key)) continue;
    if (cards.length === maxCards) return { cards, truncated: true };
    keys.add(key);
    cards.push(card);
  }
}
