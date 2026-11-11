// 音の高さ・音部記号・音名・音程・和音の定義
// step = オクターブ*7 + 幹音の番号（C=0 … B=6）。C4（中央ド）= 28。

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11];

export const stepOf = (letter, octave) => octave * 7 + LETTERS.indexOf(letter);
export const letterIndex = (step) => ((step % 7) + 7) % 7;
export const octaveOf = (step) => Math.floor(step / 7);
export const midiOfStep = (step, acc = 0) =>
  12 * (octaveOf(step) + 1) + LETTER_SEMI[letterIndex(step)] + acc;
const ACC_VF = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };
export const accVF = (acc = 0) => ACC_VF[acc];
export const vfKey = (step, acc = 0) => `${LETTERS[letterIndex(step)].toLowerCase()}${ACC_VF[acc]}/${octaveOf(step)}`;
export const sciName = (step, acc = 0) => `${LETTERS[letterIndex(step)]}${ACC_MARK[acc]}${octaveOf(step)}`;

// 音部記号。bottom = 第1線（いちばん下の線）の step
export const CLEFS = {
  tenor: { vf: 'tenor', label: 'テノール記号', short: 'テノール', bottom: stepOf('D', 3), kind: 'ハ音・第4線がド' },
  alto: { vf: 'alto', label: 'アルト記号', short: 'アルト', bottom: stepOf('F', 3), kind: 'ハ音・第3線がド' },
  soprano: { vf: 'soprano', label: 'ソプラノ記号', short: 'ソプラノ', bottom: stepOf('C', 4), kind: 'ハ音・第1線がド' },
  mezzo: { vf: 'mezzo-soprano', label: 'メゾソプラノ記号', short: 'メゾ', bottom: stepOf('A', 3), kind: 'ハ音・第2線がド' },
  baritone: { vf: 'baritone-c', label: 'バリトン記号', short: 'バリトン', bottom: stepOf('B', 2), kind: 'ハ音・第5線がド' },
  treble: { vf: 'treble', label: 'ト音記号', short: 'ト音', bottom: stepOf('E', 4), kind: '第2線がソ' },
  bass: { vf: 'bass', label: 'ヘ音記号', short: 'ヘ音', bottom: stepOf('G', 2), kind: '第4線がファ' },
};
export const CLEF_ORDER = ['tenor', 'alto', 'soprano', 'mezzo', 'baritone', 'treble', 'bass'];

// 出題する範囲。第1線を 0、第5線を 8 とした位置で決める（音部記号によらない）
export const RANGES = {
  staff: { label: '五線の中だけ', lo: 0, hi: 8 },
  near: { label: '五線＋すぐ上下の間', lo: -1, hi: 9 },
  ledger1: { label: '加線1本まで', lo: -3, hi: 11 },
  ledger2: { label: '加線2本まで', lo: -5, hi: 13 },
  ledger3: { label: '加線3本まで', lo: -7, hi: 15 },
};
export const RANGE_ORDER = ['staff', 'near', 'ledger1', 'ledger2', 'ledger3'];

export function rangeSteps(clefId, rangeId) {
  const c = CLEFS[clefId];
  const r = RANGES[rangeId];
  const out = [];
  for (let p = r.lo; p <= r.hi; p++) out.push(c.bottom + p);
  return out;
}
export function rangeLabel(clefId, rangeId) {
  const s = rangeSteps(clefId, rangeId);
  return `${sciName(s[0])}–${sciName(s[s.length - 1])}`;
}

// 音名の呼び方
export const NAMINGS = {
  doremi: { label: 'ドレミ', names: ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'] },
  german: { label: 'ドイツ音名', names: ['C', 'D', 'E', 'F', 'G', 'A', 'H'] },
  english: { label: '英米音名', names: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] },
  japanese: { label: '日本音名', names: ['ハ', 'ニ', 'ホ', 'ヘ', 'ト', 'イ', 'ロ'] },
};
export const NAMING_ORDER = ['doremi', 'german', 'english', 'japanese'];

export const noteName = (step, naming) => NAMINGS[naming].names[letterIndex(step)];
export const noteNameOct = (step, naming) =>
  naming === 'english' || naming === 'german'
    ? `${noteName(step, naming)}${octaveOf(step)}`
    : `${noteName(step, naming)}（${sciName(step)}）`;

// 12 音の名前（半音を含む）。黒鍵は「♯／♭」を並べる
const CHROMA = {
  doremi: ['ド', 'ド♯\nレ♭', 'レ', 'レ♯\nミ♭', 'ミ', 'ファ', 'ファ♯\nソ♭', 'ソ', 'ソ♯\nラ♭', 'ラ', 'ラ♯\nシ♭', 'シ'],
  german: ['C', 'Cis\nDes', 'D', 'Dis\nEs', 'E', 'F', 'Fis\nGes', 'G', 'Gis\nAs', 'A', 'Ais\nB', 'H'],
  english: ['C', 'C♯\nD♭', 'D', 'D♯\nE♭', 'E', 'F', 'F♯\nG♭', 'G', 'G♯\nA♭', 'A', 'A♯\nB♭', 'B'],
  japanese: ['ハ', '嬰ハ\n変ニ', 'ニ', '嬰ニ\n変ホ', 'ホ', 'ヘ', '嬰ヘ\n変ト', 'ト', '嬰ト\n変イ', 'イ', '嬰イ\n変ロ', 'ロ'],
};
export const chromaName = (pc, naming) => CHROMA[naming][((pc % 12) + 12) % 12];
export const chromaNameFlat = (pc, naming) => chromaName(pc, naming).replace('\n', '／');
export const isBlack = (pc) => [1, 3, 6, 8, 10].includes(((pc % 12) + 12) % 12);

// 音程（半音数）
export const INTERVALS = [
  { id: 'm2', semi: 1, steps: 1, label: '短2度' },
  { id: 'M2', semi: 2, steps: 1, label: '長2度' },
  { id: 'm3', semi: 3, steps: 2, label: '短3度' },
  { id: 'M3', semi: 4, steps: 2, label: '長3度' },
  { id: 'P4', semi: 5, steps: 3, label: '完全4度' },
  { id: 'TT', semi: 6, steps: 3, label: '増4度／減5度' },
  { id: 'P5', semi: 7, steps: 4, label: '完全5度' },
  { id: 'm6', semi: 8, steps: 5, label: '短6度' },
  { id: 'M6', semi: 9, steps: 5, label: '長6度' },
  { id: 'm7', semi: 10, steps: 6, label: '短7度' },
  { id: 'M7', semi: 11, steps: 6, label: '長7度' },
  { id: 'P8', semi: 12, steps: 7, label: '完全8度' },
];

// 和音（根音からの半音）
export const CHORDS = [
  { id: 'maj', label: 'メジャー', sym: '', tones: [0, 4, 7], steps: [0, 2, 4] },
  { id: 'min', label: 'マイナー', sym: 'm', tones: [0, 3, 7], steps: [0, 2, 4] },
  { id: 'dim', label: 'ディミニッシュ', sym: 'dim', tones: [0, 3, 6], steps: [0, 2, 4] },
  { id: 'aug', label: 'オーギュメント', sym: 'aug', tones: [0, 4, 8], steps: [0, 2, 4] },
  { id: 'sus4', label: 'サスフォー', sym: 'sus4', tones: [0, 5, 7], steps: [0, 3, 4] },
  { id: 'dom7', label: 'セブンス', sym: '7', tones: [0, 4, 7, 10], steps: [0, 2, 4, 6] },
  { id: 'maj7', label: 'メジャーセブンス', sym: 'M7', tones: [0, 4, 7, 11], steps: [0, 2, 4, 6] },
  { id: 'min7', label: 'マイナーセブンス', sym: 'm7', tones: [0, 3, 7, 10], steps: [0, 2, 4, 6] },
  { id: 'm7b5', label: 'ハーフディミニッシュ', sym: 'm7♭5', tones: [0, 3, 6, 10], steps: [0, 2, 4, 6] },
  { id: 'dim7', label: 'ディミニッシュセブンス', sym: 'dim7', tones: [0, 3, 6, 9], steps: [0, 2, 4, 6] },
  { id: 'mM7', label: 'マイナーメジャーセブンス', sym: 'mM7', tones: [0, 3, 7, 11], steps: [0, 2, 4, 6] },
];


// MIDI 番号の表記（コード名・答え合わせの表示用）
export const PC_ENG = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const midiSci = (m) => `${PC_ENG[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
export const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]; // 幹音（白鍵）の半音位置。添字が幹音の番号

// ---- 綴り（音程・和音の答え合わせで、度数に合った名前を出す） ----
// 綴られた音 = { li: 幹音の番号, acc: 変化（♯=1, ♭=-1, 𝄪=2, 𝄫=-2） }

// 根音の綴り（半音位置 → よく使う方の名前）
const ROOT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
export const rootSpelling = (pc) => {
  const [li, acc] = ROOT_SPELL[((pc % 12) + 12) % 12];
  return { li, acc };
};

/** 綴られた音から、幹音で steps 上・半音で semi 上の音を綴る */
export function spellAbove(n, semi, steps) {
  const li = (n.li + steps) % 7;
  const pc = (WHITE_PCS[n.li] + n.acc + semi) % 12;
  let acc = (((pc - WHITE_PCS[li]) % 12) + 12) % 12;
  if (acc > 6) acc -= 12;
  return { li, acc };
}

const ACC_MARK = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const JP_ACC = { '-2': '重変', '-1': '変', 0: '', 1: '嬰', 2: '重嬰' };
const DE_BASE = ['C', 'D', 'E', 'F', 'G', 'A', 'H'];

/** 綴られた音の名前（呼び方ごと） */
export function spelledName({ li, acc }, naming) {
  if (naming === 'german') {
    if (acc === 0) return DE_BASE[li];
    if (acc > 0) return DE_BASE[li] + 'is'.repeat(acc);
    if (li === 6) return acc === -1 ? 'B' : 'Heses';
    const stem = li === 2 || li === 5 ? DE_BASE[li] : DE_BASE[li] + 'e'; // Es・As は e を重ねない
    return stem + 's' + 'es'.repeat(-acc - 1);
  }
  if (naming === 'japanese') return JP_ACC[acc] + NAMINGS.japanese.names[li];
  return NAMINGS[naming].names[li] + ACC_MARK[acc];
}

/**
 * 根音 pc から semis・steps の並びで音を綴る。黒鍵の根音は ♯ と ♭ の両方を試し、
 * 変化記号が少ない方を選ぶ（C♯dim7 = C♯ E G B♭ のように読みやすい方）
 */
export function spellChord(pc, semis, steps) {
  const p = ((pc % 12) + 12) % 12;
  const cands = [rootSpelling(p)];
  const w = WHITE_PCS.indexOf(p);
  if (w < 0) {
    const sharp = { li: WHITE_PCS.indexOf(p - 1), acc: 1 };
    const flat = { li: WHITE_PCS.indexOf((p + 1) % 12), acc: -1 };
    cands.push(...[sharp, flat].filter((c) => c.li !== cands[0].li));
  }
  let best = null;
  let bestCost = Infinity;
  for (const r of cands) {
    const notes = semis.map((s, i) => spellAbove(r, s, steps[i]));
    const cost = notes.reduce((t, n) => t + Math.abs(n.acc) * (Math.abs(n.acc) > 1 ? 3 : 1), 0);
    if (cost < bestCost) {
      best = notes;
      bestCost = cost;
    }
  }
  return best;
}

/** 譜面の音（幹音の step と変化 acc）の名前。例: ファ♯（F♯3） */
export function spelledNoteOct(step, acc, naming) {
  const name = spelledName({ li: letterIndex(step), acc }, naming);
  return naming === 'english' || naming === 'german' ? `${name}${octaveOf(step)}` : `${name}（${sciName(step, acc)}）`;
}

/** MIDI 番号の名前（鍵盤で答えたときの表示）。白鍵は幹音、黒鍵は「ド♯／レ♭」の形 */
export function midiLabel(midi, naming) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const w = WHITE_PCS.indexOf(pc);
  if (w >= 0) return noteNameOct(oct * 7 + w, naming);
  return `${chromaNameFlat(pc, naming)}${oct}`;
}
