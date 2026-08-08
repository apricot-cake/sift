// The contract every per-service adapter satisfies. Held here rather than
// inferred from one adapter so x.ts, bluesky.ts and misskey.ts are checked
// against the same shape instead of each other.
import type { MessageKey } from "../i18n.ts";
import type { ThresholdKeys } from "../settings.ts";

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

// What the toolbar's two threshold rows are called on this service. Message
// names rather than words, because the word is not a slot a sentence can be
// built around: "Standard: minimum likes" and "通常の最低いいね数" put it in
// different places, and a service that counted something else again might need
// a different sentence altogether.
export interface ReactionLabelKeys {
  readonly minCount: MessageKey;
  readonly risingMinCount: MessageKey;
}

// The two sets that exist, next to each other rather than repeated in the
// adapters — the same arrangement as the threshold keys they go with
// (LIKE_THRESHOLDS and MISSKEY_REACTION_THRESHOLDS in utils/settings.ts).
export const LIKE_LABELS: ReactionLabelKeys = Object.freeze({
  minCount: "toolbarMinLikes",
  risingMinCount: "toolbarRisingMinLikes",
});

export const REACTION_LABELS: ReactionLabelKeys = Object.freeze({
  minCount: "toolbarMinReactions",
  risingMinCount: "toolbarRisingMinReactions",
});

export interface ServiceAdapter {
  readonly id: string;
  // The match patterns the manifest registers for this service. Empty for a
  // service Sift is never registered for at build time — Misskey, whose hosts
  // the reader adds one at a time (utils/instances.ts).
  readonly matches: readonly string[];
  // What this service calls the reaction the thresholds count.
  readonly reactionLabels: ReactionLabelKeys;
  // Which stored thresholds that reaction count is compared against.
  readonly thresholdKeys: ThresholdKeys;

  getPostCards(root: ParentNode): Element[];
  hasPostCards(root: ParentNode): boolean;
  // The unit that gets hidden — not always the post card itself.
  findPostCell(postCard: Element): Element;
  readReactionCount(postCard: Element): number;
  // NaN when the post's creation time cannot be read.
  readCreatedAt(postCard: Element): number;
  readMedia(postCard: Element): PostMedia;
  readIsRepost(postCard: Element): boolean;
}
