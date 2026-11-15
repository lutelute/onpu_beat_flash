// 音名当て：鳴った 1 音の名前を答える（基準音つきなら相対音感、なしなら絶対音感の練習）
import { WHITE_PCS, chromaNameFlat, midiLabel } from '../core/music.js';
import { choose, nextStreak, weakField } from './common.js';

const REGISTERS = {
  mid: { label: '中央のオクターブ（C4–B4）', lo: 60, hi: 71 },
  two: { label: '2オクターブ（C3–B4）', lo: 48, hi: 71 },
  wide: { label: '広く（C2–C6）', lo: 36, hi: 84 },
};
const REFS = { none: null, C: 60, A: 69 };
/** 白鍵の MIDI 番号 → 五線の位置（step。C4 = 28） */
const stepOfWhite = (m) => 7 * (Math.floor(m / 12) - 1) + WHITE_PCS.indexOf(m % 12);

export const pitch = {
  id: 'pitch',
  title: '音名当て',
  space: 'ear-pitch',
  spaces: [
    { id: 'ear-pitch', title: '音名当て（基準の音あり）' },
    { id: 'ear-pitch-abs', title: '音名当て（基準の音なし）' },
  ],
  spaceOf: (s) => (s.ref === 'none' ? 'ear-pitch-abs' : 'ear-pitch'),
  defaults: { set: 'white', ref: 'C', register: 'mid', answer: 'name', weak: false },
  // 答えは鳴った高さ（楽譜に書く高さではない）。マイクでギターを弾いても、聞こえた高さのまま比べる（modes/quiz.js）
  sounding: true,

  fields: () => [
    {
      key: 'set', type: 'segmented', label: '出す音',
      options: [{ id: 'white', label: '幹音（白鍵の7音）' }, { id: 'chroma', label: '12音（黒鍵も）' }],
    },
    {
      key: 'ref', type: 'segmented', label: '基準の音',
      note: '基準の音を聞いてから答えると相対音感、なしは絶対音感の練習',
      options: [
        { id: 'C', label: '毎回ドを先に' },
        { id: 'A', label: '毎回ラ（A4）を先に' },
        { id: 'none', label: 'なし' },
      ],
    },
    {
      key: 'register', type: 'select', label: '音域',
      options: Object.entries(REGISTERS).map(([id, r]) => ({ id, label: r.label })),
    },
    {
      key: 'answer', type: 'segmented', label: '答え方',
      note: '高さまで：鳴った音と同じ高さ（オクターブ）まで合わないと正解になりません。画面では横長の鍵盤で、マイク・MIDI 鍵盤では同じ高さで弾いて（歌って）答えます',
      options: [{ id: 'name', label: '音名で' }, { id: 'piano', label: '高さまで（オクターブも）' }],
    },
    weakField,
  ],

  allKeys: () => [...Array(12).keys()].map((pc) => `pc${pc}`),
  pool: (s) => (s.set === 'white' ? WHITE_PCS : [...Array(12).keys()]).map((pc) => ({ key: `pc${pc}`, pc })),

  make(s, ctx) {
    const { pc } = choose(this.pool(s), ctx, { weak: s.weak, repeat: 'max2' });
    const reg = REGISTERS[s.register];
    const cands = [];
    for (let m = reg.lo; m <= reg.hi; m++) if (m % 12 === pc) cands.push(m);
    const midi = ctx.rng.pick(cands);
    const ref = REFS[s.ref];
    const at = ref == null ? 0 : 1.0;
    const pre = ref == null ? [] : [{ midi: [ref], t: 0, d: 0.75 }];
    const octBase = midi - pc;
    return {
      key: `pc${pc}`,
      streak: nextStreak(ctx.prev, `pc${pc}`),
      answer: s.answer === 'piano' ? String(midi) : String(pc),
      prompt: { type: 'audio', events: [...pre, { midi: [midi], t: at, d: 1.3 }] },
      reveal: (naming) => midiLabel(midi, naming),
      compare: (id) => [...pre, { midi: [s.answer === 'piano' ? Number(id) : octBase + Number(id)], t: at, d: 1.3 }],
    };
  },

  // 音名で：答えの id はどちらも半音の位置（'0'〜'11'）。幹音だけのときは 7 つのボタンに白鍵の位置を割り当てる
  // 高さまで：id は MIDI 番号。音域の鍵盤（幹音だけのときは白鍵だけ）
  answerPad(s) {
    if (s.answer === 'piano') {
      const r = REGISTERS[s.register] ?? REGISTERS.mid;
      return { type: 'piano', lo: stepOfWhite(r.lo), hi: stepOfWhite(r.hi), black: s.set !== 'white' };
    }
    return s.set === 'white' ? { type: 'name7', ids: WHITE_PCS.map(String) } : { type: 'chroma' };
  },
  answerLabel: (id, s, naming) => (s.answer === 'piano' ? midiLabel(Number(id), naming) : chromaNameFlat(Number(id), naming)),
  keyLabel: (key, s, naming) => chromaNameFlat(Number(key.slice(2)), naming),
  summary: (s) => `${s.set === 'white' ? '幹音7音' : '12音'}／${s.ref === 'none' ? '基準音なし' : s.ref === 'C' ? 'ドを先に' : 'ラを先に'}${s.answer === 'piano' ? '／高さまで' : ''}`,
  // 音名で答える記録は、答え方を足す前と同じ鍵のまま
  signature: (s) => `${s.set}|${s.ref}|${s.register}${s.answer === 'piano' ? '|piano' : ''}`,
};
