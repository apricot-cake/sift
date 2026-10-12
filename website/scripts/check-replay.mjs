import assert from "node:assert/strict";
import {
  advanceReplayTime,
  getReplayState,
  interpolateCursor,
  isReplayItemVisible,
  seekReplayTime,
} from "../src/scripts/replay-demo.ts";

// 区間を選び直したとき、対応する場面から再生できる。
for (let stage = 0; stage < 4; stage++) {
  assert.equal(getReplayState(seekReplayTime(stage)).stage, stage);
}
const reducedSelection = getReplayState(seekReplayTime(2, true));
assert.equal(reducedSelection.stage, 2);
assert.equal(reducedSelection.menuOpen, true);

// 最後まで再生したら、メニューと選択効果をリセットして冒頭に戻る。
const looped = getReplayState(advanceReplayTime(15690, 30));
assert.equal(looped.stage, 0);
assert.equal(looped.menuOpen, false);
assert.equal(looped.chosen, false);
assert.equal(looped.clicked, false);
assert.equal(getReplayState(seekReplayTime(0)).stage, 0);

// 境界値を含め、絞り込みと冒頭への移動で一覧が戻ることを確かめる。
const filteredTime = seekReplayTime(3);
assert.equal(isReplayItemVisible("social", 99, filteredTime), false);
assert.equal(isReplayItemVisible("social", 100, filteredTime), true);
assert.equal(isReplayItemVisible("youtube", 90, filteredTime), true);
assert.equal(isReplayItemVisible("youtube", 91, filteredTime), false);
assert.equal(isReplayItemVisible("social", 2, seekReplayTime(0)), true);
assert.equal(isReplayItemVisible("youtube", 1100, seekReplayTime(0)), true);

// 非表示・モーション抑制時は進めず、復帰時にも場面を飛ばさない。
assert.equal(advanceReplayTime(6200, 10000, false), 6200);
assert.equal(advanceReplayTime(6200, 10000), 6300);
assert.equal(advanceReplayTime(6200, -20), 6200);
assert.equal(advanceReplayTime(6200, 16), 6216);

// 曲線の端点はクリック対象に一致し、開始・終了時には速度が落ちる。
const from = { x: 100, y: 80 };
const to = { x: 500, y: 240 };
assert.deepEqual(interpolateCursor(from, to, 0, 24), from);
assert.deepEqual(interpolateCursor(from, to, 1, 24), to);
assert.deepEqual(interpolateCursor(from, to, -1, 24), from);
assert.deepEqual(interpolateCursor(from, to, 2, 24), to);
const middle = interpolateCursor(from, to, 0.5, 24);
assert.ok(Math.abs(middle.y - 160) > 10);
const nearEnd = interpolateCursor(from, to, 0.99, 24);
assert.ok(Math.hypot(nearEnd.x - to.x, nearEnd.y - to.y) < 0.01);

console.log("デモの区間移動、ループ、再生時刻とカーソルの曲線を確認しました。");
