// 音程を細かく見る部品（チューナーと「なぞって採点」が使う。画面は使わない。Node のテストでも動く）
//   ・弦楽器の開放弦と、純正な 5 度（4 度）で合わせたときの目標
//   ・音律（平均律・純正律・ピタゴラス）ごとの、主音から見た音のずれ
//   ・倍音の強さ（どの倍音がどれだけ鳴っているか）
//   ・ビブラート（揺れの速さと幅、揺れの中心）
import { plan, fft } from './fft.js';

// ---- 開放弦（鳴る高さの MIDI 番号。低い弦から） ----
// step：となりの弦との隔たり（半音）。5 度に合わせる弦楽器は 7、コントラバスは 4 度で 5
export const OPEN_STRINGS = {
  violin: { strings: [55, 62, 69, 76], step: 7 }, // G3 D4 A4 E5
  viola: { strings: [48, 55, 62, 69], step: 7 }, // C3 G3 D4 A4
  cello: { strings: [36, 43, 50, 57], step: 7 }, // C2 G2 D3 A3
  bass: { strings: [28, 33, 38, 43], step: 5 }, // E1 A1 D2 G2
  guitar: { strings: [40, 45, 50, 55, 59, 64], step: null }, // E2 A2 D3 G3 B3 E4（フレットがあるので平均律だけ）
};

// 純正な 5 度（3:2）は 701.955 セント、4 度（4:3）は 498.045 セント。平均律より 5 度は 1.955 セント広く、4 度は狭い
const PURE = { 7: 1200 * Math.log2(3 / 2) - 700, 5: 1200 * Math.log2(4 / 3) - 500 };

/**
 * 楽器の開放弦と目標の高さ。pure なら A の弦を基準に、純正な 5 度（コントラバスは 4 度）で重ねた高さ
 * （チェロの C 線は平均律より約 5.9 セント低く、バイオリンの E 線は約 2 セント高くなる）
 * @returns {Array<{ midi: number, cents: number }> | null} 弦楽器でなければ null
 */
export function openStrings(inst, { pure = false } = {}) {
  const spec = OPEN_STRINGS[inst];
  if (!spec) return null;
  const a = spec.strings.find((m) => m % 12 === 9);
  return spec.strings.map((midi) => {
    const k = spec.step && a != null ? (midi - a) / spec.step : 0;
    return { midi, cents: pure && spec.step ? Math.round(k * PURE[spec.step] * 10) / 10 || 0 : 0 };
  });
}

/** 聞こえた高さ（MIDI 番号・小数）にいちばん近い弦と、その目標からのずれ（セント）。弦から 3 半音より離れていれば null */
export function nearestString(m, strings, within = 3) {
  if (!strings?.length || !Number.isFinite(m)) return null;
  let best = null;
  for (const [i, s] of strings.entries()) {
    const dev = (m - s.midi) * 100 - s.cents;
    if (!best || Math.abs(dev) < Math.abs(best.dev)) best = { i, ...s, dev };
  }
  return Math.abs(best.dev) <= within * 100 ? best : null;
}

// ---- 音律：主音から何半音上の音を、平均律から何セントずらすか ----
// 純正律は長 3 度 5:4（-13.7）・完全 5 度 3:2（+2.0）・長 6 度 5:3（-15.6）・長 7 度 15:8（-11.7）など。和音の中で響く高さ
// ピタゴラスは 5 度を重ねた高さ（長 3 度 +7.8・導音 +9.8）。旋律で、導音を主音へ高めにとる弾き方に近い
const ratioCents = (n, d) => Math.round((1200 * Math.log2(n / d)) * 10) / 10;
const fromRatios = (rs) => rs.map(([n, d], i) => Math.round((ratioCents(n, d) - 100 * i) * 10) / 10);
export const TEMPERAMENTS = {
  equal: { label: '平均律', cents: Array(12).fill(0) },
  just: { label: '純正律（主音に合わせる）', cents: fromRatios([[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [45, 32], [3, 2], [8, 5], [5, 3], [9, 5], [15, 8]]) },
  pythagorean: { label: 'ピタゴラス（旋律向き）', cents: fromRatios([[1, 1], [256, 243], [9, 8], [32, 27], [81, 64], [4, 3], [729, 512], [3, 2], [128, 81], [27, 16], [16, 9], [243, 128]]) },
};

/** 音律で、主音 tonic（0〜11）のとき midi の音を平均律から何セントずらすか */
export const temperCents = (midi, temper = 'equal', tonic = 0) =>
  (TEMPERAMENTS[temper] ?? TEMPERAMENTS.equal).cents[(((midi - tonic) % 12) + 12) % 12];

/** 自然倍音 k 番めの高さが、平均律のいちばん近い音から何セントずれているか（5 倍音は -13.7、7 倍音は -31.2） */
export function harmonicCents(k) {
  const c = 1200 * Math.log2(k);
  return Math.round((c - 100 * Math.round(c / 100)) * 10) / 10;
}

// ---- 倍音の強さ ----
/**
 * 波形 1 枚の、基音 f0 の倍音ごとの強さ。ハン窓をかけて 2 倍に伸ばした FFT の、k·f0 のまわり（±3%）でいちばん強いところ
 * @returns {Array<{ k: number, freq: number, amp: number, db: number }>} db はいちばん強い倍音を 0 とした大きさ
 */
export function harmonics(buf, sampleRate, f0, { count = 8 } = {}) {
  const N = buf.length;
  if (!(f0 > 0) || N < 64) return [];
  let M = 1;
  while (M < N * 2) M <<= 1;
  const p = plan(M);
  const { re, im } = p;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  for (let i = 0; i < M; i++) {
    re[i] = i < N ? (buf[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))) : 0;
    im[i] = 0;
  }
  fft(re, im, p);
  const bin = sampleRate / M;
  const mag = (i) => Math.hypot(re[i], im[i]);
  const out = [];
  for (let k = 1; k <= count; k++) {
    const fk = k * f0;
    if (fk > sampleRate * 0.45) break;
    const w = Math.max(1.5, (fk * 0.03) / bin);
    const lo = Math.max(1, Math.floor(fk / bin - w));
    const hi = Math.min(M / 2 - 2, Math.ceil(fk / bin + w));
    let best = lo;
    for (let i = lo; i <= hi; i++) if (mag(i) > mag(best)) best = i;
    // 放物線（対数の大きさ）で頂を細かく
    const a = Math.log(mag(best - 1) + 1e-12);
    const b = Math.log(mag(best) + 1e-12);
    const c = Math.log(mag(best + 1) + 1e-12);
    const den = a - 2 * b + c;
    const sh = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    out.push({ k, freq: (best + sh) * bin, amp: Math.exp(b - 0.25 * (a - c) * sh) });
  }
  const top = Math.max(...out.map((x) => x.amp), 1e-12);
  return out.map((x) => ({ ...x, db: Math.round(20 * Math.log10(x.amp / top) * 10) / 10 }));
}

// ---- ビブラート ----
/**
 * 続けて鳴っている音の高さ（セント）の並びから、ビブラートの速さと幅を求める
 * 全体の傾き（だんだん上がる・下がる）を除いてから、向きが変わった点（山と谷）を数える。
 * 小さなふらつきは山と谷に数えない（山から谷まで minWidth×2 セント以上動いたときだけ）
 * @param pts [{ t: 秒, c: セント }]（20 ms ごとくらい。0.5 秒以上）
 * @returns {{ rate: number, width: number, center: number } | null}
 *   rate：1 秒に揺れる回数（Hz）、width：揺れの幅（中心から片側、セント）、center：揺れの中心（セント）
 *   rate が 3.5〜9 Hz・幅が minWidth 以上で、2 回以上揺れていなければ null（ビブラートではない）
 */
export function analyzeVibrato(pts, { minRate = 3.5, maxRate = 9, minWidth = 8 } = {}) {
  if (!pts || pts.length < 20) return null;
  const n = pts.length;
  const t0 = pts[0].t;
  let st = 0, sc = 0, stt = 0, stc = 0;
  for (const { t, c } of pts) {
    const x = t - t0;
    st += x;
    sc += c;
    stt += x * x;
    stc += x * c;
  }
  const den = n * stt - st * st;
  const slope = den > 0 ? (n * stc - st * sc) / den : 0;
  const icpt = (sc - slope * st) / n;
  // 傾きを除き、となりと重みをつけてならす（1 枚ごとのがたつきを山と数えない）
  const r = pts.map(({ t, c }) => c - (icpt + slope * (t - t0)));
  const s = r.map((v, i) => 0.25 * r[Math.max(0, i - 1)] + 0.5 * v + 0.25 * r[Math.min(n - 1, i + 1)]);
  // 山と谷：直前の谷（山）から thr 以上もどったら、そこまでのいちばん高い（低い）点を山（谷）とする
  const thr = minWidth * 1.5;
  const ext = [];
  let dir = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < n; i++) {
    if (s[i] > s[hi]) hi = i;
    if (s[i] < s[lo]) lo = i;
    if (dir >= 0 && s[hi] - s[i] >= thr) {
      ext.push(hi);
      dir = -1;
      lo = i;
    } else if (dir <= 0 && s[i] - s[lo] >= thr) {
      ext.push(lo);
      dir = 1;
      hi = i;
    }
  }
  if (ext.length < 4) return null;
  const span = pts[ext[ext.length - 1]].t - pts[ext[0]].t;
  if (span <= 0) return null;
  const rate = (ext.length - 1) / 2 / span;
  // 幅は、山から最後の山（谷）までの揺れの二乗平均から（正弦波なら √2 倍が片側の幅）
  let e = 0;
  for (let i = ext[0]; i <= ext[ext.length - 1]; i++) e += r[i] * r[i];
  const width = Math.SQRT2 * Math.sqrt(e / (ext[ext.length - 1] - ext[0] + 1));
  if (rate < minRate || rate > maxRate || width < minWidth) return null;
  return { rate: Math.round(rate * 10) / 10, width: Math.round(width * 10) / 10, center: Math.round((sc / n) * 10) / 10 };
}
