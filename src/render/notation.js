// 楽譜の描き手（canvas）：五線・音部記号・音符（加線・臨時記号つき）を Bravura の字形で描く。
// ゲームの進み方は何も知らない。「どの線・間か」「加線は何本か」「音部記号をどの線に置くか」は
// 純粋な関数にしてあり、tests/notation.test.js で確かめる（もとの OtoBattle は加線や記号の位置が違っていた）。
//
// 位置 pos：第1線（いちばん下の線）を 0 とし、線と間を 1 つずつ数える（第5線 = 8。上が正）
import { glyphPath } from './glyph.js';
import { CLEFS, stepOf } from '../core/music.js';

/** 音（step）が五線のどこか */
export const posOf = (clef, step) => step - CLEFS[clef].bottom;

// 音部記号の字形は、決まった線に置く（ト音記号 = ソの線、ヘ音記号 = ファの線、ハ音記号 = ドの線）
const REF = { treble: stepOf('G', 4), bass: stepOf('F', 3) };
/** 音部記号を置く線の位置（ト音 = 2、ヘ音 = 6、アルト = 4、テノール = 6 …） */
export const clefLine = (clef) => (REF[clef] ?? stepOf('C', 4)) - CLEFS[clef].bottom;
const CLEF_GLYPH = { treble: 'gClef', bass: 'fClef' };
export const clefGlyph = (clef) => CLEF_GLYPH[clef] ?? 'cClef';

/** 加線の位置。五線の外の線（偶数の位置）で、音符まで届くもの */
export function ledgerLines(pos) {
  const out = [];
  for (let p = -2; p >= pos; p -= 2) out.push(p);
  for (let p = 10; p <= pos; p += 2) out.push(p);
  return out;
}

/** 臨時記号の字形（なければ null）。natural = 前の音の臨時記号を打ち消す ♮ が要る */
export const accidentalGlyph = (acc = 0, natural = false) =>
  acc > 0 ? 'accidentalSharp' : acc < 0 ? 'accidentalFlat' : natural ? 'accidentalNatural' : null;

/**
 * 小節線のない並びで、♮ が要る音（同じ高さに、前の音の ♯・♭ が効いている）
 * @param list [{ step, acc }]
 * @returns boolean[]
 */
export function naturalsFor(list) {
  const last = new Map();
  return list.map(({ step, acc = 0 }) => {
    const need = !acc && !!last.get(step);
    last.set(step, acc);
    return need;
  });
}

// 音部記号の字形が上下にどこまで届くか（第1線 = 0 の位置。tests で字形の形から確かめている）
export const CLEF_REACH = {
  treble: [-3.3, 10.8], bass: [0.9, 8.1],
  soprano: [-4.1, 4.1], mezzo: [-2.1, 6.1], alto: [-0.1, 8.1], tenor: [1.9, 10.1], baritone: [3.9, 12.1],
};
/** 札に入れる高さ（lo〜hi の位置）：出す範囲と、音部記号の字形の届くところ（上下の余白 1.9 のぶんは差し引く） */
export function staffSpan(frame, clefs) {
  const reach = clefs.map((c) => CLEF_REACH[c] ?? [0, 8]);
  return {
    lo: Math.min(frame.lo, 0, ...reach.map((r) => r[0] + 1.9)),
    hi: Math.max(frame.hi, 8, ...reach.map((r) => r[1] - 1.9)),
  };
}

// 字形の大きさ（線の間隔 g に対する倍率）
export const POINT = 3.9; // 字形の大きさ = 3.9g（線の間隔 10 のとき 39pt）
export const HEAD_W = 1.71; // 全音符の幅
export const ACC_DX = 1.35; // 臨時記号を符頭の左へずらす量

/**
 * canvas に楽譜を描く道具
 * @returns { staff, note, glyph }
 */
export function makeNotation(ctx) {
  const paths = new Map();
  const glyph = (code, point) => {
    const pt = Math.round(point * 4) / 4; // 大きさを丸めて、作り置きが増えすぎないように
    const k = `${code}|${pt}`;
    if (!paths.has(k)) paths.set(k, new Path2D(glyphPath(code, 0, 0, pt)));
    return paths.get(k);
  };
  const fillGlyph = (code, x, y, g) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fill(glyph(code, POINT * g));
    ctx.restore();
  };

  /**
   * 五線と音部記号。staffTop = 第5線の y、g = 線の間隔
   * @returns 位置 pos → y
   */
  function staff(x0, x1, staffTop, clef, color, g) {
    const yOf = (p) => staffTop + (8 - p) * (g / 2);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha *= 0.85;
    ctx.lineWidth = Math.max(1, g / 9);
    ctx.beginPath();
    for (let p = 0; p <= 8; p += 2) {
      ctx.moveTo(x0, yOf(p));
      ctx.lineTo(x1, yOf(p));
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = color;
    fillGlyph(clefGlyph(clef), x0 + g * 0.45, yOf(clefLine(clef)), g);
    return yOf;
  }

  /**
   * 全音符（加線・臨時記号つき）。cx = 符頭の真ん中
   * @param p      { clef, step, acc }
   * @param natural 前の音の臨時記号を打ち消す ♮ を付けるか
   * @returns 符頭の y
   */
  function note(cx, yOf, { clef, step, acc = 0 }, color, g, natural = false) {
    const pos = posOf(clef, step);
    const y = yOf(pos);
    const headW = HEAD_W * g;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, g / 9);
    ctx.beginPath();
    for (const lp of ledgerLines(pos)) {
      ctx.moveTo(cx - headW * 0.85, yOf(lp));
      ctx.lineTo(cx + headW * 0.85, yOf(lp));
    }
    ctx.stroke();
    ctx.fillStyle = color;
    fillGlyph('noteheadWhole', cx - headW / 2, y, g);
    const a = accidentalGlyph(acc, natural);
    if (a) fillGlyph(a, cx - headW / 2 - ACC_DX * g, y, g);
    ctx.restore();
    return y;
  }

  return { staff, note, glyph };
}
