// 譜読み：五線の音符を見て音名（または鍵盤の高さ）を答える
//
// 出す音 = 音部記号 × 幹音の高さ（step）× 変化（acc: ♯=1, ♭=-1, なし=0）
// 答えの id は、音名で答えるとき半音の位置（'0'〜'11'）、鍵盤で答えるとき MIDI 番号。
// どちらも「鳴る高さ」で比べるので、ファ♯ と ソ♭ のような異名同音はどちらで答えても正解。
import {
  CLEFS, CLEF_ORDER, RANGES, RANGE_ORDER, WHITE_PCS,
  rangeSteps, rangeLabel, letterIndex, midiOfStep, spelledNoteOct, midiLabel, chromaNameFlat,
} from '../core/music.js';
import { choose } from './common.js';

const ACCS = { none: [0], sharp: [0, 1], flat: [0, -1], both: [0, 1, -1] };
// E♯・B♯・F♭・C♭ は出さない（白鍵と同じ高さになり、譜読みの練習として紛らわしい）
const odd = (step, acc) => (acc === 1 && [2, 6].includes(letterIndex(step))) || (acc === -1 && [0, 3].includes(letterIndex(step)));
const keyOf = (clef, step, acc) => `${clef}:${step}:${acc}`;
export const parseReadingKey = (key) => {
  const [clef, step, acc = '0'] = key.split(':');
  return { clef, step: Number(step), acc: Number(acc) };
};

export const reading = {
  id: 'reading',
  title: '譜読み',
  space: 'read',
  defaults: { clefs: ['tenor'], range: 'near', accidentals: 'none', answer: 'name', weak: false },

  fields: (s) => [
    {
      key: 'clefs', type: 'multi', label: '音部記号', min: 1,
      note: '2つ以上選ぶと、1音ごとに記号が入れ替わります',
      options: CLEF_ORDER.map((id) => ({ id, label: CLEFS[id].label, hint: CLEFS[id].kind })),
    },
    {
      key: 'range', type: 'select', label: '出す範囲',
      options: RANGE_ORDER.map((id) => ({
        id,
        label: `${RANGES[id].label}（${(s.clefs?.length ? s.clefs : ['tenor']).map((c) => `${s.clefs.length > 1 ? CLEFS[c].short + ' ' : ''}${rangeLabel(c, id)}`).join('・')}）`,
      })),
    },
    {
      key: 'accidentals', type: 'segmented', label: '臨時記号',
      note: '半分くらいの音に付きます。E♯・B♯・F♭・C♭ は出ません。ファ♯ と ソ♭ のような同じ高さの音は、どちらで答えても正解',
      options: [
        { id: 'none', label: 'なし' },
        { id: 'sharp', label: '♯' },
        { id: 'flat', label: '♭' },
        { id: 'both', label: '♯と♭' },
      ],
    },
    {
      key: 'answer', type: 'segmented', label: '答え方',
      options: [
        { id: 'name', label: '音名で' },
        { id: 'piano', label: '鍵盤で（高さまで）' },
      ],
    },
    { key: 'weak', type: 'toggle', label: '苦手な音を多めに出す' },
  ],

  pool(s) {
    const accs = ACCS[s.accidentals] || [0];
    return s.clefs.flatMap((clef) =>
      rangeSteps(clef, s.range).flatMap((step) =>
        accs.filter((acc) => !odd(step, acc)).map((acc) => ({ key: keyOf(clef, step, acc), clef, step, acc }))));
  },

  /** 記録の画面で使う、ありうる key の全部 */
  allKeys() {
    return CLEF_ORDER.flatMap((clef) =>
      rangeSteps(clef, 'ledger3').flatMap((step) => [0, 1, -1].filter((acc) => !odd(step, acc)).map((acc) => keyOf(clef, step, acc))));
  },

  make(s, ctx) {
    const accs = ACCS[s.accidentals] || [0];
    // 臨時記号なしの音がおよそ半分になるよう重みを付ける
    const base = accs.length > 1 ? (x) => (x.acc === 0 ? accs.length - 1 : 1) : null;
    const it = choose(this.pool(s), ctx, { weak: s.weak, base });
    const r = RANGES[s.range];
    const midi = midiOfStep(it.step, it.acc);
    return {
      key: it.key,
      answer: s.answer === 'piano' ? String(midi) : String(midi % 12),
      prompt: { type: 'staff', clef: it.clef, step: it.step, acc: it.acc, frame: { lo: r.lo, hi: r.hi } },
      sound: [{ midi: [midi], t: 0, d: 0.9 }],
      reveal: (naming) => spelledNoteOct(it.step, it.acc, naming),
    };
  },

  answerPad(s) {
    const black = s.accidentals !== 'none';
    if (s.answer !== 'piano') return black ? { type: 'chroma' } : { type: 'name7', ids: WHITE_PCS.map(String) };
    const steps = s.clefs.flatMap((c) => rangeSteps(c, s.range));
    const lo = Math.min(...steps);
    const hi = Math.max(...steps);
    return { type: 'piano', lo: lo - letterIndex(lo), hi: hi + (6 - letterIndex(hi)), black };
  },

  answerLabel: (id, s, naming) => (s.answer === 'piano' ? midiLabel(Number(id), naming) : chromaNameFlat(Number(id), naming)),

  keyLabel(key, s, naming) {
    const k = parseReadingKey(key);
    return `${CLEFS[k.clef]?.short ?? ''} ${spelledNoteOct(k.step, k.acc, naming)}`;
  },

  summary: (s) =>
    `${s.clefs.map((c) => CLEFS[c].short).join('・')}／${RANGES[s.range].label}${s.accidentals === 'none' ? '' : `／${{ sharp: '♯', flat: '♭', both: '♯♭' }[s.accidentals]}あり`}`,

  signature: (s) => `${s.clefs.slice().sort().join('+')}|${s.range}|${s.accidentals}|${s.answer}`,
};
