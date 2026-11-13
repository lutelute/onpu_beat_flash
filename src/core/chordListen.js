// 和音を聞き取る（画面は使わない。Node のテストでも動く）
//
//   multiPitch(buf, sr)      … 1 枚（約 170 ms）の波形から、鳴っている音（MIDI 番号）をいくつか見つける
//                              音をいちばんよく説明する高さ（倍音の和がいちばん大きい高さ）を選び、その倍音を消して、また選ぶ（6 音まで）
//   identifyChord(weights)   … 音名ごとの重み（12 個）から、いちばん合うコード（根音と種類）を選ぶ。転回形でも同じ種類になる
//   chordFromMidi(notes)     … MIDI 鍵盤で押した音から、コードを選ぶ
//   makeChordTracker()       … 1 枚ごとの結果を「和音を弾いた」という知らせに変える（弾いた瞬間から少し集めて、1 回だけ）
import { plan, fft } from './fft.js';
import { CHORDS } from './music.js';

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * 鳴っている音を見つける
 * @param buf 波形（48 kHz で 8192 点くらい。周波数を細かく分けるため長め）
 * @param opts minMidi・maxMidi（探す範囲）、maxNotes（いくつまで）、rel（いちばん強い音のこれ倍より弱い音は数えない）、
 *             scale（聞こえた高さに掛ける倍率。マイクの補正と基準のラ）
 * @returns {Array<{ midi: number, s: number }>} 強い順。s は強さ（倍音の和）
 */
export function multiPitch(buf, sr, { minMidi = 36, maxMidi = 96, maxNotes = 6, rel = 0.18, H = 10, scale = 1 } = {}) {
  const N = buf.length;
  let M = 1;
  while (M < 2 * N) M <<= 1;
  const p = plan(M);
  const { re, im } = p;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  for (let i = 0; i < M; i++) {
    re[i] = i < N ? (buf[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))) : 0; // ハン窓
    im[i] = 0;
  }
  fft(re, im, p);
  const binHz = sr / M;
  const kMin = Math.max(2, Math.floor(30 / binHz));
  const kMax = Math.min(M / 2 - 2, Math.floor(5000 / binHz));
  const mag = new Float32Array(kMax + 2);
  let top = 0;
  for (let k = kMin - 1; k <= kMax + 1; k++) {
    mag[k] = Math.hypot(re[k], im[k]);
    if (k >= kMin && k <= kMax) top = Math.max(top, mag[k]);
  }
  if (!(top > 0)) return [];
  // 山（倍音のひとつひとつ）を拾う。雑音の高さ（真ん中の値）の 6 倍、いちばん高い山の 1% より高いもの
  const sorted = Array.from(mag.subarray(kMin, kMax + 1)).sort((a, b) => a - b);
  const floor = Math.max(sorted[sorted.length >> 1] * 6, top * 0.01);
  const peaks = [];
  for (let k = kMin; k <= kMax; k++) {
    const b = mag[k];
    if (b <= floor || b < mag[k - 1] || b <= mag[k + 1]) continue;
    const la = Math.log(mag[k - 1] + 1e-12);
    const lb = Math.log(b);
    const lc = Math.log(mag[k + 1] + 1e-12);
    const den = la - 2 * lb + lc;
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / den)) : 0;
    peaks.push({ f: (k + d) * binHz * scale, a: Math.exp(lb - 0.25 * (la - lc) * d) });
  }
  if (!peaks.length) return [];
  const amp = peaks.map((x) => x.a);
  const maxA = Math.max(...amp);
  /** f に近い山（±3%）のうち、いちばん強いものの番号 */
  const near = (f) => {
    let lo = 0;
    let hi = peaks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (peaks[mid].f < f * 0.97) lo = mid + 1;
      else hi = mid;
    }
    let best = -1;
    for (let i = lo; i < peaks.length && peaks[i].f <= f * 1.03; i++) if (best < 0 || amp[i] > amp[best]) best = i;
    return best;
  };
  /** その高さの音らしさ：倍音の強さの和（高い倍音ほど軽く）。基音か、2・3 倍音の両方が無ければ 0 */
  const salience = (m) => {
    const f0 = midiHz(m);
    let s = 0;
    const got = [];
    for (let h = 1; h <= H && h * f0 <= 5000; h++) {
      const i = near(h * f0);
      got[h] = i >= 0 ? amp[i] : 0;
      s += got[h] / h ** 0.5;
    }
    // 基音がある程度鳴っていること（和音の倍音を倍音に持つ、鳴っていない低い音を拾わないように）。
    // 低い音は基音が弱いことがあるので、2・3 倍音がそろっていれば基音は弱くてもよい
    if (!(got[1] > maxA * 0.08 || (got[1] > maxA * 0.02 && got[2] > 0 && got[3] > 0))) return { s: 0, got };
    return { s, got };
  };
  const notes = [];
  let first = 0;
  for (let n = 0; n < maxNotes; n++) {
    let best = -1;
    let bestS = 0;
    for (let m = minMidi; m <= maxMidi; m++) {
      if (notes.some((x) => x.midi === m)) continue;
      const { s } = salience(m);
      if (s > bestS) [best, bestS] = [m, s];
    }
    if (best < 0 || bestS < rel * first) break;
    // 1 オクターブ下と取りちがえていないか：基音と 3・5 倍音（奇数倍音）が弱く、1 オクターブ上でも同じくらい説明できるなら上
    const { got } = salience(best);
    if (best + 12 <= maxMidi) {
      const odd = (got[1] ?? 0) + (got[3] ?? 0) + (got[5] ?? 0);
      const even = (got[2] ?? 0) + (got[4] ?? 0) + (got[6] ?? 0);
      if (odd < even * 0.25 && salience(best + 12).s >= bestS * 0.7) best += 12;
    }
    if (!first) first = bestS;
    notes.push({ midi: best, s: bestS });
    // その音の倍音を消す（ほかの音と重なる倍音もあるので、全部ではなく 8 割）
    const f0 = midiHz(best);
    for (let h = 1; h <= H && h * f0 <= 5000; h++) {
      const i = near(h * f0);
      if (i >= 0) amp[i] *= 0.2;
    }
  }
  return notes;
}

// 5 の音（完全 5 度）は、セブンスでは弾かないことが多いので、無くてもよい
const OPTIONAL_FIFTH = new Set(['dom7', 'maj7', 'min7', 'mM7']);

/**
 * 音名ごとの重み（12 個、ド = 0）から、いちばん合うコード
 * @param opts bass（いちばん低い音の音名。根音の手がかり）、allow（選んでよい種類の id）
 * @returns {{ root, quality, complete, alts: string[] } | null}
 *   complete：コードの音がそろっている（足りないのはセブンスの 5 の音だけ）。そろっていなければ答えにしない
 *   alts：同じくらい合う種類（同じ音の組み合わせになる読み）
 */
export function identifyChord(w, { bass = null, allow = null } = {}) {
  const max = Math.max(...w);
  if (!(max > 0)) return null;
  const total = w.reduce((a, b) => a + b, 0);
  const on = w.map((x) => x >= max * 0.12); // 7 の音はほかの音と倍音が重なって弱く見えるので、低めに
  const all = [];
  for (const c of CHORDS) {
    if (allow && !allow.includes(c.id)) continue;
    for (let r = 0; r < 12; r++) {
      let inW = 0;
      const missing = [];
      for (const t of c.tones) {
        const pc = (r + t) % 12;
        inW += w[pc];
        if (!on[pc]) missing.push(t);
      }
      const outW = total - inW;
      const complete = !missing.length || (missing.length === 1 && missing[0] === 7 && OPTIONAL_FIFTH.has(c.id));
      const score = inW / total - 0.9 * (outW / total) - 0.3 * missing.length + (bass === r ? 0.04 : 0) - 0.01 * c.tones.length;
      all.push({ root: r, quality: c.id, complete, score });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => b.score - a.score);
  const best = all[0];
  const alts = [...new Set(all.filter((x) => x.complete && x.score >= best.score - 0.02).map((x) => x.quality))];
  return { root: best.root, quality: best.quality, complete: best.complete, alts: alts.length ? alts : [best.quality] };
}

/** MIDI 鍵盤で押した音（MIDI 番号の並び）から、コード */
export function chordFromMidi(notes, opts = {}) {
  if (!notes?.length) return null;
  const w = new Array(12).fill(0);
  for (const m of notes) w[((m % 12) + 12) % 12] = 1;
  return identifyChord(w, { bass: ((Math.min(...notes) % 12) + 12) % 12, ...opts });
}

/**
 * 1 枚ごとの結果を「和音を弾いた」という知らせに変える
 *   ・弾いた瞬間（大きさが 40 ms ほどで 2 倍以上に跳ね上がる・無音から鳴り始める）から集め始める
 *   ・from 秒たってから until 秒までの枚の音名を足し合わせ、コードの音がそろったところで 1 回知らせる
 *   ・分散和音（1 音ずつ弾く）は、集めているあいだに来た音も足す（window 秒まで）
 *   ・知らせたあとは、次に弾くまで知らせない
 * feed({ t, level, notes }) は、知らせるときだけ { root, quality, alts, notes } を返す
 */
export function makeChordTracker(opts = {}) {
  const o = { minLevel: 0.004, from: 0.1, settle: 0.22, window: 0.8, attack: 2, ...opts };
  let prev = [];
  let since = null; // 集め始めた時刻
  let cnt = new Array(12).fill(0); // 音名ごとの、聞こえた枚数
  let str = new Array(12).fill(0); // 音名ごとの、強さ（いちばん強い音に対する割合）の和
  let frames = 0;
  let bassMidi = null;
  let done = false;
  const heard = new Set();
  const reset = () => {
    since = null;
    cnt = new Array(12).fill(0);
    str = new Array(12).fill(0);
    frames = 0;
    bassMidi = null;
    done = false;
    heard.clear();
  };
  function feed({ t, level, notes }) {
    const low = prev.length ? Math.min(...prev) : 0;
    const struck = level >= o.minLevel && level >= o.attack * Math.max(low, o.minLevel * 0.25);
    prev.push(level);
    if (prev.length > 2) prev.shift();
    if (level < o.minLevel) {
      if (since != null && t - since > 0.15) reset(); // 止んだ
      return null;
    }
    if (struck && (since == null || done)) {
      reset();
      since = t;
    }
    if (since == null || done) return null;
    const age = t - since;
    if (age > o.window) {
      done = true; // そろわないまま時間切れ
      return null;
    }
    if (age >= o.from && notes?.length) {
      frames++;
      const top = notes[0].s;
      const seen = new Set();
      for (const n of notes) {
        const pc = ((n.midi % 12) + 12) % 12;
        if (seen.has(pc)) continue;
        seen.add(pc);
        cnt[pc]++;
        str[pc] += Math.min(1, n.s / top);
        heard.add(n.midi);
        if (bassMidi == null || n.midi < bassMidi) bassMidi = n.midi;
      }
    }
    if (age < o.settle || frames < 2) return null;
    // 重み = 聞こえた枚数の割合 ×（強さ）。弱くても毎回聞こえている音（7 の音・高い音）は鳴っている。
    // 倍音から出たまぼろしの音は、ときどきしか聞こえないので軽くなる
    const w = cnt.map((k, pc) => (k ? (k / frames) ** 1.5 * (0.4 + (0.6 * str[pc]) / k) : 0));
    const c = identifyChord(w, { bass: bassMidi == null ? null : bassMidi % 12, allow: o.allow });
    if (!c?.complete) return null;
    done = true;
    return { ...c, notes: [...heard].sort((a, b) => a - b) };
  }
  return { feed, reset };
}
