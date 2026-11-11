// 楽譜の描き手（render/notation.js）の位置の計算。もとの OtoBattle で間違っていたところ（ヘ音記号の B3・アルト記号の A4 の加線）も確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posOf, clefLine, clefGlyph, ledgerLines, accidentalGlyph, naturalsFor, CLEF_REACH, staffSpan } from '../src/render/notation.js';
import { glyphPath } from '../src/render/glyph.js';
import { stepOf, CLEF_ORDER, RANGES } from '../src/core/music.js';

const at = (clef, name) => {
  const m = /^([A-G])(\d)$/.exec(name);
  return posOf(clef, stepOf(m[1], Number(m[2])));
};

test('音の位置：五線の線と間（第1線 = 0、第5線 = 8）', () => {
  assert.equal(at('treble', 'E4'), 0);
  assert.equal(at('treble', 'F5'), 8);
  assert.equal(at('treble', 'C4'), -2);
  assert.equal(at('bass', 'G2'), 0);
  assert.equal(at('bass', 'A3'), 8);
  assert.equal(at('alto', 'C4'), 4); // 第3線がド
  assert.equal(at('tenor', 'C4'), 6); // 第4線がド
  assert.equal(at('soprano', 'C4'), 0); // 第1線がド
  assert.equal(at('mezzo', 'C4'), 2); // 第2線がド
  assert.equal(at('baritone', 'C4'), 8); // 第5線がド
});

test('音部記号は決まった線に置く（ト音 = 第2線、ヘ音 = 第4線、ハ音 = ドの線）', () => {
  const want = { treble: 2, bass: 6, alto: 4, tenor: 6, soprano: 0, mezzo: 2, baritone: 8 };
  for (const [clef, line] of Object.entries(want)) assert.equal(clefLine(clef), line, clef);
  assert.equal(clefGlyph('treble'), 'gClef');
  assert.equal(clefGlyph('bass'), 'fClef');
  for (const c of ['alto', 'tenor', 'soprano', 'mezzo', 'baritone']) assert.equal(clefGlyph(c), 'cClef');
});

test('加線：五線の外で、音符まで届く線だけ', () => {
  assert.deepEqual(ledgerLines(-1), []); // 第1線のすぐ下の間（ト音の D4）は加線なし
  assert.deepEqual(ledgerLines(-2), [-2]); // ト音の C4
  assert.deepEqual(ledgerLines(-3), [-2]); // ト音の B3
  assert.deepEqual(ledgerLines(-6), [-2, -4, -6]);
  assert.deepEqual(ledgerLines(9), []); // 第5線のすぐ上の間
  assert.deepEqual(ledgerLines(10), [10]);
  assert.deepEqual(ledgerLines(13), [10, 12]);
  for (let p = 0; p <= 8; p++) assert.deepEqual(ledgerLines(p), []);
  // もとの OtoBattle で加線を引いていた音：どちらも五線のすぐ上の間なので加線は要らない
  assert.deepEqual(ledgerLines(at('bass', 'B3')), []);
  assert.deepEqual(ledgerLines(at('alto', 'A4')), []);
  // 中央のドは、ト音では下、ヘ音では上に加線 1 本
  assert.deepEqual(ledgerLines(at('treble', 'C4')), [-2]);
  assert.deepEqual(ledgerLines(at('bass', 'C4')), [10]);
});

test('臨時記号と ♮：小節線のない並びでは、前の ♯・♭ が同じ高さに効いている', () => {
  assert.equal(accidentalGlyph(1), 'accidentalSharp');
  assert.equal(accidentalGlyph(-1), 'accidentalFlat');
  assert.equal(accidentalGlyph(0), null);
  assert.equal(accidentalGlyph(0, true), 'accidentalNatural');
  const F4 = stepOf('F', 4);
  const G4 = stepOf('G', 4);
  const F5 = stepOf('F', 5);
  assert.deepEqual(naturalsFor([{ step: F4, acc: 1 }, { step: G4 }, { step: F4 }, { step: F4 }]), [false, false, true, false]);
  assert.deepEqual(naturalsFor([{ step: F4, acc: 1 }, { step: F5 }]), [false, false]); // オクターブ違いは別の高さ
  assert.deepEqual(naturalsFor([{ step: F4 }, { step: F4, acc: -1 }, { step: F4, acc: 1 }]), [false, false, false]);
});

// 字形の形（path の点）から、音部記号が上下にどこまで届くかを測る
function reachOf(clef) {
  const d = glyphPath(clefGlyph(clef), 0, 0, 39); // 線の間隔 10 → 位置 1 つ = 5
  const ys = [];
  for (const m of d.matchAll(/[MLQC]([^MLQCZ]+)/g)) {
    const nums = m[1].trim().split(/\s+/).map(Number);
    ys.push(nums[nums.length - 1]); // 曲線は終わりの点（線の上の点）だけ
  }
  const line = clefLine(clef);
  return [line - Math.max(...ys) / 5, line - Math.min(...ys) / 5];
}

test('音部記号の字形の届くところ（CLEF_REACH）は、字形の形と合っている', () => {
  for (const clef of CLEF_ORDER) {
    const [lo, hi] = reachOf(clef);
    assert.ok(Math.abs(lo - CLEF_REACH[clef][0]) < 0.35, `${clef} 下 ${lo.toFixed(2)} / ${CLEF_REACH[clef][0]}`);
    assert.ok(Math.abs(hi - CLEF_REACH[clef][1]) < 0.35, `${clef} 上 ${hi.toFixed(2)} / ${CLEF_REACH[clef][1]}`);
  }
});

test('札の高さは、出す範囲の音と音部記号の字形が入る大きさ', () => {
  for (const r of Object.values(RANGES)) {
    for (const clef of CLEF_ORDER) {
      const { lo, hi } = staffSpan(r, [clef]);
      assert.ok(lo <= r.lo && hi >= r.hi, '出す範囲が入る');
      // 余白 1.9（線の間隔の約 1 つ分）を足せば、字形も入る
      assert.ok(lo - 1.9 <= CLEF_REACH[clef][0] + 1e-9 && hi + 1.9 >= CLEF_REACH[clef][1] - 1e-9, clef);
    }
  }
});
