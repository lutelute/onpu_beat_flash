// アプリの中のアイコン（48 マス・線は currentColor）。音符や記号は楽譜と同じ Bravura の字形を使う
import { glyphPath } from '../render/glyph.js';

const W_HEAD = 11.9; // 黒い符頭の幅（39pt のとき）
const fill = (d, op = 1) => `<path d="${d}" fill="currentColor" stroke="none"${op < 1 ? ` opacity="${op}"` : ''}/>`;
/** 符頭を中心 (cx, cy)・大きさ s（1 = 39pt）で */
const head = (cx, cy, s = 0.7) => fill(glyphPath('noteheadBlack', +(cx - (W_HEAD * s) / 2).toFixed(2), cy, 39 * s));
const staff = (ys, x1 = 6, x2 = 42) => ys.map((y) => `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke-width="1.6" opacity="0.38"/>`).join('');
const svg = (inner) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

const DRAW = {
  // 五線の音符に稲妻
  flash: () => svg(`${staff([17, 24, 31], 5, 34)}${head(17, 27.5, 0.78)}<path d="M33 5 L26 20 L32 20 L28 33 L41 15 L35 15 L39 5 Z" fill="currentColor" stroke="none"/>`),
  // ストップウォッチ
  quick: () => svg(`<circle cx="24" cy="27" r="14"/><path d="M20 7 h8 M24 7 v6 M35 14 l3 -3"/><path d="M24 27 L30 20"/><circle cx="24" cy="27" r="2.2" fill="currentColor" stroke="none"/>`),
  // 線へ流れてくる音符
  rhythm: () => svg(`${staff([17, 24, 31])}<line x1="14" x2="14" y1="9" y2="39" stroke-width="3"/>${head(25, 20.5, 0.78)}${head(36.5, 27.5, 0.78)}<path d="M40 11 h3 M38 37 h5" stroke-width="2" opacity="0.5"/>`),
  // 鳴った音（四分音符と音の波）
  pitch: () => svg(`${head(16, 33, 0.95)}<line x1="21.4" x2="21.4" y1="32" y2="9"/><path d="M29 18 q4 5 0 10 M34 13 q8 10 0 20" stroke-width="2.4"/>`),
  // 2 つの音と隔たり
  interval: () => svg(`${staff([15, 24, 33], 6, 30)}${head(17, 33, 0.8)}${head(17, 15, 0.8)}<path d="M37 12 v24 M33 16 l4 -4 l4 4 M33 32 l4 4 l4 -4" stroke-width="2.4"/>`),
  // 重なった 3 つの音
  chord: () => svg(`${staff([15, 24, 33], 8, 40)}${head(24, 33, 0.85)}${head(24, 24, 0.85)}${head(24, 15, 0.85)}<line x1="30" x2="30" y1="14" y2="8" opacity="0"/>`),
  // ハ音記号（読み方ガイド）
  guide: () => svg(`${staff([12, 18, 24, 30, 36], 6, 42)}${fill(glyphPath('cClef', 13, 24, 39 * 0.66))}`),
  // 歯車（設定）
  settings: () => svg(`<circle cx="24" cy="24" r="6"/><path d="M24 6 v5 M24 37 v5 M6 24 h5 M37 24 h5 M11.3 11.3 l3.5 3.5 M33.2 33.2 l3.5 3.5 M11.3 36.7 l3.5 -3.5 M33.2 14.8 l3.5 -3.5"/><circle cx="24" cy="24" r="12.5"/>`),
  // 棒グラフ
  stats: () => svg(`<path d="M8 39 H40"/><rect x="11" y="26" width="6" height="10" rx="1.5" fill="currentColor" stroke="none" opacity="0.55"/><rect x="21" y="18" width="6" height="18" rx="1.5" fill="currentColor" stroke="none" opacity="0.8"/><rect x="31" y="10" width="6" height="26" rx="1.5" fill="currentColor" stroke="none"/>`),
  // i
  about: () => svg(`<circle cx="24" cy="24" r="16"/><circle cx="24" cy="16.5" r="2.2" fill="currentColor" stroke="none"/><path d="M24 22 V33"/>`),
  // 人（アカウント）
  account: () => svg(`<circle cx="24" cy="17" r="7.5"/><path d="M9 41 C9 31.5 15.5 27.5 24 27.5 C32.5 27.5 39 31.5 39 41"/>`),
  // メトロノーム（リズム練習）
  tap: () => svg(`<path d="M17 41 L21 8 H27 L31 41 Z"/><path d="M12 41 H36"/><path d="M24 33 L35 14" stroke-width="2.8"/><circle cx="31.6" cy="19.8" r="2.6" fill="currentColor" stroke="none"/>`),
  // 共有
  share: () => svg(`<circle cx="34" cy="12" r="5"/><circle cx="14" cy="24" r="5"/><circle cx="34" cy="36" r="5"/><path d="M19 21.5 L29.5 14.5 M19 26.5 L29.5 33.5"/>`),
  // 再生（もう一度聞く）
  play: () => svg(`<path d="M17 12 L36 24 L17 36 Z" fill="currentColor"/>`),
  // 戻る・もう一度
  replay: () => svg(`<path d="M12 22 A13 13 0 1 1 15 33"/><path d="M8 15 L12 23 L20 19"/>`),
  pause: () => svg(`<rect x="14" y="12" width="6.5" height="24" rx="2" fill="currentColor" stroke="none"/><rect x="27.5" y="12" width="6.5" height="24" rx="2" fill="currentColor" stroke="none"/>`),
  // 照準の中の音符（オトバトル）
  battle: () => svg(`${staff([18, 24, 30], 6, 42)}${head(24, 24, 0.85)}<circle cx="24" cy="24" r="11.5"/><path d="M24 5 v6 M24 37 v6 M5 24 h6 M37 24 h6" stroke-width="2.4"/>`),
};

const cache = new Map();
/** アイコンの SVG 文字列 */
export function icon(name) {
  if (!cache.has(name)) cache.set(name, DRAW[name]?.() ?? '');
  return cache.get(name);
}
