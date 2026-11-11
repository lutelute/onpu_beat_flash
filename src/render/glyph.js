// Bravura の字形（VexFlow に入っている）を SVG の path の d 文字列にする。
// DOM を使わないので、ブラウザでも Node（バナーやアイコンの書き出し）でも使える。
// code 例: noteheadBlack・noteheadWhole・cClef・gClef・fClef・accidentalSharp・accidentalFlat
import { Glyph } from 'vexflow/bravura';

/** 39pt（線の間隔 10）のときの大きさ。x は左端、y は真ん中からの上下 */
export const GLYPH_SIZE = {
  noteheadBlack: { w: 11.9, h: 10.1 },
  noteheadWhole: { w: 17.1, h: 10.1 },
  cClef: { w: 28.3, h: 40.9 },
};

const cache = new Map();
export function glyphPath(code, x = 0, y = 0, point = 39) {
  const key = `${code}|${x}|${y}|${point}`;
  if (cache.has(key)) return cache.get(key);
  let d = '';
  const f = (n) => n.toFixed(2);
  const rec = {
    beginPath() {},
    closePath() { d += 'Z'; },
    fill() {},
    moveTo(a, b) { d += `M${f(a)} ${f(b)}`; },
    lineTo(a, b) { d += `L${f(a)} ${f(b)}`; },
    quadraticCurveTo(a, b, c, e) { d += `Q${f(a)} ${f(b)} ${f(c)} ${f(e)}`; },
    bezierCurveTo(a, b, c, e, g, k) { d += `C${f(a)} ${f(b)} ${f(c)} ${f(e)} ${f(g)} ${f(k)}`; },
  };
  Glyph.renderGlyph(rec, x, y, point, code);
  cache.set(key, d);
  return d;
}
