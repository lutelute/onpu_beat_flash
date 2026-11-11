import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRhythmEngine } from '../src/core/rhythmEngine.js';

const notesAt = (eng, list) => list.map(([answer, t]) => eng.add({ answer }, t));

test('ぴったり押せば Perfect、ずれると Great・Good', () => {
  const e = makeRhythmEngine();
  notesAt(e, [['0', 1], ['2', 2], ['4', 3], ['6', 4]]);
  assert.equal(e.press('0', 1.02).grade, 'perfect');
  assert.equal(e.press('2', 2.08).grade, 'great');
  const r = e.press('4', 2.87);
  assert.equal(r.grade, 'good');
  assert.ok(r.dt < 0, '早めは dt が負');
  assert.equal(e.press('6', 4.0).grade, 'perfect');
  const s = e.score();
  assert.deepEqual(s.tally, { perfect: 2, great: 1, good: 1, miss: 0 });
  assert.equal(s.maxStreak, 4);
  assert.equal(s.accuracy, Math.round((100 * (3 + 2 + 1 + 3)) / 12));
});

test('音名を間違えると Miss でコンボが切れる', () => {
  const e = makeRhythmEngine();
  notesAt(e, [['0', 1], ['1', 2], ['2', 3]]);
  e.press('0', 1);
  assert.equal(e.press('5', 2).grade, 'miss');
  assert.equal(e.score().streak, 0);
  e.press('2', 3);
  assert.equal(e.score().maxStreak, 1);
});

test('遠すぎる押し方は数えない・通り過ぎたら Miss', () => {
  const e = makeRhythmEngine();
  notesAt(e, [['0', 1], ['1', 2]]);
  assert.equal(e.press('0', 0.5), null, '0.5 秒も早いのは空振り（減点なし）');
  assert.equal(e.sweep(1.1).length, 0, 'まだ判定の幅の中');
  const missed = e.sweep(1.2);
  assert.equal(missed.length, 1);
  assert.equal(missed[0].grade, 'miss');
  assert.equal(e.press('1', 2.0).grade, 'perfect', '次の音符は普通に判定');
  assert.equal(e.score().judged, 2);
});

test('近い 2 つの音符では、近い方を判定する', () => {
  const e = makeRhythmEngine();
  notesAt(e, [['0', 1.0], ['1', 1.25]]);
  assert.equal(e.press('1', 1.22).note.item.answer, '1');
  assert.equal(e.press('0', 1.04).grade, 'perfect');
});

test('間隔の狭い音符で、少し遅れた答えは前の音符に当たる', () => {
  const e = makeRhythmEngine();
  notesAt(e, [['0', 1.0], ['1', 1.25], ['2', 1.5]]);
  const r = e.press('0', 1.13); // 次の音符（1.25）の方が近いが、答えは前の音符のもの
  assert.equal(r.note.item.answer, '0');
  assert.equal(r.grade, 'good');
  assert.equal(e.press('1', 1.26).grade, 'perfect');
  const w = e.press('5', 1.45); // まちがえた答えは、いちばん早い音符のまちがい
  assert.equal(w.note.item.answer, '2');
  assert.equal(w.grade, 'miss');
});
