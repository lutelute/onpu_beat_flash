// マイクの聞き取りのベンチマーク：本物の楽器・声の録音を、アプリと同じ手順で聞かせて、1 音ずつ答えを確かめる
//   npm run bench:mic                 全部（先に fetch.mjs で録音を取ってくる）
//   npm run bench:mic -- cello piano  名前で選ぶ
//   VERBOSE=1 npm run bench:mic       うまくいかなかった音を並べる
//
// アプリと同じ手順：48 kHz・20 ms ごとに直前の 2048 点を見る・感度「ふつう」の下限より小さい枚は高さを調べない・
// 楽器の音域だけで高さを当てる（detectPitch）・音の区切り（makeNoteTracker、声は落ち着くまで待つ）
// 録音には少し部屋の雑音（-56 dB）を足し、大きさを強さごとにそろえる（mf：いちばん大きいところで -26 dB）
//
// 正解の決め方：録音を無音で区切って 1 音ずつに分け、その音の落ち着いたところの高さ（真ん中の値）を半音に丸める。
//   音階のファイル（ファイル名の音域）で、音の数が音域と同じなら、低い順に半音ずつ（いちばん確か）。
//   高さが半音の真ん中あたり（±0.35 より外）の音は、正解が決まらないので数えない（弾き手の音程のずれ）
import { SETS } from './manifest.mjs';
import { prepare, truths, listen, nm } from './lib.mjs';

const VERBOSE = !!process.env.VERBOSE;
const pick = process.argv.slice(2);

function judge(segs, ev) {
  const res = { ok: 0, wrong: 0, extra: 0, miss: 0, skip: 0, ghost: 0, lat: [], bad: [] };
  const used = new Set();
  segs.forEach((s, i) => {
    const next = segs[i + 1]?.a ?? Infinity;
    const mine = ev.filter((e, j) => !used.has(j) && e.t >= s.a - 0.02 && e.t < Math.min(next, s.b + 0.4) && used.add(j));
    if (s.truth == null) {
      res.skip++;
      return;
    }
    if (!mine.length) {
      res.miss++;
      res.bad.push(`${s.a.toFixed(2)}秒 ${nm(s.truth)}：答えなし`);
    } else if (mine[0].m !== s.truth) {
      res.wrong++;
      res.bad.push(`${s.a.toFixed(2)}秒 ${nm(s.truth)}（${s.m?.toFixed(2)}）：${mine.map((e) => nm(e.m)).join(' ')}`);
    } else if (mine.length > 1) {
      res.extra++;
      res.bad.push(`${s.a.toFixed(2)}秒 ${nm(s.truth)}：${mine.map((e) => `${nm(e.m)}@${(e.t - s.a).toFixed(2)}`).join(' ')}`);
    } else {
      res.ok++;
      res.lat.push(mine[0].t - s.a);
    }
  });
  res.ghost = ev.length - used.size;
  ev.forEach((e, j) => {
    if (!used.has(j)) res.bad.push(`${e.t.toFixed(2)}秒 空答え ${nm(e.m)}`);
  });
  return res;
}

const add = (a, b) => {
  for (const k of ['ok', 'wrong', 'extra', 'miss', 'skip', 'ghost']) a[k] += b[k];
  a.lat.push(...b.lat);
  a.bad.push(...b.bad);
};
const empty = () => ({ ok: 0, wrong: 0, extra: 0, miss: 0, skip: 0, ghost: 0, lat: [], bad: [] });
const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(0)}%` : '—');
const med = (a) => (a.length ? Math.round(1000 * [...a].sort((p, q) => p - q)[a.length >> 1]) : null);

const rows = [];
const all = { any: empty(), inst: empty() };
for (const set of SETS) {
  if (pick.length && !pick.some((p) => set.id.startsWith(p))) continue;
  const tot = { any: empty(), inst: empty() };
  for (const file of set.files) {
    const x = prepare(set, file);
    if (!x) {
      console.log(`（録音が無い：${set.id}/${file}。先に node scripts/mic-bench/fetch.mjs）`);
      continue;
    }
    const segs = truths(set, file, x);
    for (const which of ['any', 'inst']) {
      const r = judge(segs, listen(x, which === 'any' ? 'any' : set.inst));
      if (VERBOSE && r.bad.length) r.bad = r.bad.map((b) => `${file.split('/').pop()} ${b}`);
      add(tot[which], r);
    }
  }
  for (const which of ['any', 'inst']) {
    const t = tot[which];
    const n = t.ok + t.wrong + t.extra + t.miss;
    rows.push({ set: set.label, which: which === 'any' ? '指定なし' : set.inst, n, ...t, latMs: med(t.lat) });
    add(all[which], t);
  }
}

console.log('\n| 楽器 | 楽器の設定 | 音 | 正しく 1 回 | 最初がちがう | 余計に答えた | 答えなし | 空答え | 反応（真ん中） | 数えない音 |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(`| ${r.set} | ${r.which} | ${r.n} | ${r.ok}（${pct(r.ok, r.n)}） | ${r.wrong} | ${r.extra} | ${r.miss} | ${r.ghost} | ${r.latMs ?? '—'} ms | ${r.skip} |`);
}
for (const which of ['any', 'inst']) {
  const t = all[which];
  const n = t.ok + t.wrong + t.extra + t.miss;
  console.log(`| **合計** | ${which === 'any' ? '指定なし' : '楽器を選ぶ'} | ${n} | **${t.ok}（${pct(t.ok, n)}）** | ${t.wrong} | ${t.extra} | ${t.miss} | ${t.ghost} | ${med(t.lat)} ms | ${t.skip} |`);
}
if (VERBOSE) {
  for (const r of rows) if (r.bad.length) console.log(`\n## ${r.set}（${r.which}）\n${r.bad.join('\n')}`);
}
