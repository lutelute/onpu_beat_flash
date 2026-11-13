// ベンチマークの部品（48 kHz に直す・部屋の雑音・区切り・正解・アプリと同じ聞き方）。run.mjs と trace.mjs が使う
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { SETS } from './manifest.mjs';
import { readAudio } from './audio.mjs';
import { cacheDir } from './paths.mjs';
import { rms, detectPitch, detectMic, freqToMidi, makeNoteTracker, micInstrument, micTracker, sensFloor } from '../../src/core/pitch.js';

export const SR = 48000;
export const N = 2048;
const HOP = Math.round(SR * 0.02);
const ROOM = 0.0015;
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const nm = (m) => (m == null ? '—' : `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`);
const PCS = { C: 0, Db: 1, 'C#': 1, D: 2, Eb: 3, 'D#': 3, E: 4, F: 5, Gb: 6, 'F#': 6, G: 7, Ab: 8, 'G#': 8, A: 9, Bb: 10, 'A#': 10, B: 11 };
const parseNote = (s) => {
  const m = s.match(/^([A-G](?:b|#)?)(-?\d)$/);
  return m ? 12 * (Number(m[2]) + 1) + PCS[m[1]] : null;
};

/** 窓つき sinc で 48 kHz に（16 個の零点まで） */
export function resample(x, from) {
  if (from === SR) return x;
  const ratio = from / SR;
  const out = new Float32Array(Math.floor(x.length / ratio));
  const Z = 16;
  const fc = Math.min(1, 1 / ratio) * 0.95;
  for (let i = 0; i < out.length; i++) {
    const t = i * ratio;
    const c = Math.floor(t);
    let s = 0;
    for (let k = c - Z + 1; k <= c + Z; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k;
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / Z) + 0.08 * Math.cos((2 * Math.PI * d) / Z); // ブラックマン
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * fc * d) / (Math.PI * fc * d);
      s += x[k] * fc * sinc * w;
    }
    out[i] = s;
  }
  return out;
}

/** ピンクっぽい部屋の雑音 */
export function addRoom(x, level, seed) {
  let a = seed >>> 0 || 1;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const nz = new Float32Array(x.length);
  let b0 = 0, b1 = 0, b2 = 0;
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    const w = r();
    b0 = 0.997 * b0 + 0.029591 * w;
    b1 = 0.985 * b1 + 0.032534 * w;
    b2 = 0.95 * b2 + 0.048056 * w;
    nz[i] = b0 + b1 + b2 + 0.05 * w;
    e += nz[i] * nz[i];
  }
  const k = level / Math.sqrt(e / x.length || 1);
  for (let i = 0; i < x.length; i++) x[i] += nz[i] * k;
  return x;
}

/** 無音で区切って、音のあるところ [{ a, b }]（秒）に分ける */
export function segments(x) {
  const hop = Math.round(SR * 0.01);
  const w = 1024;
  const lv = [];
  for (let i = w; i <= x.length; i += hop) lv.push(rms(x.subarray(i - w, i)));
  const sorted = [...lv].sort((p, q) => p - q);
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const peak = sorted.at(-1) || 0;
  const thr = Math.max(floor * 3, peak * 0.02);
  const segs = [];
  let start = null;
  let lastOn = null;
  lv.forEach((v, i) => {
    const t = (i * hop + w) / SR;
    if (v >= thr) {
      if (start == null) start = t;
      lastOn = t;
    } else if (start != null && t - lastOn > 0.12) {
      segs.push({ a: start - w / SR, b: lastOn });
      start = null;
    }
  });
  if (start != null) segs.push({ a: start - w / SR, b: lastOn });
  // 弾いた音だけを数える（いちばん大きな音の 1 割にも届かないものは、弦に触れた音・うなりなどの雑音）
  const top = (sg) => {
    let m = 0;
    lv.forEach((v, i) => {
      const t = (i * hop + w) / SR;
      if (t >= sg.a && t <= sg.b + 0.001) m = Math.max(m, v);
    });
    return m;
  };
  return segs.filter((sg) => sg.b - sg.a >= 0.1 && top(sg) >= peak * 0.1);
}

/** その音の落ち着いたところの高さ（MIDI の小数。分からなければ null） */
export function steadyPitch(x, seg) {
  const ms = [];
  const t0 = seg.a + 0.06;
  const t1 = Math.min(seg.b, t0 + Math.max(0.25, Math.min(1.0, (seg.b - seg.a) * 0.8)));
  for (let t = t0; t <= t1; t += 0.01) {
    const end = Math.round(t * SR);
    if (end < N || end > x.length) continue;
    const p = detectPitch(x.subarray(end - N, end), SR, { minFreq: 30, maxFreq: 4200, minClarity: 0.85 });
    if (p) ms.push(freqToMidi(p.freq));
  }
  if (ms.length < 3) return null;
  ms.sort((p, q) => p - q);
  return ms[ms.length >> 1];
}

/** アプリと同じ手順で聞く。知らせた音（鳴る高さの MIDI 番号）と時刻 */
export function listen(x, inst) {
  const mw = process.env.MOVING ? JSON.parse(process.env.MOVING) : null; // 試し用
  const tracker = makeNoteTracker({ ...micTracker(3, inst), ...(mw && inst === 'any' ? { movingWait: mw } : {}) });
  const floor = sensFloor(3);
  const spec = { ...micInstrument(inst) };
  // 試し用の切り替え（ふだんは使わない）：MPM_K＝山を選ぶ割合、ANY_MIN＝「指定なし」の下限（Hz）、MIC_N＝窓の点の数
  if (process.env.MPM_K) spec.threshold = Number(process.env.MPM_K);
  if (process.env.ANY_MIN && inst === 'any') spec.minFreq = Number(process.env.ANY_MIN);
  // アプリと同じ：4096 点を取り、ふだんは直前の 2048 点で当てる（低い音だけ 4096 点。detectMic）。MIC_N=2048 で前のやり方
  const n = Number(process.env.MIC_N) || 4096;
  const out = [];
  for (let end = n; end <= x.length; end += HOP) {
    const buf = x.subarray(end - n, end);
    const level = rms(buf.subarray(buf.length - N));
    const p = level >= floor ? detectMic(buf, SR, spec) : null;
    const m = tracker.feed({ t: end / SR, level, freq: p ? p.freq : null });
    if (m != null) out.push({ t: end / SR, m });
  }
  return out;
}

const DYN = { pp: 0.015, mf: 0.05, ff: 0.1 };
export function prepare(set, file) {
  const path = join(cacheDir(), set.id, file.split('/').pop());
  if (!existsSync(path)) return null;
  const { x: raw, sr } = readAudio(path);
  const x = resample(raw, sr);
  const dyn = (file.match(/\.(pp|mf|ff)\./) || [])[1] ?? 'mf';
  let best = 0;
  const w = Math.round(SR * 0.05);
  for (let i = 0; i + w <= x.length; i += w) best = Math.max(best, rms(x.subarray(i, i + w)));
  const target = set.id === 'voice' ? 0.04 : DYN[dyn];
  for (let i = 0; i < x.length; i++) x[i] *= target / (best || 1);
  // 前後に少し無音
  const pad = new Float32Array(x.length + SR);
  pad.set(x, Math.round(SR * 0.3));
  return addRoom(pad, ROOM, file.length * 7919);
}

/** 正解：[{ a, b, truth }]（truth が null の音は数えない） */
export function truths(set, file, x) {
  let segs = segments(x);
  const base = file.split('/').pop().replace(/\.(aiff?|wav)$/, '');
  if (set.kind === 'notes') {
    // 1 音のファイル：最初の大きな音から終わりまでを 1 つの音とする（うなりで小さくなっては戻るのも、同じ 1 音）
    if (segs.length) segs = [{ a: segs[0].a, b: segs.at(-1).b }];
    const label = parseNote(base.replace(/^.*\.([A-G](?:b|#)?-?\d)$/, '$1').replace(/-\d+.*$/, ''));
    return segs.map((s) => {
      const m = steadyPitch(x, s);
      if (m == null) return { ...s, truth: null, why: '高さ不明' };
      // 声は歌い手の高さ、ピアノは名前の音（落ち着いた高さが名前から 0.5 半音以内なら名前どおり）
      if (set.id !== 'voice' && label != null && Math.abs(m - label) <= 0.5) return { ...s, truth: label, m };
      if (Math.abs(m - Math.round(m)) > 0.35) return { ...s, truth: null, m, why: '音程が半音の途中' };
      return { ...s, truth: Math.round(m), m };
    });
  }
  // 音階のファイル：…sulA.C5C6 のような音域
  const range = base.match(/([A-G]b?\d)([A-G]b?\d)?(?:\.(?:mono|stereo))?$/);
  const lo = range ? parseNote(range[1]) : null;
  const hi = range?.[2] ? parseNote(range[2]) : lo;
  const ms = segs.map((s) => steadyPitch(x, s));
  const chromatic = lo != null && segs.length === hi - lo + 1 && ms.every((m, k) => m == null || Math.abs(m - (lo + k)) <= 0.6);
  return segs.map((s, k) => {
    const m = ms[k];
    if (chromatic) return { ...s, truth: lo + k, m };
    if (m == null) return { ...s, truth: null, why: '高さ不明' };
    if (Math.abs(m - Math.round(m)) > 0.35) return { ...s, truth: null, m, why: '音程が半音の途中' };
    let t = Math.round(m);
    // 正解の目安そのものが倍音につられていたら、音域へ折り返す
    if (lo != null) {
      while (t > hi + 1) t -= 12;
      while (t < lo - 1) t += 12;
    }
    return { ...s, truth: t, m };
  });
}

