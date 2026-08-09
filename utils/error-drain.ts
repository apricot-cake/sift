import { storage } from "wxt/utils/storage";
import {
  collectUndrainedEntries,
  type ErrorLogEntry,
  errorLogItem,
} from "./error-log.ts";

const ERROR_LOG_DRAINED_SEQ_KEY = "siftErrorLogDrainedSeq";

// バッファをどこまで送ったか。local ではなく session＝worker が壊されて立ち
// 上がり直しても残り、ブラウザのセッションが始まり直す頃には消えている。そして
// 消えている時こそ、全部を送り直すのが正しい答えになる。
//
// fallback を置いていないので、印が未設定なら null として読まれ、
// collectUndrainedEntries() がバッファを丸ごと取る。
const drainedSeqItem = storage.defineItem<number>(
  `session:${ERROR_LOG_DRAINED_SEQ_KEY}`,
);

export interface DrainErrorLogDeps {
  post: (entries: ErrorLogEntry[]) => void | Promise<void>;
}

// エラーの環状バッファを local ストレージから運び出し、開発サーバーが持つ
// ファイルへ入れる＝Chrome の外で走る診断が読める形はそれだけ。
//
// 送信に失敗したら印には手を付けない＝これは意図的で、記録はバッファに残り、
// 次の試行で出ていく。
export async function drainErrorLog({
  post,
}: DrainErrorLogDeps): Promise<{ forwarded: number }> {
  const [stored, drained] = await Promise.all([
    errorLogItem.getValue(),
    drainedSeqItem.getValue(),
  ]);

  const pending = collectUndrainedEntries(stored, drained);
  const lastPending = pending.at(-1);
  if (lastPending === undefined) {
    return { forwarded: 0 };
  }

  await post(pending);
  await drainedSeqItem.setValue(lastPending.seq);

  return { forwarded: pending.length };
}
