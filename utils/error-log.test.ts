import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  appendErrorEntry,
  collectUndrainedEntries,
  describeUncaughtEvent,
  type ErrorLogEntry,
  errorLogItem,
  installUncaughtReporting,
  isOwnExtensionError,
  recordErrorEntry,
  startUncaughtReporting,
  type UncaughtEventLike,
} from "./error-log.ts";

const extensionPrefix = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";

const uncaughtError = new Error("boom");
uncaughtError.stack = `Error: boom\n    at ${extensionPrefix}src/content/index.js:3:1`;

// 捕まえ損ねた例外が届く window に、それを発火させる手段と、まだ購読されて
// いるものを数える手段を足したもの。content script は window をページ自身の
// コードと共有するので、何が購読されているか＝そして片付けの後に何が残って
// いるかが、読み取りの一部になる。
function createFakeTarget(href: string | null = null) {
  const listeners = new Map<
    string,
    Array<(event: UncaughtEventLike) => void>
  >();
  return {
    location: href === null ? undefined : { href },
    addEventListener(
      type: string,
      listener: (event: UncaughtEventLike) => void,
    ) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(
      type: string,
      listener: (event: UncaughtEventLike) => void,
    ) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener),
      );
    },
    emit(type: string, event: UncaughtEventLike) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

// X 自身の例外も content script と同じ window に届き、それを記録すれば誤報に
// なる。Sift のものは、拡張機能のオリジンを名乗るフレームだけ。
describe("isOwnExtensionError", () => {
  it("拡張機能自身のオリジンを名乗るフレームを読む", () => {
    expect(
      isOwnExtensionError(
        { filename: `${extensionPrefix}src/content/index.js`, stack: null },
        extensionPrefix,
      ),
    ).toBe(true);
  });

  it("filename が無ければスタックからオリジンを読む", () => {
    expect(
      isOwnExtensionError(
        {
          filename: null,
          stack: `Error: broke\n    at readLikeCount (${extensionPrefix}src/filter-core.js:12:5)`,
        },
        extensionPrefix,
      ),
    ).toBe(true);
  });

  it("ページ自身の例外には手を出さない", () => {
    expect(
      isOwnExtensionError(
        {
          filename: "https://x.com/bundle.js",
          stack: "TypeError: x\n    at https://x.com/bundle.js:1:1",
        },
        extensionPrefix,
      ),
    ).toBe(false);
  });

  it("読むものが無ければ何も名乗らない", () => {
    expect(
      isOwnExtensionError({ filename: null, stack: null }, extensionPrefix),
    ).toBe(false);
    expect(
      isOwnExtensionError({ filename: `${extensionPrefix}a.js` }, ""),
    ).toBe(false);
  });
});

describe("describeUncaughtEvent", () => {
  it("error のイベントを読む", () => {
    expect(
      describeUncaughtEvent(
        {
          message: "Uncaught Error: boom",
          filename: `${extensionPrefix}src/content/index.js`,
          error: uncaughtError,
        },
        "error",
      ),
    ).toEqual({
      message: "Uncaught Error: boom",
      stack: uncaughtError.stack,
      filename: `${extensionPrefix}src/content/index.js`,
    });
  });

  it("Error を運ぶ拒否を読む", () => {
    expect(
      describeUncaughtEvent({ reason: uncaughtError }, "unhandledrejection"),
    ).toEqual({
      message: "Error: boom",
      stack: uncaughtError.stack,
      filename: null,
    });
  });

  it("裸の値を運ぶ拒否を読む", () => {
    expect(
      describeUncaughtEvent({ reason: "plain string" }, "unhandledrejection"),
    ).toEqual({
      message: "plain string",
      stack: null,
      filename: null,
    });
  });

  // reason は失敗したコードが投げたものそのものなので、それを読むこと自体が
  // 2つ目の投げ方になってはならない。
  it("message が例外になる reason でも壊れない", () => {
    expect(
      describeUncaughtEvent(
        {
          reason: {
            get message() {
              throw new Error("敵対的");
            },
          },
        },
        "unhandledrejection",
      ).message,
    ).toBe("[object Object]");
  });

  it("そもそも文字にできない reason でも壊れない", () => {
    expect(
      describeUncaughtEvent(
        { reason: Object.assign(Object.create(null), { toString: null }) },
        "unhandledrejection",
      ).message,
    ).toBe("(文字にできない値)");
  });

  // バッファは browser.storage の中にあるので、途方もなく長いメッセージ1つで
  // 埋められてはならない。
  it("長すぎるメッセージを切り詰める", () => {
    expect(
      describeUncaughtEvent({ message: "x".repeat(600) }, "error").message,
    ).toHaveLength(501);
  });
});

describe("appendErrorEntry", () => {
  it("最初の記録に 1 から番号を振る", () => {
    expect(appendErrorEntry(undefined, { source: "content" })).toEqual([
      { source: "content", seq: 1 },
    ]);
  });

  it("既に保管されているものから番号を継ぐ", () => {
    expect(
      appendErrorEntry([{ source: "sidepanel", seq: 4 }], {
        source: "content",
      }),
    ).toEqual([
      { source: "sidepanel", seq: 4 },
      { source: "content", seq: 5 },
    ]);
  });

  it("新しい記録を残し、古いものを落とす", () => {
    let ringBuffer: ErrorLogEntry[] = [];
    for (let index = 0; index < 5; index += 1) {
      ringBuffer = appendErrorEntry(
        ringBuffer,
        { source: "test", message: `error ${index}` },
        3,
      );
    }

    expect(ringBuffer.map((entry) => entry.seq)).toEqual([3, 4, 5]);
    expect(ringBuffer[0]?.message).toBe("error 2");
  });
});

describe("collectUndrainedEntries", () => {
  it("送り出しの印より先のものを取る", () => {
    expect(
      collectUndrainedEntries([{ seq: 1 }, { seq: 2 }, { seq: 3 }], 2),
    ).toEqual([{ seq: 3 }]);
  });

  it("何も送っていなければ全部を取る", () => {
    expect(
      collectUndrainedEntries([{ seq: 1 }, { seq: 2 }], undefined),
    ).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  // 送り出しの印より下から始まり直したバッファは、数え役が追い付くまで黙って
  // 留め置かず、丸ごと送る。
  it("印より下から始まり直したバッファを送る", () => {
    expect(collectUndrainedEntries([{ seq: 1 }], 9)).toEqual([{ seq: 1 }]);
    expect(collectUndrainedEntries([], 9)).toEqual([]);
  });
});

describe("recordErrorEntry", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it("保管庫のバッファへ書き足す", async () => {
    await recordErrorEntry({ source: "content", message: "first" });
    await recordErrorEntry({ source: "sidepanel", message: "second" });

    expect(await errorLogItem.getValue()).toEqual([
      { source: "content", message: "first", seq: 1 },
      { source: "sidepanel", message: "second", seq: 2 },
    ]);
  });

  // 生きている content script の下で拡張機能が再読み込みされるとコンテキストが
  // 無効になり、それ以降どの保管庫の呼び出しも例外になる。エラーを記録すること
  // 自体がエラーになってはならない。
  it("消えた保管庫を飲み込む", async () => {
    vi.spyOn(errorLogItem, "getValue").mockRejectedValue(
      new Error("Extension context invalidated."),
    );

    await expect(
      recordErrorEntry({ source: "content" }),
    ).resolves.toBeUndefined();
  });
});

describe("installUncaughtReporting", () => {
  it("拡張機能自身の例外を記録し、ページのものには手を出さない", () => {
    const target = createFakeTarget("https://x.com/home");
    const recorded: Omit<ErrorLogEntry, "seq">[] = [];
    installUncaughtReporting({
      target,
      source: "content",
      extensionUrlPrefix: extensionPrefix,
      record: (entry) => {
        recorded.push(entry);
      },
      now: () => "2026-08-02T00:00:00.000Z",
    });

    target.emit("error", {
      message: "Uncaught Error: boom",
      filename: `${extensionPrefix}src/content/index.js`,
      error: uncaughtError,
    });
    target.emit("error", {
      message: "Uncaught TypeError: page broke",
      filename: "https://x.com/bundle.js",
      error: new Error("page broke"),
    });
    target.emit("unhandledrejection", { reason: uncaughtError });
    target.emit("unhandledrejection", { reason: "a bare page rejection" });

    expect(recorded).toEqual([
      {
        at: "2026-08-02T00:00:00.000Z",
        source: "content",
        kind: "error",
        message: "Uncaught Error: boom",
        stack: uncaughtError.stack,
        url: "https://x.com/home",
      },
      {
        at: "2026-08-02T00:00:00.000Z",
        source: "content",
        kind: "unhandledrejection",
        message: "Error: boom",
        stack: uncaughtError.stack,
        url: "https://x.com/home",
      },
    ]);
  });

  // content script を差し替える注入は、先に前の実行環境を片付ける。そこで購読
  // したまま残ったものは、死んだコンテキストへ報告することになる。
  it("購読したものを全部外す", () => {
    const target = createFakeTarget("https://x.com/home");
    const recorded: Omit<ErrorLogEntry, "seq">[] = [];
    const stop = installUncaughtReporting({
      target,
      source: "content",
      extensionUrlPrefix: extensionPrefix,
      record: (entry) => {
        recorded.push(entry);
      },
    });

    stop();

    expect(target.count("error")).toBe(0);
    expect(target.count("unhandledrejection")).toBe(0);
    target.emit("error", {
      filename: `${extensionPrefix}src/content/index.js`,
      error: uncaughtError,
    });
    expect(recorded).toEqual([]);
  });

  // 拡張機能のページで動いているものは全部が拡張機能自身のものなので、そこでは
  // 何も除かない。
  it("拡張機能のページでは全部を記録する", () => {
    const target = createFakeTarget("chrome-extension://abc/sidepanel.html");
    const recorded: Omit<ErrorLogEntry, "seq">[] = [];
    installUncaughtReporting({
      target,
      source: "sidepanel",
      record: (entry) => {
        recorded.push(entry);
      },
    });

    target.emit("error", {
      message: "anything on an extension page",
      error: null,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.source).toBe("sidepanel");
  });

  // 記録役が失敗しても、見られている側のコードを道連れにしてはならない。
  it("例外を投げる記録役でも壊れない", () => {
    const target = createFakeTarget();
    installUncaughtReporting({
      target,
      source: "sidepanel",
      record: () => {
        throw new Error("保管庫が消えている");
      },
    });

    expect(() => target.emit("error", { message: "x" })).not.toThrow();
  });

  // そして、拒まれた書き込みが次の未処理の拒否になってはならない。
  it("拒否を返す記録役でも壊れない", async () => {
    const target = createFakeTarget();
    installUncaughtReporting({
      target,
      source: "sidepanel",
      record: () => Promise.reject(new Error("保管庫が消えている")),
    });

    target.emit("unhandledrejection", { reason: "x" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("startUncaughtReporting", () => {
  it("リリースビルドでは例外を購読しない", () => {
    const target = createFakeTarget();

    startUncaughtReporting({
      target,
      source: "sidepanel",
      filterToOwnCode: false,
    });

    expect(target.count("error")).toBe(0);
    expect(target.count("unhandledrejection")).toBe(0);
  });
});
