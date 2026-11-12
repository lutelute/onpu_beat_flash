import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneOf, MOTE_OF, NOTE_COLORS } from '../src/render/battleScenery.js';

test('オトバトルの景色：はじめの 5 面は、もとのオトバトルの面の色相と同じ順', () => {
  // ハ長調の門・低音の森・半音の迷宮・三種の調べ・不協和の王
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => sceneOf(n).id), ['gate', 'forest', 'maze', 'dusk', 'king']);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => sceneOf(n).hue), [210, 150, 280, 35, 0]);
});

test('オトバトルの景色：6 面めからは「混沌」で、色相を回していく（0〜359 に収まる）', () => {
  const hues = [];
  for (let n = 6; n <= 40; n++) {
    const s = sceneOf(n);
    assert.equal(s.id, 'chaos');
    assert.ok(s.hue >= 0 && s.hue < 360, `面 ${n} の色相 ${s.hue}`);
    hues.push(s.hue);
  }
  assert.notEqual(hues[0], hues[1], '面ごとに色が変わる');
  // おかしな面の番号でも景色はある
  for (const n of [0, -1, 2.5, NaN, Infinity]) {
    const s = sceneOf(n);
    assert.ok(s.id && Number.isFinite(s.hue), `面 ${n}`);
  }
});

test('オトバトルの景色：どの景色にも漂うものがあり、12 音の色がそろっている', () => {
  for (let n = 1; n <= 6; n++) assert.ok(MOTE_OF[sceneOf(n).id], `面 ${n}`);
  assert.equal(NOTE_COLORS.length, 12);
});
