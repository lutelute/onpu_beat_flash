// コード聞き取り：和音の種類（メジャー・マイナー…）を答える
import { CHORDS, spellChord, spelledName } from '../core/music.js';
import { choose, nextStreak, weakField } from './common.js';

const BY_ID = Object.fromEntries(CHORDS.map((x) => [x.id, x]));
const INV_LABEL = ['基本形', '第1転回形', '第2転回形', '第3転回形'];
const ARP = 0.32; // 分散和音の音の間隔（秒）

/** 根音と転回の回数から実際に鳴らす音（低い順）を作る */
export function voicing(root, tones, inversion) {
  let v = tones.map((t) => root + t);
  for (let i = 0; i < inversion; i++) v = [...v.slice(1), v[0] + 12];
  if (v[v.length - 1] > 84) v = v.map((m) => m - 12);
  return v;
}

export function chordEvents(v, play) {
  const block = (t) => ({ midi: v, t, d: 2.0 });
  const arp = v.map((m, i) => ({ midi: [m], t: i * ARP, d: 2.2 - i * ARP }));
  if (play === 'block') return [block(0)];
  if (play === 'arp') return arp;
  return [...arp, block(v.length * ARP + 1.4)];
}

export const chord = {
  id: 'chord',
  title: 'コード聞き取り',
  space: 'ear-chord',
  defaults: { set: ['maj', 'min'], play: 'block', inv: 'root', weak: false },

  presets: [
    { label: 'メジャー・マイナー', values: { set: ['maj', 'min'] } },
    { label: '三和音4種', values: { set: ['maj', 'min', 'dim', 'aug'] } },
    { label: '三和音＋sus4', values: { set: ['maj', 'min', 'dim', 'aug', 'sus4'] } },
    { label: 'セブンス4種', values: { set: ['dom7', 'maj7', 'min7', 'm7b5'] } },
    { label: '全部', values: { set: CHORDS.map((x) => x.id) } },
  ],

  fields: () => [
    {
      key: 'set', type: 'multi', label: '出すコード', min: 2,
      options: CHORDS.map((x) => ({ id: x.id, label: x.label, hint: `C${x.sym}` })),
    },
    {
      key: 'play', type: 'segmented', label: '鳴らし方',
      options: [
        { id: 'block', label: '同時' },
        { id: 'arp', label: '分散' },
        { id: 'both', label: '分散→同時' },
      ],
    },
    {
      key: 'inv', type: 'segmented', label: '転回形',
      options: [
        { id: 'root', label: '基本形だけ' },
        { id: 'all', label: '転回形もまぜる' },
      ],
    },
    weakField,
  ],

  allKeys: () => CHORDS.map((x) => x.id),
  pool: (s) => CHORDS.filter((x) => s.set.includes(x.id)).map((x) => ({ key: x.id, ...x })),

  make(s, ctx) {
    const c = choose(this.pool(s), ctx, { weak: s.weak, repeat: 'max2' });
    const root = ctx.rng.between(48, 59);
    const inversion = s.inv === 'all' ? ctx.rng.int(c.tones.length) : 0;
    const v = voicing(root, c.tones, inversion);
    return {
      key: c.id,
      streak: nextStreak(ctx.prev, c.id),
      answer: c.id,
      prompt: { type: 'audio', events: chordEvents(v, s.play) },
      reveal: (naming) => {
        const notes = spellChord(root, c.tones, c.steps);
        // 鳴らした順（低い順）に並べる：転回した分だけ先頭を後ろへ回す
        const order = [...notes.slice(inversion), ...notes.slice(0, inversion)];
        // コード名の根音は英米式（ドイツ音名のときはドイツ式。B♭ を B、B を H と書く）
        return `${spelledName(notes[0], naming === 'german' ? 'german' : 'english')}${c.sym}　${c.label}（${order.map((n) => spelledName(n, naming)).join('・')}／${INV_LABEL[inversion]}）`;
      },
      compare: (id) => {
        const o = BY_ID[id];
        return chordEvents(voicing(root, o.tones, Math.min(inversion, o.tones.length - 1)), s.play);
      },
    };
  },

  answerPad: (s) => ({
    type: 'choices',
    options: CHORDS.filter((x) => s.set.includes(x.id)).map((x) => ({ id: x.id, label: x.label, hint: x.sym || 'M' })),
  }),
  answerLabel: (id) => BY_ID[id]?.label ?? id,
  keyLabel: (key) => BY_ID[key]?.label ?? key,
  summary: (s) => `${s.set.map((id) => `C${BY_ID[id].sym}`).join(' ')}`,
  signature: (s) => `${s.set.slice().sort().join('+')}|${s.play}|${s.inv}`,
};
