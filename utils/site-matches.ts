import { ADAPTERS } from "./adapters/index.ts";
import { MISSKEY_HOSTS, originForHost } from "./misskey-hosts.ts";

// Sift が動くサイト。2度目の宣言をせずアダプターから導いてある＝Sift が読めない
// サービスは読み込み先にしてはならないし、対応する登録の無いアダプターは一度も
// 走らない。
//
// Misskey は対応ホストを固定一覧で持つため、アダプターとは別に足す。
export const SITE_MATCHES = [
  ...ADAPTERS.flatMap((adapter) => [...adapter.matches]),
  ...MISSKEY_HOSTS.map((host) => originForHost(host)),
];
