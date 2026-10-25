// サービスごとのアダプターが満たす契約。どれか1つのアダプターから推論させず
// ここに置いてあるのは、個々のアダプターが互いを基準にするのではなく、同じ形に
// 対して検査されるようにするため。

import type { PageSupport } from "../page-health.ts";
import type { CollectedPost } from "../panel-post.ts";
import type { SiteSettingsKey } from "../settings.ts";
import type { MetricCards } from "./metric-cards.ts";

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface ServiceAdapter {
  readPost(postCard: Element): CollectedPost | null;
  readPageSupport?(
    root: ParentNode,
    page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
  ): PageSupport;
  hasEmptyTimeline?(root: ParentNode): boolean;
  readPageKey?(
    root: ParentNode,
    page: Pick<Location, "pathname" | "search">,
  ): string;
  readonly id: string;
  // このサービス向けに manifest が登録する match パターン。
  readonly matches: readonly string[];
  // このサービスが読むサイト別設定。
  readonly settingsKey: SiteSettingsKey;
  getPostCards(root: ParentNode): Element[];
  // パネル用の件数は上限付きで取得する。投稿のフィルター範囲とは別に扱う。
  getMetricPostCards(root: ParentNode, limit?: number): MetricCards;
  hasPostCards(root: ParentNode): boolean;
  // 投稿が一時的にまだ描かれていない画面でも、操作できるタイムラインなら true。
  isTimelineAvailable(
    root: ParentNode,
    page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
  ): boolean;
  // 幅変更前後の閲覧位置を保持するセル。投稿カードそのものとは限らない。
  findPostCell(postCard: Element): Element;
  // パネルを開く幅変更でDOMが描き直されても、同じ投稿を追跡する識別子。
  readPostId?(postCard: Element): string | null;
  // 幅変更や別画面から戻る際に位置を復元する一覧。モーダルなどは null。
  readTimelineKey?(
    root: ParentNode,
    page: Pick<Location, "pathname" | "search">,
  ): string | null;
  // 反応数で絞り込むサービスだけが実装する。
  readMetricCount?(postCard: Element): number;
  readMedia(postCard: Element): PostMedia;
  // 返信・引用の区別を画面に持つサービスだけが実装する。
  readIsReply?(postCard: Element): boolean;
  readIsQuote?(postCard: Element): boolean;
  readIsRepost(postCard: Element): boolean;
}
