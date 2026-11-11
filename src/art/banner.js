// バナーの絵（紺の地に五線とテノール記号、音符が左から順に光る）
// ホームのバナー（動く）と、書き出す画像（SNS 用・README 用。止まった絵）で同じものを使う。DOM は使わない
import { glyphPath, GLYPH_SIZE } from '../render/glyph.js';

export const ART = { navy: '#1f3552', navy2: '#2b4c7e', cream: '#f6f3ec', amber: '#f0a929' };

// テノール記号の上の位置（第1線=0）。中央のド（第4線=6）を中心に動く短い旋律
const MELODY = [6, 4, 7, 5, 8, 6, 3, 5, 9, 6];

/**
 * @param {object} o
 * @param {number} o.w, o.h        絵の大きさ
 * @param {number} [o.sp]          線の間隔
 * @param {number} [o.cy]          五線の真ん中の高さ
 * @param {number} [o.x0], [o.x1]  五線の左右
 * @param {number} [o.notes]       音符の数
 * @param {number} [o.lit]         止まった絵で光らせる音符（0 から）
 * @param {boolean}[o.animate]     音符が順に光る動き
 * @param {boolean}[o.background]  紺の地を描くか
 */
export function bannerArt({ w, h, sp = h * 0.075, cy = h / 2, x0 = w * 0.05, x1 = w * 0.95, notes = 8, lit = 3, animate = false, background = true, id = 'b', align = 'xMidYMid' }) {
  const top = cy - 2 * sp;
  const yOf = (p) => top + 4 * sp - p * (sp / 2);
  const point = (sp / 10) * 39;
  const k = sp / 10;
  const lines = [0, 1, 2, 3, 4]
    .map((i) => `<rect x="${x0}" y="${(top + i * sp - 0.9 * k).toFixed(1)}" width="${x1 - x0}" height="${(1.8 * k).toFixed(1)}" fill="${ART.cream}" opacity="0.32"/>`)
    .join('');
  const clefX = x0 + sp * 0.6;
  const clef = `<path d="${glyphPath('cClef', clefX, yOf(6), point)}" fill="${ART.cream}"/>`;
  const startX = clefX + GLYPH_SIZE.cClef.w * k + sp * 2.2;
  const step = (x1 - sp * 1.2 - startX) / notes;
  const hw = GLYPH_SIZE.noteheadWhole.w * k;
  const dur = notes * 0.45;
  const heads = [];
  for (let i = 0; i < notes; i++) {
    const p = MELODY[i % MELODY.length];
    const x = startX + i * step + (step - hw) / 2;
    const y = yOf(p);
    const ledgers = [];
    for (let lp = 10; lp <= p; lp += 2) ledgers.push(lp);
    for (let lp = -2; lp >= p; lp -= 2) ledgers.push(lp);
    const ledger = ledgers.map((lp) => `<rect x="${(x - 0.35 * sp).toFixed(1)}" y="${(yOf(lp) - 0.9 * k).toFixed(1)}" width="${(hw + 0.7 * sp).toFixed(1)}" height="${(1.8 * k).toFixed(1)}" fill="${ART.cream}" opacity="0.5"/>`).join('');
    const on = !animate && i === lit;
    const glow = `<circle cx="${(x + hw / 2).toFixed(1)}" cy="${y.toFixed(1)}" r="${(sp * 1.6).toFixed(1)}" fill="url(#${id}-glow)" class="${id}-g"${animate ? ` style="animation-delay:${(i * 0.45).toFixed(2)}s"` : ''}${!animate && !on ? ' opacity="0"' : ''}/>`;
    const head = `<path d="${glyphPath('noteheadWhole', +x.toFixed(2), +y.toFixed(2), point)}" class="${id}-n" fill="${on ? ART.amber : ART.cream}"${animate ? ` style="animation-delay:${(i * 0.45).toFixed(2)}s"` : ''}${!animate && !on ? ' opacity="0.75"' : ''}/>`;
    heads.push(ledger + glow + head);
  }
  const style = animate
    ? `<style>
  .${id}-n{animation:${id}-lit ${dur}s infinite;fill:${ART.cream};opacity:.72}
  .${id}-g{animation:${id}-glow ${dur}s infinite;opacity:0}
  @keyframes ${id}-lit{0%{fill:${ART.amber};opacity:1}9%{fill:${ART.amber};opacity:1}16%,100%{fill:${ART.cream};opacity:.72}}
  @keyframes ${id}-glow{0%{opacity:.95}9%{opacity:.8}16%,100%{opacity:0}}
  @media (prefers-reduced-motion: reduce){.${id}-n,.${id}-g{animation:none}}
</style>`
    : '';
  const bg = background
    ? `<rect width="${w}" height="${h}" fill="url(#${id}-bg)"/><circle cx="${w * 0.78}" cy="${h * 0.1}" r="${h * 0.9}" fill="url(#${id}-shine)"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="${align} slice" aria-hidden="true">
<defs>
  <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ART.navy}"/><stop offset="1" stop-color="${ART.navy2}"/></linearGradient>
  <radialGradient id="${id}-shine"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}-glow"><stop offset="0" stop-color="${ART.amber}" stop-opacity="0.55"/><stop offset="1" stop-color="${ART.amber}" stop-opacity="0"/></radialGradient>
</defs>
${style}${bg}${lines}${clef}${heads.join('')}
</svg>`;
}
