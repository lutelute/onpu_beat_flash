// 「なぞって採点」で歌う・弾く旋律（画面は使わない。Node のテストでも動く）
//   ・練習：音階・3 度の音階・ロングトーン・分散和音・毎回ちがう旋律
//   ・曲：作者の権利が切れた（または民謡の）旋律だけ。旋律だけを使い、歌詞は使わない
// 旋律はハ長調で書き、選んだ調へ移す。拍で書き、テンポで秒にする
import { makeRng } from './rng.js';

// 曲：'C4:2' は C4 を 2 拍、拍を省くと 1 拍、'r' は休み。'|' は小節の区切り（読み飛ばす。テストで拍の数を確かめる）
const SONGS = {
  twinkle: {
    label: 'きらきら星', note: 'フランスの古い歌',
    score: 'C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2',
  },
  mary: {
    label: 'メリーさんのひつじ', note: 'アメリカの古い歌',
    score: 'E4 D4 C4 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4 G4:2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4',
  },
  frog: {
    label: 'かえるの合唱', note: 'ドイツの古い歌',
    score: 'C4 D4 E4 F4 | E4 D4 C4:2 | E4 F4 G4 A4 | G4 F4 E4:2 | C4 r C4 r | C4 r C4 r | C4:0.5 C4:0.5 D4:0.5 D4:0.5 E4:0.5 E4:0.5 F4:0.5 F4:0.5 | E4 D4 C4:2',
  },
  joy: {
    label: 'よろこびの歌', note: 'ベートーヴェン 交響曲第 9 番',
    score: 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2',
  },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const deg = (d) => 60 + 12 * Math.floor(d / 7) + MAJOR[((d % 7) + 7) % 7]; // 音階の何番め（0 = 主音）→ ハ長調の MIDI
const seq = (degs, beats) => degs.map((d) => ({ midi: deg(d), beats }));

// 練習（拍の長さは、ゆっくり音程を確かめられるように長め）
const EXERCISES = {
  scale: {
    label: '音階（上って下りる）', note: '1 音 2 拍',
    make: () => [...seq([0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1], 2), { midi: deg(0), beats: 4 }],
  },
  thirds: {
    label: '3 度の音階', note: 'ド・ミ、レ・ファ…と 3 度ずつ',
    make: () => [...seq([0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 2, 0], 1), { midi: deg(0), beats: 4 }],
  },
  longtone: {
    label: 'ロングトーン', note: '1 音 4 拍。揺れずに伸ばす',
    make: () => seq([0, 2, 4, 7, 4, 2, 0], 4),
  },
  arpeggio: {
    label: '分散和音', note: 'ド・ミ・ソ・ドの上り下り',
    make: () => [...seq([0, 2, 4, 7, 4, 2, 0, 2, 4, 7, 4, 2], 1), { midi: deg(0), beats: 4 }],
  },
  random: {
    label: '毎回ちがう旋律', note: '8 小節。となりの音へ動くことが多い',
    make: (rng) => randomMelody(rng),
  },
};

export const MELODIES = [
  ...Object.entries(EXERCISES).map(([id, x]) => ({ id, kind: 'exercise', label: x.label, note: x.note })),
  ...Object.entries(SONGS).map(([id, x]) => ({ id, kind: 'song', label: x.label, note: x.note })),
];
export const melodyById = (id) => MELODIES.find((m) => m.id === id) ?? MELODIES[0];

/** 調（長調）。semi はハ長調から何半音上げるか。弦楽器に多いト・ニ・イ、管楽器に多いヘ・変ロ・変ホ */
export const KEYS = [
  { id: 'C', semi: 0, label: 'ハ長調（C）' },
  { id: 'G', semi: 7, label: 'ト長調（G）' },
  { id: 'D', semi: 2, label: 'ニ長調（D）' },
  { id: 'A', semi: 9, label: 'イ長調（A）' },
  { id: 'F', semi: 5, label: 'ヘ長調（F）' },
  { id: 'Bb', semi: 10, label: '変ロ長調（B♭）' },
  { id: 'Eb', semi: 3, label: '変ホ長調（E♭）' },
];
export const keyById = (id) => KEYS.find((k) => k.id === id) ?? KEYS[0];

const NOTE = /^([A-G])([#b]?)(-?\d)$/;
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C4 D4:2 r | …' → [{ midi | null, beats }] */
export function parseScore(text) {
  const out = [];
  for (const tok of text.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [name, b] = tok.split(':');
    const beats = b == null ? 1 : Number(b);
    if (!(beats > 0)) throw new Error(`拍が読めません: ${tok}`);
    if (name === 'r') {
      out.push({ midi: null, beats });
      continue;
    }
    const m = NOTE.exec(name);
    if (!m) throw new Error(`音が読めません: ${tok}`);
    out.push({ midi: 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), beats });
  }
  return out;
}

/** 小節ごとの拍の数（テスト用。'|' で区切った曲だけ） */
export const barBeats = (id) => SONGS[id].score.split('|').map((bar) => parseScore(bar).reduce((s, x) => s + x.beats, 0));

/**
 * 毎回ちがう旋律：4/4 の 8 小節。主音から始めて主音で終わる。となりの音（2 度）へ動くことが多く、
 * ときどき 3 度・4 度・5 度に跳ぶ。音域は主音の下の属音（ソ）から 1 オクターブ上の主音（ド）まで
 */
function randomMelody(rng) {
  const lo = -3;
  const hi = 7;
  const RHY = [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [2, 2], [1.5, 0.5, 2], [1, 1, 1, 1], [2, 1, 1]];
  const out = [];
  let d = 0;
  for (let bar = 0; bar < 8; bar++) {
    const last = bar === 7;
    const rhy = last ? [2, 2] : bar === 3 ? [2, 2] : rng.pick(RHY);
    for (const [i, beats] of rhy.entries()) {
      const prev = d;
      // 区切りの音は、いまの音にいちばん近い候補へ（跳びすぎないように）
      const toward = (opts) => opts.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
      if (out.length) {
        const r = rng.next();
        const size = r < 0.06 ? 0 : r < 0.64 ? 1 : r < 0.83 ? 2 : r < 0.94 ? 3 : 4;
        let dir = rng.next() < 0.5 ? -1 : 1;
        if (d + dir * size < lo || d + dir * size > hi) dir = -dir;
        d = Math.max(lo, Math.min(hi, d + dir * size));
      }
      // 4 小節めの終わりは属音か主音（区切り）、最後は 2 度で主音へ下りる
      if (bar === 3 && i === 1) d = toward([4, 0, 7]);
      if (last && i === 0) d = toward([1, 2, -1, 4]);
      if (last && i === 1) d = 0;
      out.push({ midi: deg(d), beats });
    }
  }
  return out;
}

// 楽器ごとの、旋律を置く高さの中心（鳴る高さの MIDI 番号）。どのオクターブで歌っても弾いても採点は同じ（オクターブは問わない）。
// 画面の見やすさと、お手本の音の高さのため
const HOME = { any: 64, piano: 64, voice: 62, violin: 74, viola: 64, cello: 53, bass: 43, guitar: 57, flute: 77 };

/**
 * 旋律を作る
 * @param o.id 曲・練習の id、o.key 調の id、o.bpm テンポ、o.inst マイクで聞く楽器（高さの置き場所）、o.seed 毎回ちがう旋律の種
 * @returns {{ notes: Array<{ midi: number, t: number, d: number }>, beats: number, beat: number, length: number, tonic: number }}
 *   t・d は秒（旋律の始まりから）。休みは notes に入れない。tonic は主音（0〜11）
 */
export function makeMelody({ id, key = 'C', bpm = 72, inst = 'any', seed = 1 }) {
  const m = melodyById(id);
  const raw = m.kind === 'song' ? parseScore(SONGS[m.id].score) : EXERCISES[m.id].make(makeRng(seed));
  const k = keyById(key);
  const pitches = raw.filter((x) => x.midi != null).map((x) => x.midi + k.semi);
  const mid = (Math.min(...pitches) + Math.max(...pitches)) / 2;
  const shift = k.semi + 12 * Math.round(((HOME[inst] ?? HOME.any) - mid) / 12);
  const beat = 60 / bpm;
  const notes = [];
  let b = 0;
  for (const x of raw) {
    if (x.midi != null) notes.push({ midi: x.midi + shift, t: b * beat, d: x.beats * beat, beats: x.beats });
    b += x.beats;
  }
  return { notes, beats: b, beat, length: b * beat, tonic: k.semi % 12 };
}
