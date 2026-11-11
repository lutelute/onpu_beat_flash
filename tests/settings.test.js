import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, validStat } from '../src/core/settings.js';
import { GENERATORS } from '../src/generators/index.js';
import { GLOBAL_DEFAULTS, globalFields } from '../src/core/globals.js';
import { makeRng } from '../src/core/rng.js';
import { MIC_FLOOR, sensFloor } from '../src/core/pitch.js';

test('壊れた値は初期値に戻り、正しい値は残る', () => {
  const g = GENERATORS.reading;
  const out = sanitizeSettings(
    { clefs: ['bass', 'nope', 'tenor', 'tenor'], range: 'zzz', accidentals: 'both', answer: 42, weak: 'yes', extra: 1 },
    g.defaults, g.fields,
  );
  assert.deepEqual(out.clefs, ['tenor', 'bass']); // 知らない id と重なりを除き、定義の順に
  assert.equal(out.range, g.defaults.range);
  assert.equal(out.accidentals, 'both');
  assert.equal(out.answer, g.defaults.answer);
  assert.equal(out.weak, g.defaults.weak);
  assert.ok(!('extra' in out));
});

test('選べる数の下限を割ったら初期値', () => {
  const g = GENERATORS.interval;
  assert.deepEqual(sanitizeSettings({ set: ['M3'] }, g.defaults, g.fields).set, g.defaults.set); // 2 つ以上
  assert.deepEqual(sanitizeSettings({ set: ['M3', 'P5'] }, g.defaults, g.fields).set, ['M3', 'P5']);
  assert.deepEqual(sanitizeSettings({ set: [] }, g.defaults, g.fields).set, g.defaults.set);
});

test('数値は範囲の中だけ', () => {
  const out = sanitizeSettings({ volume: 5, naming: 'german', theme: 'dark', midi: 'x' }, GLOBAL_DEFAULTS, globalFields);
  assert.equal(out.volume, GLOBAL_DEFAULTS.volume);
  assert.equal(out.naming, 'german');
  assert.equal(out.theme, 'dark');
  assert.equal(out.midi, false);
  for (const bad of [null, 'str', 3, []]) assert.deepEqual(sanitizeSettings(bad, GLOBAL_DEFAULTS, globalFields), GLOBAL_DEFAULTS);
});

test('マイクで聞く楽器は、知っている楽器だけ残る', () => {
  assert.equal(GLOBAL_DEFAULTS.micInstrument, 'any');
  assert.equal(sanitizeSettings({ micInstrument: 'guitar' }, GLOBAL_DEFAULTS, globalFields).micInstrument, 'guitar');
  for (const bad of ['zzz', 12, null, ['bass']]) assert.equal(sanitizeSettings({ micInstrument: bad }, GLOBAL_DEFAULTS, globalFields).micInstrument, 'any');
});

test('マイクの感度は 1〜5 の段だけ残り、初めは今までと同じ「ふつう」。マイクがオンのときだけ、楽器の選択の次に出る', () => {
  assert.equal(GLOBAL_DEFAULTS.micSens, 3);
  assert.equal(sensFloor(GLOBAL_DEFAULTS.micSens), MIC_FLOOR);
  for (const ok of [1, 2, 3, 4, 5]) assert.equal(sanitizeSettings({ micSens: ok }, GLOBAL_DEFAULTS, globalFields).micSens, ok);
  for (const bad of [0, 6, 2.5, '1', null, [2]]) assert.equal(sanitizeSettings({ micSens: bad }, GLOBAL_DEFAULTS, globalFields).micSens, 3, String(bad));
  assert.equal(sanitizeSettings({ mic: true }, GLOBAL_DEFAULTS, globalFields).micSens, 3); // 前の版で保存した設定
  const fields = globalFields(GLOBAL_DEFAULTS);
  const i = fields.findIndex((f) => f.key === 'micSens');
  assert.equal(fields[i - 1].key, 'micInstrument');
  assert.equal(fields[i].label, 'マイクの感度');
  assert.equal(fields[i].show({ ...GLOBAL_DEFAULTS, mic: false }), false);
  assert.equal(fields[i].show({ ...GLOBAL_DEFAULTS, mic: true }), true);
});

test('どんな保存値でも、検査したあとの設定で問題が作れる', () => {
  const junk = [null, {}, { clefs: [] }, { set: 'x' }, { set: ['zzz', 'qq'] }, { range: null, ref: 7, register: 'big', play: [], inv: {} }];
  for (const gen of Object.values(GENERATORS)) {
    for (const j of junk) {
      const s = sanitizeSettings(j, gen.defaults, gen.fields);
      const rng = makeRng(1);
      let prev = null;
      for (let i = 0; i < 20; i++) prev = gen.make(s, { rng, prev });
      assert.ok(gen.answerPad(s).type);
    }
  }
});

test('成績の 1 件の検査', () => {
  assert.ok(validStat({ n: 3, ok: 2, ms: 1000, msN: 2, conf: {} }));
  assert.ok(!validStat({ n: 'x', ok: 0, ms: 0, msN: 0, conf: {} }));
  assert.ok(!validStat({ n: 1, ok: 2, ms: 0, msN: 0, conf: {} }));
  assert.ok(!validStat({ n: 1, ok: 1, ms: 0, msN: 0 }));
  assert.ok(!validStat(null));
});
