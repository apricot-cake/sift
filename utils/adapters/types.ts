// サービスごとのアダプターが満たす契約。どれか1つのアダプターから推論させず
// ここに置いてあるのは、x.ts・bluesky.ts・misskey.ts が互いを基準にするのでは
// なく、同じ形に対して検査されるようにするため。
import type { MessageKey } from "../i18n.ts";
import type { ThresholdKeys } from "../settings.ts";

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

// このサービスで、ツールバーのしきい値2行を何と呼ぶか。単語ではなくメッセージ
// の名前を持つのは、単語が文を組み立てられる差し込み口になっていないから＝
// "Standard: minimum likes" と「通常の最低いいね数」では置き場所が違うし、
// また別のものを数えるサービスなら、そもそも文の形から変わりうる。
export interface ReactionLabelKeys {
  readonly minCount: MessageKey;
  readonly risingMinCount: MessageKey;
}

// 存在する2組を、アダプター側で繰り返さずに並べてある＝対になるしきい値の
// キー（utils/settings.ts の LIKE_THRESHOLDS と MISSKEY_REACTION_THRESHOLDS）
// と同じ置き方。
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
  // このサービス向けに manifest が登録する match パターン。ビルド時には一度も
  // 登録されないサービスでは空＝Misskey がそれで、ホストは利用者が1つずつ
  // 追加する（utils/instances.ts）。
  readonly matches: readonly string[];
  // しきい値が数える反応を、このサービスでは何と呼ぶか。
  readonly reactionLabels: ReactionLabelKeys;
  // その反応の数を、保存されているどのしきい値と比べるか。
  readonly thresholdKeys: ThresholdKeys;

  getPostCards(root: ParentNode): Element[];
  hasPostCards(root: ParentNode): boolean;
  // 隠される単位＝投稿カードそのものとは限らない。
  findPostCell(postCard: Element): Element;
  readReactionCount(postCard: Element): number;
  // 投稿時刻が読めないときは NaN。
  readCreatedAt(postCard: Element): number;
  readMedia(postCard: Element): PostMedia;
  // 投稿本文とハッシュタグ。カードの操作やプロフィール名は含めない。
  readText(postCard: Element): string;
  readIsRepost(postCard: Element): boolean;
}
