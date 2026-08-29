// 拡張機能の中で捕まえ損ねた例外が届く先は chrome://extensions のエラー欄だけ
// で、そこは Chrome の外からは誰にも読めない＝拡張機能は chrome:// へ注入でき
// ないし、chrome.developerPrivate は内部のページにしか出ていないし、Chrome 136
// は既定のプロファイルに対する CDP を止めた。だから Sift を自動で診断するもの
// からは、それらが一切見えない。
//
// 以下はよくあるエラー計測の「集める側」＝Sentry 型の SDK が拡張機能の中に
// 入れるのと同じ2つのグローバルなイベント購読で、宛先だけがサーバーではなく
// 手元。開発ビルドでは、どの画面も browser.storage.local の環状バッファへ書く。
// service worker がそのバッファを開発サーバーへ送り、サーバーが
// ~/.sift/extension-errors.log へ書き足す（plugins/dev-error-log.ts）。利用する
// 経路のないリリースビルドでは購読も保存もしない。
//
// 作りからして best-effort＝ここには例外を投げるものが無いし、ここが見ている
// コードがここを待つこともない。診断の1行が失われる方が、診断がフィルタを壊す
// よりいつでも良い。
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";

// バッファを置くキーと、そこに入る件数。
const ERROR_LOG_KEY = "siftErrorLog";
const ERROR_LOG_LIMIT = 50;

const MESSAGE_LIMIT = 500;
const STACK_LIMIT = 4000;

export interface UncaughtEventDetails {
  message: string | null;
  stack: string | null;
  filename: string | null;
}

export type UncaughtEventKind = "error" | "unhandledrejection";

// 本物の ErrorEvent / PromiseRejectionEvent も、テストの偽物も、最低限持って
// いるもの。どちらの形もこの1つの型を通して読む＝どのフィールドが意味を持つかは
// DOM のイベントクラスではなく `kind` で決まるから。
export interface UncaughtEventLike {
  message?: unknown;
  filename?: unknown;
  error?: unknown;
  reason?: unknown;
}

export interface ErrorLogEntry {
  at?: string;
  source: string;
  kind?: string;
  message?: string | null;
  stack?: string | null;
  url?: string | null;
  seq: number;
}

// 環状バッファそのもの。sync ではなく local＝これはこの機械のこのブラウザに
// ついての話で、絶えず入れ替わるし、sync の容量は設定のためのもの。
export const errorLogItem = storage.defineItem<ErrorLogEntry[]>(
  `local:${ERROR_LOG_KEY}`,
  { fallback: [] },
);

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

// 形の分からない値から読んだ `seq`＝保管庫には、この拡張機能の古い版が置いた
// ものも入りうる。型を付けていないのは意図的で、呼び出し側は信じる前に
// isInteger() で確かめ直す。
function readSeq(value: unknown): unknown {
  return typeof value === "object" && value !== null && "seq" in value
    ? (value as { seq: unknown }).seq
    : undefined;
}

function truncate(value: unknown, limit: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function readMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }

  try {
    return String(reason);
  } catch {
    // 投げられた値が文字にできるとは限らない（プロトタイプが null の
    // オブジェクト・toString を捕まえる Proxy）。その文字を失う方が、記録ごと
    // 失うよりまし。
    return "(文字にできない値)";
  }
}

// readSeq() が `.seq` を読むのと同じやり方で、形の分からない値から読んだ
// `.stack`＝reason / error は投げられた値そのもので、Error とは限らない。
function readStack(value: unknown): unknown {
  return typeof value === "object" && value !== null && "stack" in value
    ? (value as { stack: unknown }).stack
    : undefined;
}

// 共有の window で起きたエラーが、それを載せているページではなく Sift から
// 来たものかどうか。`browser.runtime.getURL("")` はどちらのビルドでも正しい
// 前半になる＝WXT は開発時も content script を拡張機能へ束ねるので、Sift 自身の
// フレームは常に chrome-extension://<id>/ を持ち、localhost を名乗るのは開発
// サーバー自身のソケットだけ。
export function isOwnExtensionError(
  details: Partial<UncaughtEventDetails> | null | undefined,
  extensionUrlPrefix: string,
): boolean {
  if (typeof extensionUrlPrefix !== "string" || extensionUrlPrefix === "") {
    return false;
  }

  const { filename = null, stack = null } = details ?? {};
  return (
    (typeof filename === "string" && filename.startsWith(extensionUrlPrefix)) ||
    (typeof stack === "string" && stack.includes(extensionUrlPrefix))
  );
}

// 2つのイベントの形は違う＝ErrorEvent は例外が抜け出した場所を持ち、
// PromiseRejectionEvent は拒まれた値しか持たない。
export function describeUncaughtEvent(
  event: UncaughtEventLike,
  kind: UncaughtEventKind,
): UncaughtEventDetails {
  if (kind === "unhandledrejection") {
    const reason = event?.reason;
    return {
      message: truncate(readMessage(reason), MESSAGE_LIMIT),
      stack: truncate(readStack(reason), STACK_LIMIT),
      filename: null,
    };
  }

  return {
    message: truncate(
      typeof event?.message === "string" && event.message !== ""
        ? event.message
        : readMessage(event?.error),
      MESSAGE_LIMIT,
    ),
    stack: truncate(readStack(event?.error), STACK_LIMIT),
    filename: typeof event?.filename === "string" ? event.filename : null,
  };
}

// `seq` はバッファ自身から作る＝そうすれば開発時の送り出しは、足並みを揃える
// 2つ目の数え役を持たずに、自分が既に送ったものを見分けられる。
export function appendErrorEntry(
  entries: unknown,
  entry: Omit<ErrorLogEntry, "seq">,
  limit = ERROR_LOG_LIMIT,
): ErrorLogEntry[] {
  const existing = Array.isArray(entries) ? entries : [];
  const lastSeq = readSeq(existing.at(-1));
  const seq = (isInteger(lastSeq) ? lastSeq : 0) + 1;

  return [...existing, { ...entry, seq }].slice(-limit) as ErrorLogEntry[];
}

export function collectUndrainedEntries(
  entries: unknown,
  drainedSeq: unknown,
): ErrorLogEntry[] {
  const existing: unknown[] = Array.isArray(entries) ? entries : [];
  const lastSeq = readSeq(existing.at(-1));
  // 最新の記録が送り出しの印より古いバッファは、作り直されている（保管庫が
  // 消された・拡張機能を入れ直した）。数え役が追い付くまで全部を黙って捨てる
  // のではなく、丸ごと送る。
  const from =
    isInteger(drainedSeq) && isInteger(lastSeq) && lastSeq >= drainedSeq
      ? drainedSeq
      : 0;

  return existing.filter(
    (entry) => isInteger(readSeq(entry)) && (readSeq(entry) as number) > from,
  ) as ErrorLogEntry[];
}

// 1つのコンテキストの中では直列にしてある＝同じ tick の2つのエラーが、どちらも
// 自分の読んだバッファを書いてしまうことがないように。画面同士はなお競争して
// いて、そこでは1行落ちうるが、診断は best-effort であり、ここでの錠は救う分
// より高くつく。
let pendingWrite: Promise<void> = Promise.resolve();

export function recordErrorEntry(
  entry: Omit<ErrorLogEntry, "seq">,
  limit = ERROR_LOG_LIMIT,
): Promise<void> {
  pendingWrite = pendingWrite
    .then(async () => {
      const stored = await errorLogItem.getValue();
      await errorLogItem.setValue(appendErrorEntry(stored, entry, limit));
    })
    .catch(() => {
      // 再読み込みの後、書き込みの途中で拡張機能のコンテキストが無効になりうる。
    });

  return pendingWrite;
}

// 画面の `window`・service worker の `globalThis`・テストの偽物のどれもが
// 満たすもの。EventTarget より狭くしてあるのは意図的で、偽物は dispatchEvent を
// 持たないし、ここにそれを要るものは無い。
export interface UncaughtReportingTarget {
  location?: { href?: string | null } | null;
  addEventListener(
    type: string,
    listener: (event: UncaughtEventLike) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: UncaughtEventLike) => void,
  ): void;
}

export interface InstallUncaughtReportingOptions {
  target: UncaughtReportingTarget;
  source: string;
  extensionUrlPrefix?: string | null;
  record: (entry: Omit<ErrorLogEntry, "seq">) => unknown;
  now?: () => string;
  readPageUrl?: () => string | null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

export function installUncaughtReporting({
  target,
  source,
  extensionUrlPrefix = null,
  record,
  now = () => new Date().toISOString(),
  readPageUrl = () => target.location?.href ?? null,
}: InstallUncaughtReportingOptions): () => void {
  function report(event: UncaughtEventLike, kind: UncaughtEventKind) {
    try {
      const details = describeUncaughtEvent(event, kind);
      if (
        extensionUrlPrefix !== null &&
        !isOwnExtensionError(details, extensionUrlPrefix)
      ) {
        return;
      }

      const written = record({
        at: now(),
        source,
        kind,
        message: details.message,
        stack: details.stack,
        url: readPageUrl(),
      });
      // ここから抜け出た拒否は、この handler 自身に捕まることになる。
      if (isThenable(written)) {
        written.then(undefined, () => {});
      }
    } catch {
      // 診断が、それが見ているコードを壊してはならない。
    }
  }

  const handleError = (event: UncaughtEventLike) => report(event, "error");
  const handleRejection = (event: UncaughtEventLike) =>
    report(event, "unhandledrejection");

  target.addEventListener("error", handleError);
  target.addEventListener("unhandledrejection", handleRejection);

  return function stopUncaughtReporting() {
    target.removeEventListener("error", handleError);
    target.removeEventListener("unhandledrejection", handleRejection);
  };
}

export interface StartUncaughtReportingOptions {
  target: UncaughtReportingTarget;
  source: string;
  filterToOwnCode: boolean;
}

// 3つの画面が共有する、ブラウザ側の繋ぎ込み。`filterToOwnCode` を入れるのは、
// ページ自身の例外が同じ相手に届く所だけ。
export function startUncaughtReporting({
  target,
  source,
  filterToOwnCode,
}: StartUncaughtReportingOptions): () => void {
  if (!__SIFT_DEV__) {
    return () => {};
  }

  return installUncaughtReporting({
    target,
    source,
    extensionUrlPrefix: filterToOwnCode ? browser.runtime.getURL("") : null,
    record: (entry) => recordErrorEntry(entry),
  });
}
