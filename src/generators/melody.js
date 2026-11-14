// なぞって採点：歌う・弾く旋律（曲・練習・調・音程の目標）。旋律そのものは core/melodies.js、採点は core/singScore.js
// ほかの生成器と違って 1 問ずつ答えるものではないので、成績（苦手の記録）は持たない
import { MELODIES, KEYS, melodyById, keyById, makeMelody } from '../core/melodies.js';
import { TEMPERAMENTS } from '../core/intonation.js';

export const melody = {
  id: 'melody',
  title: 'なぞって採点',
  space: 'sing',
  defaults: { song: 'scale', key: 'C', temper: 'equal' },

  fields: () => [
    {
      key: 'song', type: 'select', label: '曲・練習',
      options: MELODIES.map((m) => ({ id: m.id, label: `${m.kind === 'song' ? '曲' : '練習'}：${m.label}（${m.note}）` })),
      note: '曲は作者の権利が切れた旋律だけです（旋律だけ。歌詞は出ません）',
    },
    { key: 'key', type: 'select', label: '調', options: KEYS.map(({ id, label }) => ({ id, label })) },
    {
      key: 'temper', type: 'segmented', label: '音程の目標',
      options: Object.entries(TEMPERAMENTS).map(([id, t]) => ({ id, label: t.label })),
      note: '平均律はピアノと同じ高さ。純正律は主音に合わせて響く高さ（ミは 14 セント、ラは 16 セント低い）。ピタゴラスは 5 度を重ねた高さで、旋律で導音（シ）を主音へ高めにとる弾き方に近い',
    },
  ],

  allKeys: () => [],
  pool: () => [],
  /** 旋律を 1 つ（毎回ちがう旋律の種は ctx.rng から）。採点の画面が、テンポと楽器を入れて makeMelody で作り直す */
  make(s, { rng }) {
    const seed = 1 + rng.int(1e9);
    return { key: s.song, answer: null, seed, prompt: { type: 'melody' }, melody: makeMelody({ id: s.song, key: s.key, seed }) };
  },
  answerPad: () => ({ type: 'none' }),
  answerLabel: () => '',
  keyLabel: () => '',
  summary: (s) => `${melodyById(s.song).label}／${keyById(s.key).label.replace(/（.*）/, '')}／${TEMPERAMENTS[s.temper]?.label.replace(/（.*）/, '') ?? ''}`,
  signature: (s) => `${s.song}|${s.key}|${s.temper}`,
};
