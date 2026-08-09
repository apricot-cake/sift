import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { drainErrorLog } from "./error-drain.ts";
import { type ErrorLogEntry, errorLogItem } from "./error-log.ts";

const buffered: ErrorLogEntry[] = [
  { source: "test", seq: 1, message: "first" },
  { source: "test", seq: 2, message: "second" },
];

beforeEach(async () => {
  fakeBrowser.reset();
  await errorLogItem.setValue(buffered);
});

describe("drainErrorLog", () => {
  it("バッファを送り、どこまで送ったかを印す", async () => {
    const posted: ErrorLogEntry[][] = [];

    const result = await drainErrorLog({
      post: (entries) => {
        posted.push(entries);
      },
    });

    expect(result).toEqual({ forwarded: 2 });
    expect(posted).toEqual([buffered]);
  });

  it("2回目には何も送らない", async () => {
    let posts = 0;

    await drainErrorLog({ post: () => {} });
    const result = await drainErrorLog({
      post: () => {
        posts += 1;
      },
    });

    expect(result).toEqual({ forwarded: 0 });
    expect(posts).toBe(0);
  });

  it("前回の送り出し以降に足されたものだけを送る", async () => {
    await drainErrorLog({ post: () => {} });
    await errorLogItem.setValue([
      ...buffered,
      { source: "test", seq: 3, message: "third" },
    ]);

    const posted: ErrorLogEntry[][] = [];
    const result = await drainErrorLog({
      post: (entries) => {
        posted.push(entries);
      },
    });

    expect(result).toEqual({ forwarded: 1 });
    expect(posted).toEqual([[{ source: "test", seq: 3, message: "third" }]]);
  });

  // 送信が失敗したら印には触れない＝記録は次回に出ていく。
  it("送信が失敗したら印を元の位置に留める", async () => {
    await expect(
      drainErrorLog({
        post: () => {
          throw new Error("開発サーバーが落ちている");
        },
      }),
    ).rejects.toThrow();

    const posted: ErrorLogEntry[][] = [];
    const result = await drainErrorLog({
      post: (entries) => {
        posted.push(entries);
      },
    });

    expect(result).toEqual({ forwarded: 2 });
    expect(posted).toEqual([buffered]);
  });

  // 最新の記録が印より古いバッファは作り直されている＝保管庫が消されたか、
  // 拡張機能を入れ直したか。数え役が追い付くまで留め置かず、丸ごと出ていく。
  it("印より下から始まり直したバッファを送る", async () => {
    await drainErrorLog({ post: () => {} });
    await errorLogItem.setValue([
      { source: "test", seq: 1, message: "after a restart" },
    ]);

    const result = await drainErrorLog({ post: () => {} });

    expect(result).toEqual({ forwarded: 1 });
  });
});
