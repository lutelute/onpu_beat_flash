// チューナーの針の決め方（画面は使わない。Node のテストでも動く。画面は screens/tuner.js）
// マイクの 1 枚（20 ms）ごとの高さから、「比べる音」と「針のずれ」を決める。
//   ・続き：鳴っている音の続き（直前の高さから 50 セント以内）なら、少しはっきりしない枚（弓を返すところ・
//     音の終わり・小さめの音）も受け取る。新しい音は、はっきりした枚だけで始める
//   ・飛び：鳴っている音から大きく外れた枚（倍音やオクターブへの飛び）は、3 枚続くまで受け取らない
//   ・針：直前 0.3 秒の真ん中の値（ビブラートがあれば、直前 0.5 秒の揺れの中心）
//   ・残す：聞こえなくなっても 1 秒までは、最後の針を残す（ちらつかない）
import { freqToMidi } from './pitch.js';
import { nearestString, analyzeVibrato } from './intonation.js';

export const TUNER = {
  clarityNew: 0.8, // 新しい音として受け取るはっきり具合
  clarityKeep: 0.7, // 鳴っている音の続きとして受け取るはっきり具合
  keepWithin: 50, // 続きとみなすずれ（セント）
  jumpFrames: 3, // 外れた高さが何枚続いたら移るか
  gap: 0.25, // これより長く聞こえなければ、次の音はすぐ受け取る（秒）
  window: 0.3, // 針の高さを決める長さ（秒）
  live: 0.15, // 最後に聞こえてから、この秒数までは「聞こえている」
  hold: 1.0, // ここまでは、最後の針を残す
  span: 1.4, // 見る範囲（秒）
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** 終わりから、途切れずに続いている（gap 秒より空かない）部分 */
export function contiguous(xs, gap = 0.1) {
  let i = xs.length - 1;
  while (i > 0 && xs[i].t - xs[i - 1].t <= gap) i--;
  return xs.slice(i);
}

/**
 * @param o.strings 弦楽器の開放弦と目標 [{ midi, cents }]（intonation.js の openStrings）。null なら いちばん近い半音
 * @param o.keep 高さの動きを残す秒数（画面の線用）
 */
export function makeTunerTrack({ strings = null, keep = 6.5, ...opts } = {}) {
  const P = { ...TUNER, ...opts };
  const hist = []; // [{ t, m, c, key }]（m・c は聞こえないとき null）
  let ref = null; // いま比べている音 { key, midi, cents, string }
  let cand = null; // 境目の向こうの音 { key, items }
  let lastVoiced = -Infinity;
  let lastT = 0;
  let est = null; // 直前に受け取った高さ（MIDI の小数）
  let jump = null; // 外れた高さ { m, items }（待たせている枚）

  const refOf = (m) => {
    const s = strings ? nearestString(m, strings, 2.5) : null;
    return s ? { key: `s${s.i}`, midi: s.midi, cents: s.cents, string: s.i } : { key: `n${Math.round(m)}`, midi: Math.round(m), cents: 0, string: null };
  };
  const trim = (t) => {
    while (hist.length && hist[0].t < t - keep) hist.shift();
  };
  const reset = () => {
    hist.length = 0;
    ref = null;
    cand = null;
    est = null;
    jump = null;
    lastVoiced = -Infinity;
  };

  return {
    hist,
    get ref() {
      return ref;
    },
    get lastT() {
      return lastT;
    },
    /** 開放弦を変えた（楽器・基準・純正の切り替え） */
    setStrings(s) {
      strings = s;
      reset();
    },
    /**
     * f：{ t, freq（Hz か null）, clarity, weak（下限より小さい）, gated }。受け取った枚 { t, m, c, key } か null を返す
     */
    feed(f) {
      if (f.t < lastT - 0.5) reset(); // 音の時計が 0 から数え直しになった
      lastT = f.t;
      const tracking = est != null && f.t - lastVoiced <= P.gap;
      let m = f.freq && !f.gated ? freqToMidi(f.freq) : null;
      const e = { t: f.t, m: null, c: null, key: '' };
      hist.push(e);
      trim(f.t);
      let moved = null; // 外れた高さへ移ったときの、それまで待たせていた枚
      if (m != null) {
        const near = tracking && Math.abs(m - est) * 100 <= P.keepWithin;
        // 下限より小さい枚（f.weak）は、鳴っている音の続きにだけ使う（小さな物音や話し声で針が出ないように）
        if (f.clarity < (near ? P.clarityKeep : P.clarityNew) || (f.weak && !near)) m = null;
        else if (tracking && !near) {
          // 鳴っている音から大きく外れた。同じ高さ（30 セント以内）が続いたら、その高さへ移る
          e.wait = m; // 待たせている高さ（移ったら使う）
          jump = jump && Math.abs(m - jump.m) * 100 <= 30 ? { m, items: [...jump.items, e] } : { m, items: [e] };
          if (jump.items.length < P.jumpFrames) m = null;
          else moved = jump.items;
        }
      }
      if (m == null) return null;
      jump = null;
      // 比べる音：近い開放弦か、いちばん近い半音。境目でちらつかないよう、3 枚続いたら移る
      const c0 = refOf(m);
      let rekey = null;
      if (!ref || c0.key === ref.key || moved || f.t - lastVoiced > P.gap) {
        ref = c0;
        cand = null;
      } else if (cand?.key === c0.key) {
        cand.items.push(e);
        if (cand.items.length >= P.jumpFrames) {
          ref = c0;
          rekey = cand.items;
          cand = null;
        }
      } else cand = { key: c0.key, items: [e] };
      est = m;
      lastVoiced = f.t;
      e.m = m;
      // 移ったときは、待たせていた枚も新しい音のずれにする（移った直後から針が出るように）
      for (const x of moved ?? rekey ?? [e]) {
        if (x.m == null) x.m = x.wait;
        delete x.wait;
        x.c = (x.m - ref.midi) * 100 - ref.cents;
        x.key = ref.key;
      }
      e.c = (m - ref.midi) * 100 - ref.cents;
      e.key = ref.key;
      return e;
    },
    /**
     * いまの針。state：live（聞こえている）・hold（聞こえなくなって間もない。最後の針を残す）・idle
     * value はずれ（セント）、vib はビブラート（なければ null）、run は途切れず続いている枚
     */
    read() {
      const since = lastT - lastVoiced;
      const state = since <= P.live ? 'live' : since <= P.hold ? 'hold' : 'idle';
      if (state === 'idle' || !ref) return { state: 'idle', ref: null, value: null, vib: null, run: [] };
      const recent = hist.filter((x) => x.c != null && x.key === ref.key && x.t >= lastVoiced - P.span);
      if (recent.length < 3) return { state: 'idle', ref: null, value: null, vib: null, run: [] };
      const run = contiguous(recent);
      const vib = run.length >= 25 ? analyzeVibrato(run.map((x) => ({ t: x.t, c: x.c }))) : null;
      const value = vib
        ? mean(run.filter((x) => x.t >= lastVoiced - 0.5).map((x) => x.c))
        : median(recent.filter((x) => x.t >= lastVoiced - P.window).map((x) => x.c));
      return { state, ref, value, vib, run };
    },
  };
}

/**
 * 針をなめらかに動かす（画面の更新ごと）。dt 秒たったときの位置。tau は追いつく速さ（秒）
 * 大きく離れているとき（音が変わった）は速く追う
 */
export function easeNeedle(shown, target, dt, tau = 0.12) {
  const far = Math.abs(target - shown) > 20;
  const k = 1 - Math.exp(-dt / (far ? tau / 3 : tau));
  return shown + (target - shown) * k;
}
