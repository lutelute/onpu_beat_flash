// VexFlow で五線と音符を SVG 文字列にする
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } from 'vexflow/bravura';
import { CLEFS, vfKey, accVF } from '../core/music.js';

const SP = 10; // 線の間隔（VexFlow の既定）
const STAVE_Y = 60;

/** staffSVG の座標（自前で音符を描き足すとき用）。位置 p の音符の y = bottomY - p * half */
export const STAFF = { topY: STAVE_Y + 4 * SP, bottomY: STAVE_Y + 8 * SP, half: SP / 2 };
const scratch = document.createElement('div');
const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * @param {object} o
 * @param {string} o.clef     音部記号の id（music.js の CLEFS）
 * @param {Array}  o.items    [{ step, acc?, color?, label?, sub? }]（acc: ♯=1 ♭=-1）
 * @param {object} [o.frame]  { lo, hi } 位置（第1線=0）。表示の高さをそろえるため
 * @param {number} [o.width]
 * @param {boolean}[o.showClef]
 * @param {number} [o.gap]    音符どうしの間隔
 * @param {number} [o.slots]  音符の置き場の数。指定すると左から順に並べ（1 つでも中央に寄せない）、item.slot の位置に置く
 * @returns {string} SVG 文字列
 */
export function staffSVG({ clef, items = [], frame, width, showClef = true, gap = 44, slots }) {
  const c = CLEFS[clef];
  const ps = items.map((it) => it.step - c.bottom);
  const lo = Math.min(frame?.lo ?? 0, 0, ...ps);
  const hi = Math.max(frame?.hi ?? 8, 8, ...ps);
  const hasLabel = items.some((it) => it.label != null);
  const hasSub = items.some((it) => it.sub != null);

  const padTop = Math.max(1.6, (hi - 8) / 2 + 1.1) * SP;
  const padBot = Math.max(1.6, -lo / 2 + 1.1) * SP + (hasLabel ? 20 : 0) + (hasSub ? 16 : 0);

  const clefW = showClef ? 52 : 14;
  const single = slots == null && items.length <= 1;
  const W = width ?? (single ? 170 : clefW + 18 + (slots ?? items.length) * gap);

  const staveY = STAVE_Y;
  const topLine = staveY + 4 * SP;
  const H = topLine + 4 * SP + padBot + 20;

  scratch.innerHTML = '';
  const renderer = new Renderer(scratch, Renderer.Backends.SVG);
  renderer.resize(W, H);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const stave = new Stave(1, staveY, W - 2, { right_bar: false });
  stave.setStyle({ fillStyle: 'currentColor', strokeStyle: 'currentColor' });
  if (showClef) stave.addClef(c.vf);
  stave.setContext(ctx).draw();

  const startX = stave.getNoteStartX();
  const xs = [];
  // 小節線のない 1 本の五線では、前の臨時記号が後ろの同じ高さの音にも効く。
  // 臨時記号の無い音の前に同じ高さの ♯・♭ があったら、♮ を付けて「元の音」だと示す
  const lastAcc = new Map();
  const notes = items.map((it) => {
    const note = new StaveNote({ clef: c.vf, keys: [vfKey(it.step, it.acc)], duration: 'w' });
    if (it.acc) note.addModifier(new Accidental(accVF(it.acc)), 0);
    else if (lastAcc.get(it.step)) note.addModifier(new Accidental('n'), 0);
    lastAcc.set(it.step, it.acc ?? 0);
    if (it.color) {
      note.setStyle({ fillStyle: it.color, strokeStyle: it.color });
      note.setLedgerLineStyle({ fillStyle: it.color, strokeStyle: it.color, lineWidth: 1.6 });
      note.getModifiers().forEach((m) => m.setStyle({ fillStyle: it.color, strokeStyle: it.color }));
    }
    note.setStave(stave);
    return note;
  });
  if (notes.length) {
    // 臨時記号の置き場を VexFlow に計算させてから、音符を決まった位置へずらす
    const voice = new Voice({ num_beats: 4 * notes.length, beat_value: 4 }).setMode(Voice.Mode.SOFT).addTickables(notes);
    new Formatter().joinVoices([voice]).format([voice], Math.max(20, W - startX - 20));
    notes.forEach((note, i) => {
      const tc = note.getTickContext();
      const want = single ? (startX + W) / 2 - 4 : startX + 16 + (items[i].slot ?? i) * gap;
      tc.setX(tc.getX() + want - note.getAbsoluteX());
      note.setContext(ctx).draw();
      xs.push(want + 8);
    });
  }

  const svg = scratch.querySelector('svg');
  const yLabel = topLine + 4 * SP + Math.max(1.6, -lo / 2 + 1.1) * SP + 14;
  items.forEach((it, i) => {
    if (it.label != null) addText(svg, xs[i], yLabel, it.label, String(it.label).length > 3 ? 11 : 13, it.labelColor ?? it.color, 700);
    if (it.sub != null) addText(svg, xs[i], yLabel + 16, it.sub, 10.5, null, 400, 0.7);
  });

  const vbY = topLine - padTop;
  svg.setAttribute('viewBox', `0 ${vbY} ${W} ${padTop + 4 * SP + padBot}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', items.length ? '五線の音符' : '五線');
  svg.setAttribute('style', `--w:${W};--n:${slots ?? items.length}`);
  return scratch.innerHTML;
}

function addText(svg, x, y, str, size, color, weight, opacity = 1) {
  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('font-size', size);
  t.setAttribute('font-weight', weight);
  t.setAttribute('font-family', 'system-ui, -apple-system, "Hiragino Sans", sans-serif');
  t.setAttribute('fill', color || 'currentColor');
  t.setAttribute('stroke', 'none');
  if (opacity !== 1) t.setAttribute('opacity', opacity);
  t.textContent = str;
  svg.appendChild(t);
}

// 判定の色（明暗どちらでも読める濃さ）
export const COLOR = {
  ok: '#1e9e5a',
  ng: '#d8433b',
  warn: '#d18a12',
  mute: '#9a958c',
};

// 字形の path は glyph.js（DOM を使わない）にある。ここからも使えるように出しておく
export { glyphPath } from './glyph.js';
