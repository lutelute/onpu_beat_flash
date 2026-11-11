// 音程当て：2 つの音の隔たりを答える
import { INTERVALS, spellChord, spelledName } from '../core/music.js';
import { choose, nextStreak, weakField } from './common.js';

const BY_ID = Object.fromEntries(INTERVALS.map((x) => [x.id, x]));
const LOW = 48; // C3
const HIGH = 79; // G5
const DIRS = ['up', 'down', 'harm'];
const DIR_MARK = { up: '↗ 上行', down: '↘ 下行', harm: '同時' };

/** 根音・音程・鳴らし方から音の並びを作る */
export function intervalEvents(root, semi, dir) {
  const top = root + semi;
  if (dir === 'harm') return [{ midi: [root, top], t: 0, d: 1.8 }];
  const [a, b] = dir === 'down' ? [top, root] : [root, top];
  return [
    { midi: [a], t: 0, d: 0.85 },
    { midi: [b], t: 0.8, d: 1.3 },
  ];
}

export const interval = {
  id: 'interval',
  title: '音程当て',
  space: 'ear-interval',
  defaults: { set: ['M2', 'M3', 'P4', 'P5', 'P8'], dir: 'up', weak: false },

  presets: [
    { label: 'はじめ（長3・完全5・8度）', values: { set: ['M3', 'P5', 'P8'] } },
    { label: '基本（長2・長3・完全4・5・8度）', values: { set: ['M2', 'M3', 'P4', 'P5', 'P8'] } },
    { label: '長短（2・3度）', values: { set: ['m2', 'M2', 'm3', 'M3'] } },
    { label: '6・7度', values: { set: ['m6', 'M6', 'm7', 'M7'] } },
    { label: '全部', values: { set: INTERVALS.map((x) => x.id) } },
  ],

  fields: () => [
    {
      key: 'set', type: 'multi', label: '出す音程', min: 2,
      options: INTERVALS.map((x) => ({ id: x.id, label: x.label })),
    },
    {
      key: 'dir', type: 'segmented', label: '鳴らし方',
      options: [
        { id: 'up', label: '上行' },
        { id: 'down', label: '下行' },
        { id: 'harm', label: '同時' },
        { id: 'mix', label: 'まぜる' },
      ],
    },
    weakField,
  ],

  allKeys: () => INTERVALS.map((x) => x.id),
  pool: (s) => INTERVALS.filter((x) => s.set.includes(x.id)).map((x) => ({ key: x.id, ...x })),

  make(s, ctx) {
    const iv = choose(this.pool(s), ctx, { weak: s.weak, repeat: 'max2' });
    const dir = s.dir === 'mix' ? ctx.rng.pick(DIRS) : s.dir;
    const root = ctx.rng.between(LOW, HIGH - iv.semi);
    const top = root + iv.semi;
    return {
      key: iv.id,
      streak: nextStreak(ctx.prev, iv.id),
      answer: iv.id,
      prompt: { type: 'audio', events: intervalEvents(root, iv.semi, dir) },
      reveal: (naming) => {
        const [lo, hi] = spellChord(root, [0, iv.semi], [0, iv.steps]).map((n) => spelledName(n, naming));
        const pair = dir === 'down' ? `${hi} → ${lo}` : dir === 'harm' ? `${lo}・${hi}` : `${lo} → ${hi}`;
        return `${pair}　${iv.label}（半音${iv.semi}個・${DIR_MARK[dir]}）`;
      },
      compare: (id) => intervalEvents(root, BY_ID[id].semi, dir),
    };
  },

  answerPad: (s) => ({
    type: 'choices',
    options: INTERVALS.filter((x) => s.set.includes(x.id)).map((x) => ({ id: x.id, label: x.label })),
  }),
  answerLabel: (id) => BY_ID[id]?.label ?? id,
  keyLabel: (key) => BY_ID[key]?.label ?? key,
  summary: (s) => `${s.set.length}種類／${{ up: '上行', down: '下行', harm: '同時', mix: 'まぜる' }[s.dir]}`,
  signature: (s) => `${s.set.slice().sort().join('+')}|${s.dir}`,
};
