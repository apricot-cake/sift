// The contract every per-service adapter satisfies. Held here rather than
// inferred from one adapter so both x.ts and bluesky.ts are checked against
// the same shape instead of each other.

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface ServiceAdapter {
  readonly id: string;
  readonly matches: readonly string[];
  // The word this service uses for the reaction the thresholds count.
  readonly reactionLabel: string;

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
