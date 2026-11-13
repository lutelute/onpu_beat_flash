// マイクの聞き取りのベンチマークに使う録音（どれも自由に使ってよいと公開されているもの）
//   アイオワ大学の楽器音（University of Iowa Musical Instrument Samples）https://theremin.music.uiowa.edu/MIS.html
//     「どんな目的にも、制限なく使ってよい」と案内されている。1 音ずつのファイル（ピアノ）と、半音ずつ上がる音階のファイル
//   男声（vocobox/human-voice-dataset、MIT ライセンス）https://github.com/vocobox/human-voice-dataset
// 録音はリポジトリには入れない。fetch.mjs が手元のキャッシュ（~/.cache/onpu-mic-bench）に取ってくる

const IOWA = 'https://theremin.music.uiowa.edu/sound%20files/MIS';
const VOICE = 'https://raw.githubusercontent.com/vocobox/human-voice-dataset/master/data/voices/martin/notes/exports/mono';

/** 楽器ごとの録音。inst はアプリの「マイクで聞く楽器」の id（指定なし any でも試す） */
export const SETS = [
  {
    id: 'piano', label: 'ピアノ', inst: 'piano', kind: 'notes',
    files: ['E2', 'G2', 'B2', 'C3', 'E3', 'G3', 'A3', 'Bb3', 'C4', 'Db4', 'D4', 'E4', 'F4', 'Gb4', 'G4', 'A4', 'B4', 'C5', 'D5', 'Eb5', 'E5', 'G5', 'Ab5', 'A5', 'C6', 'E6', 'F6']
      .map((n) => `Piano_Other/piano/Piano.mf.${n}.aiff`)
      .concat(['C4', 'A4', 'E5', 'G3'].map((n) => `Piano_Other/piano/Piano.pp.${n}.aiff`), ['C4', 'E5'].map((n) => `Piano_Other/piano/Piano.ff.${n}.aiff`)),
  },
  {
    id: 'violin', label: 'バイオリン', inst: 'violin', kind: 'scale',
    files: [
      'Strings/violin/Violin.arco.mf.sulG.G3B3.aiff', 'Strings/violin/Violin.arco.mf.sulG.B3B4.aiff', 'Strings/violin/Violin.arco.mf.sulD.D4A4.aiff',
      'Strings/violin/Violin.arco.mf.sulA.C5C6.aiff', 'Strings/violin/Violin.arco.mf.sulE.E5B5.aiff', 'Strings/violin/Violin.arco.pp.sulG.B3Ab4.aiff',
    ],
  },
  {
    id: 'violin-pizz', label: 'バイオリン（ピチカート）', inst: 'violin', kind: 'scale',
    files: ['Strings/violin/Violin.pizz.mf.sulG.G3B3.aiff', 'Strings/violin/Violin.pizz.mf.sulA.B4Ab5.aiff', 'Strings/violin/Violin.pizz.mf.sulE.Ab5F6.aiff'],
  },
  {
    id: 'viola', label: 'ビオラ', inst: 'viola', kind: 'scale',
    files: ['Strings/viola/Viola.arco.sulC.mf.C3B3.aiff', 'Strings/viola/Viola.arco.sulG.mf.C4B4.aiff', 'Strings/viola/Viola.arco.sulA.mf.C5B5.aiff', 'Strings/viola/Viola.arco.sulC.pp.C3B3.aiff'],
  },
  {
    id: 'viola-pizz', label: 'ビオラ（ピチカート）', inst: 'viola', kind: 'scale',
    files: ['Strings/viola/Viola.pizz.sulC.mf.C3B3.aiff', 'Strings/viola/Viola.pizz.sulA.mf.C5B5.aiff'],
  },
  {
    id: 'cello', label: 'チェロ', inst: 'cello', kind: 'scale',
    files: [
      'Strings/cello/Cello.arco.mf.sulC.C2Ab2.aiff', 'Strings/cello/Cello.arco.mf.sulG.B2A3.aiff', 'Strings/cello/Cello.arco.mf.sulD.D3B3.aiff',
      'Strings/cello/Cello.arco.mf.sulA.C4C5.aiff', 'Strings/cello/Cello.arco.pp.sulC.C2Gb2.aiff',
    ],
  },
  {
    id: 'cello-pizz', label: 'チェロ（ピチカート）', inst: 'cello', kind: 'scale',
    files: ['Strings/cello/Cello.pizz.mf.sulC.C2B2.aiff', 'Strings/cello/Cello.pizz.mf.sulG.C3B3.aiff', 'Strings/cello/Cello.pizz.mf.sulA.B4Ab5.aiff'],
  },
  {
    id: 'bass', label: 'コントラバス', inst: 'bass', kind: 'scale',
    files: ['Strings/doublebass/Bass.arco.mf.sulE.E1B1.aiff', 'Strings/doublebass/Bass.arco.mf.sulA.C2B2.aiff', 'Strings/doublebass/Bass.arco.mf.sulG.C3B3.aiff', 'Strings/doublebass/Bass.arco.pp.sulE.E1B1.aiff'],
  },
  {
    id: 'bass-pizz', label: 'コントラバス（ピチカート）', inst: 'bass', kind: 'scale',
    // G 線の高いところ（sulG.C4G4）は、名前の音域と聞こえる高さが 2 オクターブ食いちがうので使わない
    files: ['Strings/doublebass/Bass.pizz.mf.sulE.E1B1.aiff', 'Strings/doublebass/Bass.pizz.mf.sulA.C2B2.aiff', 'Strings/doublebass/Bass.pizz.mf.sulG.G2B2.aiff'],
  },
  {
    id: 'guitar', label: 'ギター', inst: 'guitar', kind: 'scale',
    files: [
      'Piano_Other/guitar/Guitar.mf.sulE.E2B2.mono.aif', 'Piano_Other/guitar/Guitar.mf.sulA.C3B3.mono.aif', 'Piano_Other/guitar/Guitar.mf.sulG.C4B4.mono.aif',
      'Piano_Other/guitar/Guitar.mf.sul_E.C5B5.mono.aif', 'Piano_Other/guitar/Guitar.pp.sulD.D3B3.mono.aif',
    ],
  },
  {
    id: 'flute', label: 'フルート', inst: 'flute', kind: 'scale',
    files: ['Woodwinds/flute/Flute.vib.mf.B3B4.aiff', 'Woodwinds/flute/Flute.vib.mf.C5B5.aiff', 'Woodwinds/flute/Flute.vib.pp.B3B4.aiff'],
  },
  {
    id: 'voice', label: '声（男声）', inst: 'voice', kind: 'notes', base: VOICE,
    // ひとりの男声が 1 音ずつ歌ったもの（同じ音を何回か歌っている）
    files: ['A#3-2', 'A#3-3', 'A#3-4', 'A#3', 'A#4-2', 'A#4-3', 'A#4-4', 'A#4', 'A3-2', 'A3-3', 'A3-4', 'A3', 'A4-2', 'A4-3', 'A4-4', 'A4', 'B3-2', 'B3-3', 'B3-5', 'B3', 'C#3-2', 'C#3-3', 'C#3-4', 'C#3', 'C3-2', 'C3', 'D#2', 'D#3-2', 'D#3-3', 'D#3-4', 'D#3', 'D2-3', 'D2-4', 'D2-5', 'D2', 'D3-2', 'D3-3', 'D3', 'E2', 'E3-2', 'E3-3', 'E3', 'F#2-2', 'F#2-3', 'F#2', 'F#3-2', 'F#3-3', 'F#3', 'F2', 'F3-2', 'F3-3', 'F3', 'G#2-2', 'G#2-3', 'G#2-4', 'G#2-5', 'G#2-6', 'G#2-7-2', 'G#2-7', 'G#2', 'G#3-2', 'G#3-3', 'G#3', 'G2-2', 'G2-3', 'G2-4', 'G3-2', 'G3-3', 'G3'].map((n) => `${n}.wav`),
  },
];

/** 和音のベンチマーク（chords.mjs）に使う、ピアノの 1 音ずつ（mf、ド3〜ド6）。はじめの 1.5 MB（約 7 秒）だけ取る */
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const CHORD_NOTES = {
  id: 'piano-chord', label: 'ピアノ（和音用）', range: 1500000,
  files: Array.from({ length: 37 }, (_, i) => 48 + i).map((m) => `Piano_Other/piano/Piano.mf.${FLAT[m % 12]}${Math.floor(m / 12) - 1}.aiff`),
};

export const urlOf = (set, file) => `${set.base ?? IOWA}/${file.split('/').map(encodeURIComponent).join('/')}`;
