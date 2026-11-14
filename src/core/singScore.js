// 「なぞって採点」の採点（画面は使わない。Node のテストでも動く）
// マイクの 1 枚（20 ms）ごとに、その時刻に鳴らすはずの音と、聞こえた高さのずれ（セント）を集める。
// どのオクターブで歌っても弾いても同じ（男の人が 1 オクターブ下で歌っても、チェロが楽譜より下で弾いても合う）
//
// 点数（100 点）＝ 音程 70％ ＋ 安定 15％ ＋ 出だし 15％、ビブラートがあれば少し足す（最大 +2 点。100 点まで）
//   音程   … 鳴らすはずの時間のうち、合っていた割合。ずれが「きびしさ」の幅の中なら満点、その倍で 0
//            （音の出だしの 0.12 秒と、終わりの 0.06 秒は数えない。音から音へ移るところ）
//   安定   … 0.6 秒より長い音で、高さがふらつかないか。ビブラートの揺れは均してから見る（揺れは減点しない）
//            均した高さの標準偏差が 3 セントまでは満点、10 セントで 65 点、23 セントで 0
//   出だし … 音が変わってから、その高さに入るまでの速さ（0.1 秒までは満点、0.45 秒で 0。入れた音だけで平均）
import { temperCents, analyzeVibrato } from './intonation.js';

export const STRICTNESS = {
  easy: { label: 'やさしい（±50 セント）', tol: 50 },
  normal: { label: 'ふつう（±30 セント）', tol: 30 },
  strict: { label: 'きびしい（±15 セント）', tol: 15 },
};

/** m（MIDI 番号・小数）が target から何セントずれているか。オクターブは問わない（-600〜+600） */
export function foldCents(m, target) {
  const c = (m - target) * 100;
  return c - 1200 * Math.round(c / 1200);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const meanOf = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * @param o.notes  [{ midi, t, d }]（秒。旋律の始まりから。重ならない、時刻の順）
 * @param o.tol    きびしさ（セント）
 * @param o.temper 音律（intonation.js の TEMPERAMENTS）、o.tonic 主音（0〜11）
 */
export function makeSingScorer({ notes, tol = 30, temper = 'equal', tonic = 0 }) {
  const items = notes.map((n) => ({ midi: n.midi, t: n.t, d: n.d, target: n.midi + temperCents(n.midi, temper, tonic) / 100, frames: [] }));
  let k = 0;
  return {
    items,
    /** 時刻 t（秒）に聞こえた高さ m（MIDI 番号・小数。聞こえなければ null）。t は増えていく順に。いま鳴らす音とずれを返す */
    feed(t, m) {
      while (k < items.length && t >= items[k].t + items[k].d) k++;
      const n = items[k];
      if (!n || t < n.t) return null;
      const c = m == null ? null : foldCents(m, n.target);
      n.frames.push({ t, c });
      return { note: n, c };
    },
    result: () => scoreItems(items, tol),
  };
}

/** 1 枚の点（0〜1） */
export const frameCredit = (c, tol) => (c == null ? 0 : Math.abs(c) <= tol ? 1 : clamp01(1 - (Math.abs(c) - tol) / tol));

function scoreItems(items, tol) {
  let credit = 0;
  let judged = 0;
  const per = items.map((n) => {
    const grace = Math.min(0.12, n.d / 4);
    const tail = Math.min(0.06, n.d / 6);
    const js = n.frames.filter((f) => f.t >= n.t + grace && f.t < n.t + n.d - tail);
    const cr = js.reduce((s, f) => s + frameCredit(f.c, tol), 0);
    credit += cr;
    judged += js.length;
    // その音を鳴らそうとしていた枚（1 半音より近い）。音程のくせ（高め・低め）はここから
    const near = js.filter((f) => f.c != null && Math.abs(f.c) <= 100);
    // 出だし：3 枚続けて合ったところ
    const ok = (f) => f && f.c != null && Math.abs(f.c) <= Math.max(tol, 30) * 1.5;
    const fs = n.frames;
    let delay = null;
    for (let i = 0; i + 2 < fs.length; i++) {
      if (ok(fs[i]) && ok(fs[i + 1]) && ok(fs[i + 2])) {
        delay = Math.max(0, fs[i].t - n.t);
        break;
      }
    }
    // ふらつき：0.18 秒（ビブラート 1 回ぶん）で均した高さの標準偏差
    let sd = null;
    if (n.d >= 0.6 && near.length >= 15) {
      const W = 4;
      const sm = near.map((_, i) => meanOf(near.slice(Math.max(0, i - W), i + W + 1).map((f) => f.c)));
      const mu = meanOf(sm);
      sd = Math.sqrt(meanOf(sm.map((x) => (x - mu) ** 2)));
    }
    const vib = n.d >= 0.8 ? analyzeVibrato(near.filter((f) => f.t >= n.t + 0.25).map((f) => ({ t: f.t, c: f.c }))) : null;
    return {
      midi: n.midi, target: n.target, t: n.t, d: n.d,
      judged: js.length,
      cover: js.length ? cr / js.length : null,
      median: near.length >= 3 ? round(median(near.map((f) => f.c))) : null,
      near: near.length,
      delay: delay == null ? null : round(delay, 3),
      sd: sd == null ? null : round(sd),
      vib,
    };
  });
  const scored = per.filter((p) => p.judged > 0);
  const pitch = judged ? (100 * credit) / judged : 0;
  const stables = per.filter((p) => p.sd != null).map((p) => clamp01(1 - (p.sd - 3) / 20));
  const stable = stables.length ? 100 * meanOf(stables) : null;
  // 出だしは、その高さに入れた音だけで見る（入れなかった音は音程の点で減っている）
  const entered = scored.filter((p) => p.delay != null);
  const attack = entered.length ? 100 * meanOf(entered.map((p) => clamp01(1 - (p.delay - 0.1) / 0.35))) : 0;
  const vibs = per.filter((p) => p.vib).map((p) => p.vib);
  const base = stable == null ? 0.8 * pitch + 0.2 * attack : 0.7 * pitch + 0.15 * stable + 0.15 * attack;
  const bonus = Math.min(2, 0.5 * vibs.length);
  const total = Math.min(100, base + (pitch >= 50 ? bonus : 0));

  // 音ごと（同じ高さの音をまとめる）：高め・低めのくせ
  const by = new Map();
  for (const p of per) {
    if (!p.judged) continue;
    const b = by.get(p.midi) ?? { midi: p.midi, target: p.target, n: 0, cover: 0, sum: 0, w: 0 };
    b.n++;
    b.cover += p.cover;
    if (p.median != null) {
      b.sum += p.median * p.near;
      b.w += p.near;
    }
    by.set(p.midi, b);
  }
  const byPitch = [...by.values()].sort((a, b) => a.midi - b.midi)
    .map((b) => ({ midi: b.midi, target: b.target, n: b.n, cover: b.cover / b.n, mean: b.w ? round(b.sum / b.w) : null }));
  const ws = per.filter((p) => p.median != null);
  const bias = ws.length ? round(ws.reduce((s, p) => s + p.median * p.near, 0) / ws.reduce((s, p) => s + p.near, 0)) : null;

  return {
    total: Math.round(total * 1000) / 1000,
    pitch: round(pitch),
    stable: stable == null ? null : round(stable),
    attack: round(attack),
    bias,
    vibrato: { count: vibs.length, rate: vibs.length ? round(meanOf(vibs.map((v) => v.rate))) : null, width: vibs.length ? round(meanOf(vibs.map((v) => v.width))) : null },
    notes: per,
    byPitch,
  };
}

/**
 * 結果のひとこと（いちばん目立つくせを 2 つまで）
 * @param r result()、name(midi) → 音名
 */
export function adviceOf(r, name, tol = 30) {
  const out = [];
  if (r.pitch >= 92) out.push('音程がとても正確です');
  if (r.bias != null && Math.abs(r.bias) >= 6) out.push(`全体に少し${r.bias > 0 ? '高め' : '低め'}です（平均 ${r.bias > 0 ? '+' : ''}${Math.round(r.bias)} セント）`);
  const worst = r.byPitch.filter((b) => b.mean != null && Math.abs(b.mean - (r.bias ?? 0)) >= Math.max(8, tol / 2))
    .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))[0];
  if (worst) out.push(`${name(worst.midi)} が${worst.mean > 0 ? '高め' : '低め'}になりがちです（${worst.mean > 0 ? '+' : ''}${Math.round(worst.mean)} セント）`);
  if (r.stable != null && r.stable < 60) out.push('長い音で高さがふらつきます。息（弓）の速さを一定に');
  if (r.attack < 60) out.push('音が変わるところで、新しい高さに入るのが遅れがちです');
  if (r.vibrato.count) out.push(`ビブラート ${r.vibrato.count} 回（1 秒に ${r.vibrato.rate} 回・幅 ±${Math.round(r.vibrato.width)} セント）`);
  return out.slice(0, 3);
}
