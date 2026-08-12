// サービスごとのアダプターが満たす契約。どれか1つのアダプターから推論させず
// ここに置いてあるのは、x.ts・bluesky.ts・misskey.ts が互いを基準にするのでは
// なく、同じ形に対して検査されるようにするため。
import type { ThresholdKeys } from "../settings.ts";

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface ServiceAdapter {
  readonly id: string;
  // このサービス向けに manifest が登録する match パターン。ビルド時には一度も
  // 登録されないサービスでは空＝Misskey がそれで、ホストは利用者が1つずつ
  // 追加する（utils/instances.ts）。
  readonly matches: readonly string[];
  // その反応の数を、保存されているどのしきい値と比べるか。
  readonly thresholdKeys: ThresholdKeys;

  getPostCards(root: ParentNode): Element[];
  hasPostCards(root: ParentNode): boolean;
  // 投稿が一時的にまだ描かれていない画面でも、操作できるタイムラインなら true。
  isTimelineAvailable(
    root: ParentNode,
    page: Pick<Location, "pathname">,
  ): boolean;
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
