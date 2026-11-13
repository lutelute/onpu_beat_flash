// FFT（2 の累乗の長さ）。表と作業用の配列は長さごとに作っておく（単音の聞き取り pitch.js と、和音の聞き取り chordListen.js が使う）
const plans = new Map();
export function plan(M) {
  let p = plans.get(M);
  if (p) return p;
  const bits = Math.round(Math.log2(M));
  const rev = new Uint32Array(M);
  for (let i = 0; i < M; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(M / 2);
  const sin = new Float64Array(M / 2);
  for (let i = 0; i < M / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / M);
    sin[i] = -Math.sin((2 * Math.PI * i) / M);
  }
  p = { rev, cos, sin, re: new Float64Array(M), im: new Float64Array(M), x: new Float64Array(M), n: new Float64Array(M) };
  plans.set(M, p);
  return p;
}
export function fft(re, im, { rev, cos, sin }) {
  const M = re.length;
  for (let i = 0; i < M; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= M; size <<= 1) {
    const half = size >> 1;
    const step = M / size;
    for (let i = 0; i < M; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j;
        const b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k];
        const ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

