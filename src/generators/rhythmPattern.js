// リズム練習：リズム譜を見て、音符のところで叩く
//
// 小節を「型（cell）」で埋めて作る。型は 1 拍か 2 拍ぶんの短いリズム（例: 八分音符 2 つ、裏拍、付点）。
// 長さは 16 分音符を 1 とした数（ticks）。1 拍 = 4。
// 成績は型ごとに取るので、苦手な型を多めに出せる。
import { weakField } from './common.js';

/** 型：notes = [[長さ, 休符か]…]、level = 出てくる難しさ、w = 出やすさ */
export const CELLS = [
  { id: 'q', label: '四分音符', notes: [[4, false]], level: 1, w: 5 },
  { id: 'qr', label: '四分休符', notes: [[4, true]], level: 1, w: 1.5, rest: true },
  { id: 'h', label: '二分音符', notes: [[8, false]], level: 1, w: 2 },
  { id: 'hr', label: '二分休符', notes: [[8, true]], level: 1, w: 0.6, rest: true },
  { id: 'e2', label: '八分音符 2 つ', notes: [[2, false], [2, false]], level: 2, w: 4 },
  { id: 're', label: '裏拍（八分休符＋八分）', notes: [[2, true], [2, false]], level: 2, w: 1.5, rest: true },
  { id: 'er', label: '八分＋八分休符', notes: [[2, false], [2, true]], level: 2, w: 1, rest: true },
  { id: 'qde', label: '付点四分＋八分', notes: [[6, false], [2, false]], level: 3, w: 2 },
  { id: 'sync', label: 'シンコペーション（八分・四分・八分）', notes: [[2, false], [4, false], [2, false]], level: 3, w: 2 },
  { id: 'eds', label: '付点八分＋十六分', notes: [[3, false], [1, false]], level: 3, w: 2 },
  { id: 's4', label: '十六分音符 4 つ', notes: [[1, false], [1, false], [1, false], [1, false]], level: 4, w: 3 },
  { id: 'ess', label: '八分＋十六分 2 つ', notes: [[2, false], [1, false], [1, false]], level: 4, w: 2.5 },
  { id: 'sse', label: '十六分 2 つ＋八分', notes: [[1, false], [1, false], [2, false]], level: 4, w: 2.5 },
  { id: 'ses', label: '十六分・八分・十六分', notes: [[1, false], [2, false], [1, false]], level: 4, w: 1.5 },
];
const BY_ID = Object.fromEntries(CELLS.map((c) => [c.id, c]));
const ticksOf = (c) => c.notes.reduce((s, [t]) => s + t, 0);

const LEVELS = {
  1: '四分と二分',
  2: '八分音符も',
  3: '付点・シンコペーションも',
  4: '十六分音符も',
};

export const rhythmPattern = {
  id: 'rhythmPattern',
  title: 'リズム練習',
  space: 'rhythm-cell',
  defaults: { level: '2', time: '4', measures: '2', rests: true, weak: false },

  presets: [
    { label: 'はじめ（四分・二分）', values: { level: '1', rests: false } },
    { label: '八分音符', values: { level: '2' } },
    { label: '付点・シンコペーション', values: { level: '3' } },
    { label: '十六分音符', values: { level: '4' } },
  ],

  fields: () => [
    { key: 'level', type: 'segmented', label: '出てくるリズム', options: Object.entries(LEVELS).map(([id, label]) => ({ id, label })) },
    { key: 'time', type: 'segmented', label: '拍子', options: [{ id: '2', label: '2/4' }, { id: '3', label: '3/4' }, { id: '4', label: '4/4' }] },
    { key: 'measures', type: 'segmented', label: '小節の数', options: [{ id: '1', label: '1小節' }, { id: '2', label: '2小節' }, { id: '4', label: '4小節' }] },
    { key: 'rests', type: 'toggle', label: '休符を入れる' },
    { ...weakField, label: '苦手なリズムを多めに出す' },
  ],

  /** いまの設定で出る型 */
  pool: (s) => CELLS.filter((c) => c.level <= Number(s.level) && (s.rests || !c.rest)).map((c) => ({ key: c.id, ...c })),
  allKeys: () => CELLS.map((c) => c.id),

  make(s, ctx) {
    const { rng, weight } = ctx;
    const pool = this.pool(s);
    const beats = Number(s.time);
    const measures = [];
    const cellsUsed = [];
    for (let m = 0; m < Number(s.measures); m++) {
      const notes = [];
      let left = beats * 4;
      let tries = 0;
      while (left > 0) {
        // 残りの拍に入る型だけ。2 拍の型は拍の頭から
        const fit = pool.filter((c) => ticksOf(c) <= left);
        // 1 小節が休符だらけにならないよう、休符の型は音のある型のあとだけ
        const hasNote = notes.some((n) => !n.rest);
        const cands = fit.filter((c) => !c.rest || hasNote || tries > 6);
        tries++;
        const pickFrom = cands.length ? cands : fit;
        const c = rng.weighted(pickFrom, (x) => x.w * (s.weak && weight ? weight(x.key) : 1));
        let first = true;
        for (const [t, rest] of c.notes) {
          notes.push({ ticks: t, rest, cell: c.id, cellStart: first });
          first = false;
        }
        cellsUsed.push(c.id);
        left -= ticksOf(c);
      }
      // 小節が全部休符なら、頭を四分音符にする
      if (!notes.some((n) => !n.rest)) {
        notes.splice(0, notes.length, ...notes.map((n, i) => (i === 0 ? { ...n, rest: false, cell: 'q' } : n)));
      }
      measures.push(notes);
    }
    // 叩く時刻（拍）：休符でない音符の頭
    const onsets = [];
    let pos = 0;
    measures.forEach((notes, mi) => notes.forEach((n, ni) => {
      if (!n.rest) onsets.push({ beat: pos / 4, measure: mi, index: ni, cell: n.cell });
      pos += n.ticks;
    }));
    return {
      key: cellsUsed.join(','),
      prompt: { type: 'rhythm', beats, measures },
      onsets,
      cells: [...new Set(cellsUsed)],
      reveal: () => '',
    };
  },

  answerPad: () => ({ type: 'tap' }), // 叩くボタン 1 つ（modes/tap.js）
  keyLabel: (key) => BY_ID[key]?.label ?? key,
  answerLabel: (id) => id,
  summary: (s) => `${LEVELS[s.level]}／${s.time}/4・${s.measures}小節`,
  signature: (s) => `${s.level}|${s.time}|${s.measures}|${s.rests ? 'r' : ''}`,
};

export const cellById = (id) => BY_ID[id];
