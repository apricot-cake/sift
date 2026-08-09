import { ADAPTERS } from "./adapters/index.ts";
import { DEFAULT_MISSKEY_HOSTS } from "./default-instances.ts";
import { originForHost } from "./instances.ts";

// Sift が動くサイト。2度目の宣言をせずアダプターから導いてある＝Sift が読めない
// サービスは読み込み先にしてはならないし、対応する登録の無いアダプターは一度も
// 走らない。
//
// misskey.io だけは例外＝misskeyAdapter.matches 自身は空のまま（他の Misskey
// ホストは利用者が実行時に1つずつ追加する）だが、misskey.io はビルド時の既定
// ホストとして host_permissions に静的に含まれる（#41）＝content script もここで
// 静的に届けなければ「追加操作なしに動く」にならない。
export const SITE_MATCHES = [
  ...ADAPTERS.flatMap((adapter) => [...adapter.matches]),
  ...DEFAULT_MISSKEY_HOSTS.map((host) => originForHost(host)),
];
