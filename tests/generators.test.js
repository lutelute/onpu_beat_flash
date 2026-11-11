// node --test tests/ で動く。生成器は DOM を使わないのでそのまま試せる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEFS, stepOf, letterIndex, midiOfStep, rangeSteps, RANGES, WHITE_PCS } from '../src/core/music.js';
import { makeRng } from '../src/core/rng.js';
import { GENERATORS } from '../src/generators/index.js';
import { voicing } from '../src/generators/chord.js';

const C4 = stepOf('C', 4);

test('ハ音記号は中央ドがそれぞれの線に来る', () => {
  // 位置 p: 第1線=0, 第2線=2, 第3線=4, 第4線=6, 第5線=8
  assert.equal(C4 - CLEFS.tenor.bottom, 6); // テノール = 第4線
  assert.equal(C4 - CLEFS.alto.bottom, 4); // アルト = 第3線
  assert.equal(C4 - CLEFS.mezzo.bottom, 2);
  assert.equal(C4 - CLEFS.soprano.bottom, 0);
  assert.equal(C4 - CLEFS.baritone.bottom, 8);
  assert.equal(stepOf('G', 4) - CLEFS.treble.bottom, 2); // ト音記号 = 第2線の G4
  assert.equal(stepOf('F', 3) - CLEFS.bass.bottom, 6); // ヘ音記号 = 第4線の F3
});

test('テノール記号の範囲', () => {
  const s = rangeSteps('tenor', 'staff');
  assert.equal(s[0], stepOf('D', 3));
  assert.equal(s.at(-1), stepOf('E', 4));
  const l1 = rangeSteps('tenor', 'ledger1');
  assert.equal(l1[0], stepOf('A', 2));
  assert.equal(l1.at(-1), stepOf('A', 4));
  assert.equal(midiOfStep(C4), 60);
});

const SETTINGS = {
  reading: [
    { clefs: ['tenor'], range: 'near', accidentals: 'none', answer: 'name', weak: false },
    { clefs: ['tenor', 'bass', 'treble'], range: 'ledger2', accidentals: 'both', answer: 'piano', weak: true },
    { clefs: ['tenor'], range: 'ledger1', accidentals: 'flat', answer: 'name', weak: true },
  ],
  pitch: [
    { set: 'white', ref: 'C', register: 'mid', weak: false },
    { set: 'chroma', ref: 'none', register: 'wide', weak: true },
  ],
  interval: [
    { set: ['M2', 'M3', 'P4', 'P5', 'P8'], dir: 'up', weak: false },
    { set: ['m2', 'M7', 'TT'], dir: 'mix', weak: true },
  ],
  chord: [
    { set: ['maj', 'min'], play: 'block', inv: 'root', weak: false },
    { set: ['dom7', 'dim7', 'aug', 'sus4'], play: 'both', inv: 'all', weak: true },
  ],
};

for (const [id, list] of Object.entries(SETTINGS)) {
  const gen = GENERATORS[id];
  for (const s of list) {
    test(`${id}: 2000 問つくっても約束どおり（${gen.signature(s)}）`, () => {
      const rng = makeRng(123);
      const keys = new Set(gen.pool(s).map((x) => x.key));
      const pad = gen.answerPad(s);
      let prev = null;
      const seen = new Set();
      for (let i = 0; i < 2000; i++) {
        const q = gen.make(s, { rng, prev, weight: () => 1 + (i % 3) });
        assert.ok(keys.has(q.key), `pool に無い key: ${q.key}`);
        if (prev && keys.size > 1) {
          if (q.prompt.type === 'staff') assert.notEqual(q.key, prev.key, '譜面で同じ音が続いた');
          else assert.ok(!(q.key === prev.key && (prev.streak ?? 1) >= 2), '同じ答えが 3 回続いた');
        }
        assert.equal(typeof q.answer, 'string');
        assert.ok(['staff', 'audio'].includes(q.prompt.type));
        assert.equal(typeof q.reveal('doremi'), 'string');
        if (pad.type === 'choices') assert.ok(pad.options.some((o) => o.id === q.answer));
        if (q.compare) for (const o of pad.options ?? []) assert.ok(Array.isArray(q.compare(o.id)));
        seen.add(q.key);
        prev = q;
      }
      assert.equal(seen.size, keys.size, 'pool の全部が一度は出る');
    });
  }
}

test('譜読みの正解は音符の高さと一致（臨時記号も）', () => {
  const g = GENERATORS.reading;
  const rng = makeRng(7);
  for (const answer of ['name', 'piano']) {
    for (const accidentals of ['none', 'sharp', 'flat', 'both']) {
      const s = { clefs: ['tenor', 'alto'], range: 'ledger1', accidentals, answer, weak: false };
      const pad = g.answerPad(s);
      let altered = 0;
      for (let i = 0; i < 600; i++) {
        const q = g.make(s, { rng });
        const { step, acc } = q.prompt;
        const midi = midiOfStep(step, acc);
        assert.equal(q.answer, answer === 'name' ? String(midi % 12) : String(midi));
        const r = RANGES[s.range];
        const p = step - CLEFS[q.prompt.clef].bottom;
        assert.ok(p >= r.lo && p <= r.hi);
        if (accidentals === 'none') assert.equal(acc, 0);
        if (accidentals === 'sharp') assert.ok(acc >= 0);
        if (accidentals === 'flat') assert.ok(acc <= 0);
        // E♯ B♯ F♭ C♭ は出さない
        assert.ok(!(acc === 1 && [2, 6].includes(letterIndex(step))) && !(acc === -1 && [0, 3].includes(letterIndex(step))));
        if (acc) altered++;
        if (answer === 'piano') {
          assert.ok(midi >= midiOfStep(pad.lo) && midi <= midiOfStep(pad.hi) + 1);
          assert.equal(letterIndex(pad.lo), 0); // 鍵盤は C から
          assert.equal(letterIndex(pad.hi), 6); // B まで
          assert.equal(pad.black, accidentals !== 'none');
        } else {
          assert.equal(pad.type, accidentals === 'none' ? 'name7' : 'chroma');
          if (pad.ids) assert.ok(pad.ids.includes(q.answer));
        }
      }
      if (accidentals !== 'none') assert.ok(altered > 200 && altered < 400, `臨時記号の割合 ${altered}/600`);
    }
  }
});

test('音名当ての正解は鳴らした音と一致', () => {
  const g = GENERATORS.pitch;
  const rng = makeRng(9);
  for (const set of ['white', 'chroma']) {
    const s = { set, ref: 'none', register: 'wide', weak: false };
    for (let i = 0; i < 300; i++) {
      const q = g.make(s, { rng });
      const m = q.prompt.events.at(-1).midi[0];
      const pc = m % 12;
      assert.equal(q.answer, String(pc));
      if (set === 'white') assert.ok(g.answerPad(s).ids.includes(q.answer));
      assert.ok(m >= 36 && m <= 84);
    }
  }
});

test('音程の半音数が合っている', () => {
  const g = GENERATORS.interval;
  const rng = makeRng(11);
  const semi = { m2: 1, M2: 2, m3: 3, M3: 4, P4: 5, TT: 6, P5: 7, m6: 8, M6: 9, m7: 10, M7: 11, P8: 12 };
  const s = { set: Object.keys(semi), dir: 'mix', weak: false };
  for (let i = 0; i < 500; i++) {
    const q = g.make(s, { rng });
    const ms = q.prompt.events.flatMap((e) => e.midi);
    assert.equal(Math.max(...ms) - Math.min(...ms), semi[q.answer]);
    assert.ok(Math.min(...ms) >= 48 && Math.max(...ms) <= 79);
  }
});

test('転回しても構成音（音名）は変わらない', () => {
  const tones = [0, 4, 7, 10];
  const pcs = (v) => v.map((m) => m % 12).sort((a, b) => a - b).join();
  for (let k = 0; k < 4; k++) {
    const v = voicing(55, tones, k);
    assert.equal(pcs(v), pcs(tones.map((t) => 55 + t)));
    assert.deepEqual(v, v.slice().sort((a, b) => a - b), '低い順に並ぶ');
  }
});

test('同じ種なら同じ問題の並び', () => {
  const g = GENERATORS.reading;
  const s = { clefs: ['tenor'], range: 'ledger1', accidentals: 'both', answer: 'name', weak: false };
  const run = (seed) => {
    const rng = makeRng(seed);
    let prev = null;
    return Array.from({ length: 30 }, () => (prev = g.make(s, { rng, prev })).key).join();
  };
  assert.equal(run(4242), run(4242));
  assert.notEqual(run(4242), run(4243));
});

test('音程・和音の綴り', async () => {
  const { spellChord, spelledName, CHORDS, INTERVALS } = await import('../src/core/music.js');
  const names = (pc, semis, steps, nm = 'english') => spellChord(pc, semis, steps).map((n) => spelledName(n, nm)).join(' ');
  const ch = (id) => CHORDS.find((c) => c.id === id);
  assert.equal(names(0, ch('min').tones, ch('min').steps), 'C E♭ G');
  assert.equal(names(1, ch('dim7').tones, ch('dim7').steps), 'C♯ E G B♭'); // 変化記号の少ない方
  assert.equal(names(9, ch('maj').tones, ch('maj').steps, 'german'), 'A Cis E');
  assert.equal(names(10, ch('maj').tones, ch('maj').steps, 'german'), 'B D F'); // B♭ はドイツ音名で B
  assert.equal(names(11, ch('maj').tones, ch('maj').steps, 'german'), 'H Dis Fis');
  assert.equal(names(3, ch('maj').tones, ch('maj').steps, 'japanese'), '変ホ ト 変ロ');
  const iv = (id) => INTERVALS.find((x) => x.id === id);
  assert.equal(names(2, [0, iv('m3').semi], [0, iv('m3').steps], 'doremi'), 'レ ファ');
  assert.equal(names(4, [0, iv('M7').semi], [0, iv('M7').steps], 'doremi'), 'ミ レ♯');
  // どの根音・どの和音でも、綴った音の半音位置は鳴らす音と一致
  const PCS = [0, 2, 4, 5, 7, 9, 11];
  for (let pc = 0; pc < 12; pc++) {
    for (const c of CHORDS) {
      spellChord(pc, c.tones, c.steps).forEach((n, i) => {
        assert.equal((((PCS[n.li] + n.acc) % 12) + 12) % 12, (pc + c.tones[i]) % 12, `${pc} ${c.id}`);
        assert.ok(Math.abs(n.acc) <= 2);
      });
    }
  }
});

test('耳の問題は選択肢が 2 つでも交互にならない', () => {
  for (const [id, s] of [
    ['chord', { set: ['maj', 'min'], play: 'block', inv: 'root', weak: false }],
    ['interval', { set: ['M2', 'M3'], dir: 'up', weak: false }],
  ]) {
    const g = GENERATORS[id];
    const rng = makeRng(99);
    let prev = null;
    let repeats = 0;
    for (let i = 0; i < 400; i++) {
      const q = g.make(s, { rng, prev });
      if (prev && q.key === prev.key) repeats++;
      prev = q;
    }
    assert.ok(repeats > 60, `${id}: 同じ答えが続くことが ${repeats} 回しかない（交互に近い）`);
  }
});
