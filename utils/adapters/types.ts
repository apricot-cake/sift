// サービスごとのアダプターが満たす契約。どれか1つのアダプターから推論させず
// ここに置いてあるのは、個々のアダプターが互いを基準にするのではなく、同じ形に
// 対して検査されるようにするため。
import type { SiteSettingsKey } from "../settings.ts";

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface ServiceAdapter {
  readonly id: string;
  // このサービス向けに manifest が登録する match パターン。
  readonly matches: readonly string[];
  // このサービスが読むサイト別設定。
  readonly settingsKey: SiteSettingsKey;
  // 全件をレイアウトから外すと、ページ末尾の次ページ判定が止まるサービス。
  readonly needsLayoutProbeForPagination?: boolean;
  // サービス自身が、これ以上読み込む投稿が無いと画面に示しているか。
  hasReachedTimelineEnd?(root: ParentNode): boolean;

  getPostCards(root: ParentNode): Element[];
  hasPostCards(root: ParentNode): boolean;
  // 投稿が一時的にまだ描かれていない画面でも、操作できるタイムラインなら true。
  isTimelineAvailable(
    root: ParentNode,
    page: Pick<Location, "pathname">,
  ): boolean;
  // 隠される単位＝投稿カードそのものとは限らない。
  findPostCell(postCard: Element): Element;
  // 仮想リストが同じ投稿を描き直しても、新しい取得として数え直さないための
  // 識別子。連続読み込みを観測するサービスだけが実装する。
  readPostId?(postCard: Element): string | null;
  // サービスが一覧で公開している主指標。X / Bluesky は反応数、動画サービスは
  // 再生回数を返す。
  readMetricCount(postCard: Element): number;
  // 公開時刻を一覧から読めるサービスだけが実装する。読めない場合は NaN。
  readCreatedAt?(postCard: Element): number;
  readMedia(postCard: Element): PostMedia;
  // 返信・引用の区別を画面に持つサービスだけが実装する。
  readIsReply?(postCard: Element): boolean;
  readIsQuote?(postCard: Element): boolean;
  readIsRepost(postCard: Element): boolean;
}
