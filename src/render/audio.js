// Web Audio で作るピアノの音と効果音。録音した音源は使わない
// events = [{ midi: number[], t: 開始秒, d: 長さ秒 }]
//
// ピアノの音の作り方（倍音を 1 本ずつ足す）
//   ・弦は硬いので、上の倍音ほど少し高くずれる（不協和性）
//   ・ハンマーが弦の 1/8 あたりを打つので、8 倍音あたりが弱い
//   ・上の倍音ほど早く消える。低い音ほど長く響く
//   ・基音は 2 本の弦でわずかにずらし、うなりを付ける
//   ・打った瞬間の「コツ」という雑音と、部屋の響き（合成した残響）を足す

let ac = null;
let master = null; // 音量
let bus = null; // 声をまとめるところ（ここから素の音と残響へ）
let volume = 0.7;
let noiseBuf = null;
const live = new Set();

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** 残響の素（2 秒弱の減衰する雑音。左右で別の乱数） */
function makeImpulse(ctx, seconds = 1.8) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = ch ? 0x9e3779b9 : 0x7f4a7c15;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      d[i] = rnd() * (1 - x) ** 3.2 * (i < ctx.sampleRate * 0.004 ? 0 : 1);
    }
  }
  // 強さは自分で決める（ConvolverNode の自動の正規化は雑音の残響を大きくしすぎる）
  let e = 0;
  for (let ch = 0; ch < 2; ch++) for (const x of buf.getChannelData(ch)) e += x * x;
  const k = 1 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return buf;
}

/** 声をまとめるところから先（素の音＋残響 → 音量 → 圧縮 → 出口）を作る */
function makeChain(ctx, dest) {
  // 割れを防ぐだけの「丸め」。0.7 までは素通しで、それより大きいところだけなだらかに抑える
  // （DynamicsCompressor は自動で音量を持ち上げ、出だしを抑えてから戻すので、音がふくらんで聞こえる）
  const comp = ctx.createWaveShaper();
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    curve[i] = Math.sign(x) * (ax <= 0.7 ? ax : 0.7 + 0.3 * Math.tanh((ax - 0.7) / 0.3));
  }
  comp.curve = curve;
  comp.oversample = '2x';
  const vol = ctx.createGain();
  const input = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 0.86;
  const rev = ctx.createConvolver();
  rev.normalize = false;
  rev.buffer = makeImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  const pre = ctx.createDelay(0.05);
  pre.delayTime.value = 0.018;
  input.connect(dry).connect(vol);
  input.connect(pre).connect(rev).connect(wet).connect(vol);
  vol.connect(comp).connect(dest);
  return { input, vol };
}

function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.06);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) d[i] = ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  noiseBuf = b;
  return b;
}

/**
 * ピアノの 1 音を ctx の dest へ。戻り値は止めるための部品
 * @param vel 0〜1（強さ。強いほど上の倍音が明るい）
 */
export function pianoVoice(ctx, dest, midi, t, d, vel = 0.8) {
  const f = freq(midi);
  const out = ctx.createGain();
  out.connect(dest);
  const oscs = [];
  // 倍音の数（高い音ほど少なく、1 万 Hz を超えない）
  const N = clamp(Math.floor(10000 / f), 1, 16);
  const B = 0.00012 * 2 ** ((midi - 60) / 12); // 不協和性：高い音ほど大きい
  const tau1 = clamp(2.6 - (midi - 36) * 0.035, 0.55, 2.8); // 基音の減衰の時定数（秒）
  const amps = [];
  for (let n = 1; n <= N; n++) {
    const hammer = 0.35 + 0.65 * Math.abs(Math.sin((Math.PI * n) / 8.3));
    const bright = vel ** ((n - 1) * 0.18);
    amps.push((hammer * bright) / n ** 1.15);
  }
  const sum = amps.reduce((s, a) => s + a, 0);
  const lowBoost = 1 + 0.7 * clamp((250 - f) / 200, 0, 1); // 低い音は小さく聞こえるので少し上げる
  const peak = (0.42 * vel * lowBoost) / sum;
  const damp = clamp(0.14 - (midi - 40) * 0.0015, 0.05, 0.14); // 鍵を離したあと消える速さ
  for (let n = 1; n <= N; n++) {
    const fn = n * f * Math.sqrt(1 + B * n * n);
    if (fn > ctx.sampleRate / 2.2) break;
    const a = amps[n - 1] * peak;
    const tau = tau1 / (1 + 0.5 * (n - 1));
    const strings = n === 1 ? [-0.9, 0.9] : [0]; // 基音だけ 2 本の弦（セント）
    for (const cents of strings) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fn;
      o.detune.value = cents;
      const g = ctx.createGain();
      const amp = a / strings.length;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.0035);
      g.gain.setTargetAtTime(0, t + 0.0035, tau);
      g.gain.setTargetAtTime(0, t + d, damp);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + damp * 8);
      oscs.push(o);
    }
  }
  // 打鍵の雑音（ごく短く）
  const nz = ctx.createBufferSource();
  nz.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = clamp(f * 4, 1200, 5000);
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.05 * vel, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  nz.connect(bp).connect(ng).connect(out);
  nz.start(t);
  nz.stop(t + 0.06);
  oscs.push(nz);
  return { out, oscs, end: t + d + damp * 8 };
}

export function ensureAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC({ latencyHint: 'interactive' });
    const chain = makeChain(ac, ac.destination);
    bus = chain.input;
    master = chain.vol;
    master.gain.value = volume;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

// マイクで答えるとき、アプリ自身の高さのある音を聞かないように、それが静かになる時刻を覚えておく
let quietVoice = 0; // ピアノの音
let quietTone = 0; // 効果音
const TAIL = 0.15; // 残響のぶん

function voice(midi, t, d, vel) {
  const v = pianoVoice(ac, bus, midi, t, d, vel);
  live.add(v);
  v.oscs[0].onended = () => live.delete(v);
  quietVoice = Math.max(quietVoice, (t + d + v.end) / 2 + TAIL); // 鍵を離してから消えるまでの半分（約 -35 dB）
}

/** 音の並びをすぐ鳴らす。戻り値は鳴り終わるまでの秒数 */
export function playEvents(events, { delay = 0.03, vel = 0.8 } = {}) {
  if (!events?.length || !ensureAudio()) return 0;
  return playEventsAt(events, ac.currentTime + delay, vel) + delay;
}

/** 音の並びを時刻 t0（audioNow の時計）から鳴らす。戻り値は長さ（秒） */
export function playEventsAt(events, t0, vel = 0.8) {
  if (!events?.length || !ensureAudio()) return 0;
  let last = 0;
  for (const e of events) {
    const v = vel / Math.sqrt(Math.max(1, e.midi.length) * 0.75); // 和音は 1 音ずつ少し弱く
    for (const m of e.midi) voice(m, Math.max(t0 + e.t, ac.currentTime), e.d, v);
    last = Math.max(last, e.t + e.d);
  }
  return last;
}

/**
 * 手元で音を書き出す（確かめ用。画面では使わない）。戻り値は左右をまぜた波形
 */
export async function renderOffline(events, seconds, vel = 0.8, sampleRate = 44100) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const { input } = makeChain(ctx, ctx.destination);
  for (const e of events) {
    const v = vel / Math.sqrt(Math.max(1, e.midi.length) * 0.75);
    for (const m of e.midi) pianoVoice(ctx, input, m, e.t, e.d, v);
  }
  const buf = await ctx.startRendering();
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  return { data: l.map((x, i) => (x + r[i]) / 2), sampleRate };
}

export const audioRunning = () => !!ac && ac.state === 'running';

/** 音が出せる状態になるまで少し待つ（iPhone は起こしてから動き出すまで間がある）。出せれば true */
export async function audioReady(waitMs = 600) {
  if (!ensureAudio()) return false;
  if (ac.state === 'running') return true;
  await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, waitMs))]);
  return ac.state === 'running';
}

/** 音の時計（秒）。リズムの判定と表示はこれに合わせる */
export const audioNow = () => (ac ? ac.currentTime : performance.now() / 1000);

/** アプリの高さのある音が静かになる時刻（audioNow の時計）。マイクはこの時刻まで聞かない。音量 0 なら 0 */
export const audioQuietAt = () => (volume > 0 ? Math.max(quietVoice, quietTone) : 0);

/** 鳴っている音を全部すばやく止める（次の問題に移るとき） */
export function stopAll() {
  if (!ac) return;
  const now = ac.currentTime;
  for (const v of live) {
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, 0.015);
      for (const o of v.oscs) o.stop(now + 0.12);
    } catch {
      /* 止め済み */
    }
  }
  live.clear();
  quietVoice = Math.min(quietVoice, now + 0.12 + TAIL);
}

// ---- 効果音（やわらかい音だけ。耳ざわりな矩形波は使わない） ----
function tone(f, t, { d = 0.12, peak = 0.1, type = 'sine', glide } = {}) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + d);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, d / 4);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + d * 1.5 + 0.05);
  // メトロノーム・拍子木のような短い音（0.1 秒未満）は数えない。リズムのゲームではちょうどその瞬間に
  // 弾くので、止めると答えられなくなる（すぐ消える音は聞き取りの側でも音として数えない）
  if (d >= 0.1) quietTone = Math.max(quietTone, t + d * 1.5 + TAIL);
}
/** 木の拍子木のような短い音 */
function wood(t, high) {
  const f = high ? 1900 : 1350;
  tone(f, t, { d: 0.05, peak: high ? 0.16 : 0.11, type: 'triangle' });
  tone(f * 2.3, t, { d: 0.025, peak: high ? 0.05 : 0.035 });
}

/** お手本のリズムの 1 打（クラベスのような高く乾いた音）を時刻 t に */
export function clapAt(t) {
  if (!ensureAudio()) return;
  const at = Math.max(t, ac.currentTime);
  tone(2500, at, { d: 0.05, peak: 0.16 });
  tone(1650, at, { d: 0.06, peak: 0.07, type: 'triangle' });
}

/** メトロノームの 1 打を時刻 t に */
export function clickAt(t, accent = false) {
  if (!ensureAudio()) return;
  wood(Math.max(t, ac.currentTime), accent);
}

/** 効果音：tick（数え）・ok・ng・fanfare */
export function sfx(kind) {
  if (!ensureAudio()) return;
  const t = ac.currentTime + 0.01;
  if (kind === 'tick') wood(t, false);
  else if (kind === 'go') wood(t, true);
  else if (kind === 'ok') {
    // 小さな鈴の 2 音（ミ→シ）
    tone(1318.5, t, { d: 0.35, peak: 0.07 });
    tone(1318.5 * 2.76, t, { d: 0.12, peak: 0.015 });
    tone(1975.5, t + 0.08, { d: 0.45, peak: 0.07 });
    tone(1975.5 * 2.76, t + 0.08, { d: 0.12, peak: 0.015 });
  } else if (kind === 'ng') {
    // やわらかく下がる低い音
    tone(330, t, { d: 0.22, peak: 0.09, type: 'triangle', glide: 196 });
  } else if (kind === 'fanfare') {
    playEventsAt([60, 64, 67, 72].map((m, i) => ({ midi: [m], t: i * 0.09, d: 0.9 - i * 0.09 })).concat([{ midi: [60, 64, 67, 72], t: 0.42, d: 1.2 }]), t, 0.7);
  } else if (kind === 'pop') {
    // 倒したときの「ポン」（雑音だけ。高さが無いのでマイクが音名と取り違えない）
    noiseHit(t, { f: 2600, q: 1.2, d: 0.07, peak: 0.22 });
    noiseHit(t, { f: 700, q: 0.9, d: 0.05, peak: 0.12 });
  } else if (kind === 'thud') {
    // 届かれたときの低い「ドン」（雑音を低く絞る）
    noiseHit(t, { f: 160, q: 0.7, d: 0.28, peak: 0.5, type: 'lowpass' });
    noiseHit(t, { f: 900, q: 0.8, d: 0.06, peak: 0.1 });
  }
}

/** 雑音を帯域で絞った短い音（効果音用） */
function noiseHit(t, { f, q = 1, d = 0.08, peak = 0.2, type = 'bandpass' }) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  src.loop = true; // 雑音の素は短いので繰り返す
  const flt = ac.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.003, d / 3);
  src.connect(flt).connect(g).connect(bus);
  src.start(t);
  src.stop(t + d * 2 + 0.05);
}
