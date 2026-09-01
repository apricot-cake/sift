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
  // 投稿時刻が読めないときは NaN。
  readCreatedAt(postCard: Element): number;
  readMedia(postCard: Element): PostMedia;
  // 投稿本文とハッシュタグ。カードの操作やプロフィール名は含めない。
  readText(postCard: Element): string;
  readIsRepost(postCard: Element): boolean;
}
