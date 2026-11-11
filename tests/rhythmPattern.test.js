import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhythmPattern, CELLS } from '../src/generators/rhythmPattern.js';
import { makeRng } from '../src/core/rng.js';
import { sanitizeSettings } from '../src/core/settings.js';

const g = rhythmPattern;

test('どの設定でも、小節は拍子どおりに埋まり、叩く音が必ずある', () => {
  for (const level of ['1', '2', '3', '4']) {
    for (const time of ['2', '3', '4']) {
      for (const rests of [true, false]) {
        const s = { level, time, measures: '2', rests, weak: false };
        const rng = makeRng(1);
        const allowed = new Set(g.pool(s).map((c) => c.id));
        for (let i = 0; i < 300; i++) {
          const q = g.make(s, { rng });
          assert.equal(q.prompt.measures.length, 2);
          for (const m of q.prompt.measures) {
            assert.equal(m.reduce((t, n) => t + n.ticks, 0), Number(time) * 4, '小節の長さ');
            assert.ok(m.some((n) => !n.rest), '休符だけの小節');
          }
          if (!rests) assert.ok(q.prompt.measures.flat().every((n) => !n.rest), '休符なしの設定で休符');
          for (const c of q.cells) assert.ok(allowed.has(c) || c === 'q', `出ないはずの型 ${c}`);
          // 叩く時刻は小節の中で増えていく
          for (let k = 1; k < q.onsets.length; k++) assert.ok(q.onsets[k].beat > q.onsets[k - 1].beat);
          assert.ok(q.onsets.every((o) => o.beat >= 0 && o.beat < 2 * Number(time)));
        }
      }
    }
  }
});

test('難しさが上がると、その段の型が出てくる', () => {
  const seen = (level) => {
    const rng = makeRng(3);
    const ids = new Set();
    for (let i = 0; i < 400; i++) g.make({ level, time: '4', measures: '2', rests: true, weak: false }, { rng }).cells.forEach((c) => ids.add(c));
    return ids;
  };
  assert.ok(!seen('1').has('e2'), '四分と二分のとき八分は出ない');
  assert.ok(seen('2').has('e2'));
  assert.ok(seen('3').has('sync') && seen('3').has('eds'));
  assert.ok(seen('4').has('s4'));
  assert.ok(CELLS.every((c) => seen('4').has(c.id)), '十六分の段で全部の型が一度は出る');
});

test('苦手な型を多めに', () => {
  const s = { level: '4', time: '4', measures: '4', rests: true, weak: true };
  const count = (weight) => {
    const rng = makeRng(5);
    let n = 0;
    for (let i = 0; i < 300; i++) n += g.make(s, { rng, weight }).cells.includes('ses') ? 1 : 0;
    return n;
  };
  assert.ok(count((k) => (k === 'ses' ? 20 : 1)) > count(() => 1) * 1.5);
});

test('壊れた保存値でも作れる', () => {
  const s = sanitizeSettings({ level: '9', time: 'x', measures: 7, rests: 'no' }, g.defaults, g.fields);
  assert.deepEqual(s, g.defaults);
  g.make(s, { rng: makeRng(1) });
});
