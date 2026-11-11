// マイクの音から音の高さを当てる（画面は使わない。Node のテストでも動く）
//
// 高さの当て方：McLeod の方法（MPM）
//   ・波形の自己相関を FFT で求め、ずらす量 τ ごとに 0〜1 にならした値 NSDF(τ) を作る
//     （1 周期ずらすと波形が重なるので、周期のところで 1 に近い山になる）
//   ・NSDF の山のうち、いちばん高い山の 0.9 倍を超える「最初の」山を周期とする
//       - 2 倍音が基音より強くても、半周期のところの山は低い（基音と 3 倍音が逆向きに重なる）ので、
//         1 オクターブ上には飛ばない
//       - 2 周期・3 周期のところの山も同じくらい高いが、最初の山を採るので 1 オクターブ下にも飛ばない
//   ・山の頂は前後 3 点の放物線で細かく求める。山の高さ（clarity）がはっきり具合
// 範囲は 50〜1600 Hz（A1 = 55 Hz〜G6 = 1568 Hz が入る）。チェロ・男声の低い音から、ソプラノ・フルート・バイオリンの
// 高いほうまで。譜読みで出るいちばん高い音（ト音記号の加線 3 本、F6 = 1397 Hz）も入る。
// 50 Hz の周期は 48 kHz で 960 点。2048 点の波形なら 2 周期と少し入る。
// 楽器を選ぶと、その楽器の音域に合わせた範囲で聞く（下の MIC_INSTRUMENTS）。
// 手間：2048 点なら 4096 点の FFT を往復 1 回（約 5 万回のバタフライ）と、ほかは点の数に比例するだけ。
// 1 秒に 50 回でも軽い（差の関数を 2 重ループで求める素朴な YIN より何倍も速い）

/** 波形の大きさ（二乗平均の平方根） */
export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return buf.length ? Math.sqrt(s / buf.length) : 0;
}

/** 周波数 → MIDI 番号（小数。69 が A4 = 440 Hz） */
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

// ---- FFT（2 の累乗の長さ。表と作業用の配列は長さごとに作っておく） ----
const plans = new Map();
function plan(M) {
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
function fft(re, im, { rev, cos, sin }) {
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

/**
 * 波形 1 枚から音の高さを当てる
 * @param buf 波形（Float32Array など。2048 点くらい）
 * @param sampleRate 1 秒の点の数
 * @param opts minFreq・maxFreq（Hz）、threshold（最初の山を採る割合）、minClarity（これより
 *             はっきりしない音は null）、minRms（これより小さい音は調べない）
 * @returns {{ freq: number, clarity: number } | null}
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const { minFreq = 50, maxFreq = 1600, threshold = 0.9, minClarity = 0.7, minRms = 1e-4 } = opts;
  const N = buf.length;
  // 調べるずらし量の上限。minFreq より低い音の周期は調べないので、そこへ 1 オクターブ下に飛ぶことはない。
  // 波形の 6 割より長い周期は、重なる部分が短すぎて当てにならない（2048 点・48 kHz なら 39 Hz まで）
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq) + 2, Math.floor(N * 0.6));
  if (N < 16 || tauMax < 4) return null;
  let M = 1;
  while (M < N + tauMax + 1) M <<= 1;
  const p = plan(M);
  const { re, im, x, n } = p;

  // 直流を除いた波形
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  let e = 0;
  for (let i = 0; i < N; i++) {
    const v = buf[i] - mean;
    x[i] = v;
    e += v * v;
  }
  if (Math.sqrt(e / N) < minRms) return null;

  // 自己相関 r(τ) = Σ x[j]·x[j+τ]（FFT → 大きさの二乗 → もう一度 FFT）
  for (let i = 0; i < M; i++) {
    re[i] = i < N ? x[i] : 0;
    im[i] = 0;
  }
  fft(re, im, p);
  for (let i = 0; i < M; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im, p); // 実数で左右対称なので、もう一度かけると逆変換（の M 倍）

  // NSDF(τ) = 2 r(τ) / Σ (x[j]² + x[j+τ]²)
  let m = 2 * e;
  n[0] = 1;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    m -= x[tau - 1] * x[tau - 1] + x[N - tau] * x[N - tau];
    n[tau] = m > 1e-12 ? (2 * re[tau]) / M / m : 0;
  }

  // τ = 0 の山を抜けてから、正の区間ごとの頂（key maximum）を集める
  let tau = 1;
  while (tau <= tauMax && n[tau] > 0) tau++;
  const peaks = [];
  let top = 0;
  let iMax = -1;
  for (; tau <= tauMax; tau++) {
    if (n[tau] > 0) {
      if (iMax < 0 || n[tau] > n[iMax]) iMax = tau;
    } else if (iMax >= 0) {
      peaks.push(iMax);
      top = Math.max(top, n[iMax]);
      iMax = -1;
    }
  }
  if (iMax >= 0 && iMax < tauMax) {
    peaks.push(iMax);
    top = Math.max(top, n[iMax]);
  }
  if (!peaks.length || top <= 0) return null;
  const pick = peaks.find((i) => n[i] >= threshold * top);

  // 放物線で頂を細かく
  const a = n[pick - 1];
  const b = n[pick];
  const c = n[pick + 1];
  const den = a - 2 * b + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  const period = pick + shift;
  const clarity = Math.min(1, b - 0.25 * (a - c) * shift);
  const freq = sampleRate / period;
  // maxFreq より高いと当てたら捨てる。短いずらし量のほうは狭めない（狭めると、範囲より高い音を
  // 1 オクターブ下の音とまちがえて答えにしてしまう。捨てれば答えにならないだけで済む）
  if (clarity < minClarity || freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity };
}

// ---- 楽器ごとの聞く範囲（設定の「マイクで聞く楽器」） ----
// low・high は楽器の出せる音（鳴る高さ）の MIDI 番号。両はしに 1.5 半音のゆとりをつけた外は聞かない
//   ・low より下：その周期は調べない（minFreq）。楽器に出せない低い音へ 1 オクターブ下に飛ぶことがない
//   ・high より上：そう当てたら捨てる（maxFreq）。2 倍音につられて 1 オクターブ上に飛んでも答えにならない
//   ・ゆとりは、低めに合わせた弦や少しずれた音も入るように（1 半音外の音までは入る。2 半音外は入らない）
// transpose：楽譜に書く音 = 鳴る音 + transpose。ギターとコントラバス・ベースは楽譜より 1 オクターブ低く鳴るので 12。
// ゲームは五線に書いた音と比べる（高さまで答えるとき）ので、聞こえた音を 1 オクターブ上げて渡す
const MARGIN = 1.5;
const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
const span = (low, high, transpose = 0) => ({ low, high, minFreq: midiToFreq(low - MARGIN), maxFreq: midiToFreq(high + MARGIN), transpose });

export const MIC_INSTRUMENTS = [
  // 今までどおり（detectPitch の初期値と同じ 50〜1600 Hz）
  { id: 'any', label: '指定なし', low: null, high: null, minFreq: 50, maxFreq: 1600, transpose: 0 },
  // 鍵盤は A0〜C8。ただ 2048 点（約 43 ms）の波形に周期が 1.67 回分は入らないと当てられないので、E1 から
  // （下限は 48 kHz で 39 Hz、44.1 kHz で 36 Hz）。上は C8 まで聞くが、G♯7 あたりから上は周期が 15 点に満たず、
  // ずらし量が整数なので山の頂を取りこぼし、倍音の強い音だと 1 オクターブ下に取ることがある
  // （ピアノのいちばん上の音は倍音が少ないので、たいてい当たる。譜読みで出る音は F6 まで）
  { id: 'piano', label: 'ピアノ・鍵盤', ...span(28, 108) }, // E1〜C8
  { id: 'violin', label: 'バイオリン', ...span(55, 100) }, // G3〜E7
  { id: 'viola', label: 'ビオラ', ...span(48, 88) }, // C3〜E6
  { id: 'cello', label: 'チェロ', ...span(36, 81) }, // C2〜A5
  // 書くのは E2〜G5、鳴るのは E1〜G4。5 弦の B0 や、D1 まで下げた弦は、ピアノと同じわけで当てられない
  { id: 'bass', label: 'コントラバス・ベース', ...span(28, 67, 12) },
  // 書くのは E3〜E7、鳴るのは E2〜E6（24 フレット）。6 弦を D に下げる弾き方（ドロップ D）も入るよう D2 から
  { id: 'guitar', label: 'ギター', ...span(38, 88, 12) },
  { id: 'flute', label: 'フルート', ...span(59, 96) }, // B3（H 足部管）〜C7
  { id: 'voice', label: '声', ...span(38, 84) }, // D2（バスの低い音）〜C6（ソプラノの高い音）
];

/** id の楽器（知らない id なら「指定なし」）。minFreq・maxFreq はそのまま detectPitch に渡せる */
export const micInstrument = (id) => MIC_INSTRUMENTS.find((x) => x.id === id) ?? MIC_INSTRUMENTS[0];

/** 聞こえた音（鳴る高さ）→ ゲームに渡す音（楽譜に書く高さ）。ギターとコントラバス・ベースだけ 12 上がる */
export const writtenNote = (midi, id) => (midi == null ? null : midi + micInstrument(id).transpose);

// ---- マイクの感度（設定の「マイクの感度」） ----
// 1 枚の大きさ（rms）が下限より小さければ無音とみなし、高さも調べない。「ふつう」の下限は今までと同じ 0.004（-48 dB）
export const MIC_FLOOR = 0.004;
// db：下限を「ふつう」から何 dB 動かすか。1 段で 5 dB（約 1.8 倍）、両はしで ±10 dB（約 3.2 倍）
//   ・5 dB は、マイクからの距離がおよそ 1.8 倍になったときの音の小さくなり方（距離が 2 倍で 6 dB）。
//     1 段ちがうと、はっきり分かるくらい聞こえ方が変わる
//   ・とても低い（-38 dB）：話し声やエアコンの音がする部屋でも、マイクの近くで鳴らした音だけを拾う
//   ・とても高い（-58 dB）：静かな部屋なら、離れたところの小さな声やフルートの弱い音も拾う。
//     これより下げると、静かな部屋でもマイクに入っている音（-60 dB くらいのことが多い）にかかって、
//     弾き終わっても無音にならない（メーターの左のはしも -60 dB）
// ゲームと設定画面は、高さを調べる下限と、音の区切りの「無音」の下限（makeNoteTracker の minLevel）の両方をこれに合わせる
export const MIC_SENS = [
  { id: 1, db: 10, name: 'とても低い', label: 'とても低い（にぎやかな部屋）' },
  { id: 2, db: 5, name: '低い', label: '低い（少し音のある部屋）' },
  { id: 3, db: 0, name: 'ふつう', label: 'ふつう' },
  { id: 4, db: -5, name: '高い', label: '高い（小さめの音も拾う）' },
  { id: 5, db: -10, name: 'とても高い', label: 'とても高い（離れた小さな音も拾う）' },
];

/** 感度の段（知らない段なら「ふつう」） */
export const micSens = (step) => MIC_SENS.find((x) => x.id === step) ?? MIC_SENS[2];

/** 感度の段 → 下限の大きさ（rms）。「ふつう」はちょうど 0.004 */
export const sensFloor = (step) => MIC_FLOOR * 10 ** (micSens(step).db / 20);

/**
 * 感度の段 → makeNoteTracker に渡す値
 * 大きさそのもので決めているのは「無音」の下限（minLevel）だけ。弾き直し（dip・rise）とすぐ消える音（sustain）は
 * 大きさの比で見ているので、下限を動かしてもそのままでよい（弾き直しの「下限より大きい」も minLevel を見る）。
 * 音を下限の倍率と同じだけ大きく（小さく）すれば、どの段でも「ふつう」と同じに区切れる
 */
export const sensTracker = (step) => ({ minLevel: sensFloor(step) });

/**
 * 周りの音を測った結果から感度を選ぶ（設定の「周りの音を測る」）
 * levels：アプリの音が鳴っていないあいだの、1 枚ごとの大きさ（rms）。20 ms ごとに 2 秒なら 100 個
 * 小さいほうから 9 割の大きさ（上の 1 割を除いた大きさ）を「周りの音」とし、下限がその margin 倍（2 倍 = 6 dB）
 * 以上ある段のうち、いちばん感度の高い段を選ぶ
 *   ・9 割：1 回のいすの音やせきで下げすぎない。ずっと鳴っている音（エアコン・話し声）はちゃんと入る
 *   ・2 倍：周りの音が下限をまたがない。またぐと、弾き終わっても無音にならず、周りの音の高さを調べ続ける
 *     （にせの音が出る・同じ音の弾き直しを数えにくい）
 * どの段でも足りないときは、いちばん低い段を ok: false で返す
 * @returns {{ step: number, room: number, ok: boolean } | null} 測れた枚数が minCount より少なければ null
 */
export function pickSens(levels, { pct = 0.9, margin = 2, minCount = 25 } = {}) {
  const xs = (levels || []).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (xs.length < minCount) return null;
  const room = xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(pct * xs.length) - 1))];
  // 段は感度の低い順（下限の大きい順）なので、合う段のうち最後のものがいちばん感度が高い
  const fit = MIC_SENS.filter((s) => sensFloor(s.id) >= margin * room).at(-1);
  return fit ? { step: fit.id, room, ok: true } : { step: MIC_SENS[0].id, room, ok: false };
}

/**
 * 1 枚ごとの高さの見積もりを「音が鳴った」という知らせに変える
 *   ・無音のあと・高さが変わったあと、同じ高さが stable 秒続いたら 1 回知らせる
 *   ・同じ音の弾き直し（音がいったん小さくなって、また大きくなる）でも、もう 1 回知らせる
 *   ・ビブラート（±hold 半音まで）・1 枚 2 枚の取りこぼし・1 オクターブの見まちがいは、同じ音のまま
 *   ・すぐ消える音（拍子木のような音とその残響）は知らせない
 *   ・半音に丸めるのは、いちばん近い半音から ±tolerance 以内のときだけ
 * feed({ t: 秒, level: 大きさ, freq: Hz か null }) は、知らせるときだけ MIDI 番号を返す
 * reset(hold) で最初から。hold が true なら、次に落ち着いた音は知らせずに「鳴っている音」として扱う
 * （アプリ自身の音が鳴り終わった直後の残りや、ずっと伸ばしている音を、新しい音と数えないため）
 */
export function makeNoteTracker(opts = {}) {
  const o = {
    minLevel: MIC_FLOOR, // これより小さければ無音（感度で変わる。sensTracker）
    stable: 0.05, // 同じ高さがこれだけ続いたら鳴ったとみなす（秒）
    minFrames: 3, // そのあいだに高さの分かった枚数
    tolerance: 0.4, // 半音に丸めてよいずれ（0.4 = 40 セント）
    hold: 0.6, // 鳴っている音からのずれがこれまでなら同じ音（ビブラート）
    release: 0.05, // 無音がこれだけ続いたら音が止んだとみなす
    unvoiced: 0.2, // 高さの分からない音がこれだけ続いても止んだとみなす
    minGap: 0.09, // 知らせと知らせの間
    dip: 0.6, // 弾き直し：いったん山の 0.6 倍まで下がり、
    rise: 1.8, //           そこから 1.8 倍に上がったら
    sustain: 0.5, // 知らせる瞬間の大きさが候補の間の最大のこれ倍より小さければ、すぐ消える音
    gap: 0.25, // 1 枚と 1 枚の間がこれより空いたら（裏に回ったなど）、候補を捨てる
    ...opts,
  };
  let cur = null; // 鳴っている音（知らせた音か、知らせずに受け入れた音）
  let cand = null; // 候補 { midi, since, frames, top }
  let lastEmit = -Infinity;
  let lastT = null;
  let quietSince = null;
  let unvoicedSince = null;
  let peak = 0;
  let trough = 0;
  let adopt = false;

  const near = (a, b) => Math.abs(a - b) <= o.hold;
  const sameNote = (m, c) => near(m, c) || near(m, c + 12) || near(m, c - 12);
  const start = (midi, level) => {
    cur = midi;
    cand = null;
    peak = level;
    trough = level;
  };
  const stop = () => {
    cur = null;
    cand = null;
  };

  function reset(hold = false) {
    stop();
    lastT = null;
    quietSince = null;
    unvoicedSince = null;
    peak = 0;
    trough = 0;
    adopt = !!hold;
  }

  function feed({ t, level, freq }) {
    if (lastT != null && t - lastT > o.gap) cand = null;
    lastT = t;
    const lv = Number.isFinite(level) ? level : 0;

    // 弾き直しの見張り：鳴っている音がいったん小さくなり、また大きくなったら新しい音として数え直す
    if (cur != null) {
      if (trough <= peak * o.dip && lv >= trough * o.rise && lv >= o.minLevel) {
        stop();
      } else if (lv > peak) {
        peak = lv;
        trough = lv;
      } else if (lv < trough) trough = lv;
    }

    // 無音
    if (lv < o.minLevel) {
      quietSince ??= t;
      if (t - quietSince >= o.release - 1e-9) {
        stop();
        adopt = false;
      }
      return null;
    }
    quietSince = null;

    // 高さが分からない（雑音・子音・取りこぼし）。少しのあいだは候補も鳴っている音もそのまま
    if (!(freq > 0)) {
      unvoicedSince ??= t;
      if (t - unvoicedSince >= o.unvoiced - 1e-9) {
        stop();
        adopt = false;
      }
      return null;
    }
    unvoicedSince = null;

    const m = freqToMidi(freq);
    if (cur != null && sameNote(m, cur)) {
      cand = null; // 鳴っている音のまま
      return null;
    }
    if (cand && near(m, cand.midi)) {
      cand.frames++;
      cand.top = Math.max(cand.top, lv);
    } else {
      const r = Math.round(m);
      if (Math.abs(m - r) > o.tolerance) {
        cand = null; // 半音と半音のあいだ
        return null;
      }
      cand = { midi: r, since: t, frames: 1, top: lv };
    }
    if (t - cand.since < o.stable - 1e-9 || cand.frames < o.minFrames) return null;
    if (lv < cand.top * o.sustain || adopt) {
      // すぐ消える音・アプリの音の残り：知らせずに鳴っている音として受け入れる（その残響も数えない）
      adopt = false;
      start(cand.midi, lv);
      return null;
    }
    if (t - lastEmit < o.minGap - 1e-9) return null; // 次の 1 枚でもう一度
    const midi = cand.midi;
    start(midi, lv);
    lastEmit = t;
    return midi;
  }

  return {
    feed,
    reset,
    /** いま鳴っている音（MIDI 番号）。無ければ null */
    get note() {
      return cur;
    },
  };
}
