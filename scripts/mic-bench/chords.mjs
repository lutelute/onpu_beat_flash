// 和音の聞き取りのベンチマーク：本物のピアノの 1 音ずつ（アイオワ大学、mf）を足し合わせて和音を作り、アプリと同じ手順で聞かせる
//   node scripts/mic-bench/chords.mjs          （先に fetch.mjs）
//   VERBOSE=1 … まちがえた和音を並べる
// 作り方：11 種類 × 根音 12（ド3〜シ3）× 転回形。人が弾くように、音ごとに出だしを 0〜15 ms ずらし、強さを 0.8〜1 倍にする
// アプリと同じ手順：48 kHz・20 ms ごとに大きさ、40 ms ごとに直前の 8192 点で鳴っている音を探し（multiPitch）、
// 弾いた瞬間から集めて 1 回だけ知らせる（makeChordTracker）
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { CHORD_NOTES } from './manifest.mjs';
import { readAudio } from './audio.mjs';
import { cacheDir } from './paths.mjs';
import { resample, addRoom, SR } from './lib.mjs';
import { rms } from '../../src/core/pitch.js';
import { multiPitch, makeChordTracker } from '../../src/core/chordListen.js';
import { CHORDS } from '../../src/core/music.js';
import { voicing } from '../../src/generators/chord.js';

const VERBOSE = !!process.env.VERBOSE;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

// ピアノの 1 音ずつ（MIDI 48〜84）。鳴り始めから 3 秒、同じ倍率で大きさをそろえる（mf のド4 のいちばん大きいところで -26 dB）
const notes = new Map();
for (const f of CHORD_NOTES.files) {
  const path = join(cacheDir(), CHORD_NOTES.id, f.split('/').pop());
  if (!existsSync(path)) {
    console.log('録音が無い。先に node scripts/mic-bench/fetch.mjs');
    process.exit(2);
  }
  const { x: raw, sr } = readAudio(path);
  const x = resample(raw, sr);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let on = 0;
  while (on < x.length && Math.abs(x[on]) < peak * 0.02) on++;
  const m = 48 + CHORD_NOTES.files.indexOf(f);
  notes.set(m, x.subarray(on, on + SR * 3));
}
let c4peak = 0;
const c4 = notes.get(60);
for (let i = 0; i + 2400 <= c4.length; i += 2400) c4peak = Math.max(c4peak, rms(c4.subarray(i, i + 2400)));
const gain = 0.05 / c4peak;

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function mix(midis) {
  const len = SR * 2;
  const lead = Math.round(SR * 0.3);
  const y = new Float32Array(lead + len);
  for (const m of midis) {
    const src = notes.get(m);
    if (!src) return null;
    const off = lead + Math.round(rand() * 0.015 * SR);
    const g = gain * (0.8 + 0.2 * rand());
    for (let i = 0; i < src.length && off + i < y.length; i++) y[off + i] += src[i] * g;
  }
  return addRoom(y, 0.0015, Math.round(rand() * 1e6));
}

function listen(y) {
  const tr = makeChordTracker({ minLevel: 0.004 });
  const hop = Math.round(SR * 0.02);
  const out = [];
  let k = 0;
  for (let end = 8192; end <= y.length; end += hop) {
    const t = end / SR;
    const level = rms(y.subarray(end - 2048, end));
    const ns = k++ % 2 === 0 && level >= 0.004 ? multiPitch(y.subarray(end - 8192, end), SR) : null;
    const c = tr.feed({ t, level, notes: ns });
    if (c) out.push({ t, ...c });
  }
  return out;
}

const res = new Map();
const bad = [];
const lat = [];
for (const c of CHORDS) {
  const r = { ok: 0, wrong: 0, miss: 0, extra: 0, n: 0 };
  for (let root = 48; root <= 59; root++) {
    for (let inv = 0; inv < c.tones.length; inv++) {
      const v = voicing(root, c.tones, inv);
      const y = mix(v);
      if (!y) continue;
      r.n++;
      const ev = listen(y);
      const label = `${nm(root)}${c.sym || ''}（${v.map(nm).join(' ')}）`;
      if (!ev.length) {
        r.miss++;
        bad.push(`${label}：答えなし`);
      } else if (!ev[0].alts.includes(c.id)) {
        r.wrong++;
        bad.push(`${label}：${NAMES[ev[0].root]}${CHORDS.find((x) => x.id === ev[0].quality).sym}（聞こえた音 ${ev[0].notes.map(nm).join(' ')}）`);
      } else {
        r.ok++;
        lat.push(ev[0].t - 0.3);
        if (ev.length > 1) r.extra++;
      }
    }
  }
  res.set(c, r);
}
console.log('| コード | 和音 | 正しい | ちがう | 答えなし | 余計 |');
console.log('|---|---:|---:|---:|---:|---:|');
let tot = { ok: 0, wrong: 0, miss: 0, extra: 0, n: 0 };
for (const [c, r] of res) {
  console.log(`| ${c.label}（${c.sym || 'maj'}） | ${r.n} | ${r.ok}（${Math.round((100 * r.ok) / r.n)}%） | ${r.wrong} | ${r.miss} | ${r.extra} |`);
  for (const k of Object.keys(tot)) tot[k] += r[k];
}
lat.sort((a, b) => a - b);
console.log(`| **合計** | ${tot.n} | **${tot.ok}（${Math.round((100 * tot.ok) / tot.n)}%）** | ${tot.wrong} | ${tot.miss} | ${tot.extra} |`);
console.log(`反応（弾いてから答えるまで、真ん中）：${Math.round(1000 * lat[lat.length >> 1])} ms`);
if (VERBOSE) console.log(bad.join('\n'));
