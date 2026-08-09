import { ADAPTERS } from "./adapters/index.ts";

// Sift が動くサイト。2度目の宣言をせずアダプターから導いてある＝Sift が読めない
// サービスは読み込み先にしてはならないし、対応する登録の無いアダプターは一度も
// 走らない。
export const SITE_MATCHES = ADAPTERS.flatMap((adapter) => [...adapter.matches]);
