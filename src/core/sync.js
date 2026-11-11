// アカウントに置く記録（成績と自己ベスト）の合わせ方。画面にもネットワークにも触らない（Node でテストできる）
//
// 記録は 3 つを見比べて合わせる：
//   base   … 前に合わせたときの中身（この端末が覚えている）
//   local  … この端末のいまの中身
//   remote … アカウントにあるいまの中身（ほかの端末が進めているかもしれない）
// この端末で増えた分（local − base）を remote に足す。こうすると、2 台で別々に練習しても、どちらの分も残る。
import { validStat } from './settings.js';

export const CLOUD_APP = 'onpu-beat-flash';
export const CLOUD_VERSION = 1;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) ? v : 0);

export const emptyData = () => ({ stats: {}, records: {} });

/** 何が入っていてもよい値から、成績と自己ベストの使える部分だけを写し取る（元の値とは別の入れ物になる） */
export function normalizeData(saved) {
  const out = emptyData();
  if (!isObj(saved)) return out;
  if (isObj(saved.stats)) {
    for (const [space, m] of Object.entries(saved.stats)) {
      if (!isObj(m)) continue;
      const ok = Object.entries(m).filter(([, s]) => validStat(s));
      if (ok.length) out.stats[space] = Object.fromEntries(ok.map(([k, s]) => [k, { n: s.n, ok: s.ok, ms: s.ms, msN: s.msN, conf: cleanConf(s.conf) }]));
    }
  }
  if (isObj(saved.records)) {
    for (const [k, r] of Object.entries(saved.records)) {
      if (Number.isFinite(r)) out.records[k] = r;
      else if (isObj(r) && Number.isFinite(r.ok)) out.records[k] = { ...r };
    }
  }
  return out;
}
const cleanConf = (conf) => Object.fromEntries(Object.entries(conf).filter(([, v]) => Number.isFinite(v) && v > 0));

/**
 * 自己ベストとして a が b より良いか。
 * 数（点数・正確さ・検定の段階）は大きいほうが良い。
 * 即答の記録 { ok, ng, time } は、正解が多い → ミスが少ない → 時間が短い の順に比べる。
 */
export function betterRecord(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  if (isObj(a) && isObj(b)) {
    if (a.ok !== b.ok) return a.ok > b.ok;
    if ((a.ng ?? 0) !== (b.ng ?? 0)) return (a.ng ?? 0) < (b.ng ?? 0);
    return (a.time ?? 0) < (b.time ?? 0);
  }
  return false; // 形が違うものは比べられない（いまあるほうを残す）
}

/** キーの順によらない文字列（中身が同じかを比べるため） */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
export const sameData = (a, b) => canon(a) === canon(b);
const same = sameData;
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** 成績 1 件：remote に、この端末で増えた分（local − base）を足す */
function mergeStat(b, l, r) {
  if (same(l, b)) return copy(r); // この端末では変わっていない
  if (same(r, b)) return copy(l); // 向こうは変わっていない
  const f = (k) => Math.max(0, num(r?.[k]) + num(l?.[k]) - num(b?.[k]));
  const n = Math.round(f('n'));
  if (n <= 0) return undefined;
  const ok = Math.min(n, Math.round(f('ok')));
  const msN = Math.min(ok, Math.round(f('msN')));
  const conf = {};
  for (const k of new Set([b, l, r].flatMap((s) => Object.keys(s?.conf ?? {})))) {
    const v = Math.round(num(r?.conf?.[k]) + num(l?.conf?.[k]) - num(b?.conf?.[k]));
    if (v > 0) conf[k] = v;
  }
  return { n, ok, ms: msN ? f('ms') : 0, msN, conf };
}

function mergeStats(base, local, remote) {
  const out = {};
  for (const space of new Set([base, local, remote].flatMap((s) => Object.keys(s)))) {
    const [b, l, r] = [base[space] ?? {}, local[space] ?? {}, remote[space] ?? {}];
    const m = {};
    for (const key of new Set([b, l, r].flatMap((s) => Object.keys(s)))) {
      const v = mergeStat(b[key], l[key], r[key]);
      if (v && v.n > 0) m[key] = v;
    }
    if (Object.keys(m).length) out[space] = m;
  }
  return out;
}

function mergeRecords(base, local, remote) {
  const out = {};
  for (const key of new Set([base, local, remote].flatMap((s) => Object.keys(s)))) {
    const [b, l, r] = [base[key], local[key], remote[key]];
    let v;
    if (same(l, b)) v = r; // この端末では変わっていない → 向こうのまま（向こうで消えていれば消える）
    else if (l === undefined) v = same(r, b) ? undefined : r; // この端末で消した。向こうで更新されていたら、それは残す
    else v = r === undefined || betterRecord(l, r) ? l : r; // この端末で更新した → 良いほう
    if (v !== undefined) out[key] = copy(v);
  }
  return out;
}

/** base・local・remote（どれも { stats, records }）を合わせた結果。入力は書き換えない */
export function merge3(base, local, remote) {
  const [b, l, r] = [base ?? emptyData(), local ?? emptyData(), remote ?? emptyData()];
  return { stats: mergeStats(b.stats, l.stats, r.stats), records: mergeRecords(b.records, l.records, r.records) };
}

/** 端末の記録（ログインする前のもの）をアカウントの記録に足す：成績は足し算、自己ベストは良いほう */
export const addData = (account, extra) => merge3(emptyData(), extra, account);

/** 答えた回数の合計と、自己ベストの数 */
export function countData(d) {
  let answers = 0;
  for (const m of Object.values(d?.stats ?? {})) for (const s of Object.values(m)) answers += num(s?.n);
  return { answers, bests: Object.keys(d?.records ?? {}).length };
}
export const isEmptyData = (d) => {
  const c = countData(d);
  return c.answers === 0 && c.bests === 0;
};

/**
 * アカウントに置く形。中身は 1 つの文字列にまとめる
 * （成績のキーには記号が入るので、そのまま項目名にしない。項目が増えすぎて索引の上限に当たることも避ける）
 */
export function packCloud(data, now = new Date()) {
  const d = normalizeData(data);
  return { app: CLOUD_APP, v: CLOUD_VERSION, updatedAt: now.toISOString(), json: JSON.stringify(d) };
}

/** アカウントから読んだものを { stats, records } に。無い・壊れているときは空。新しい版の形は読まない（上書きして壊さないため） */
export function unpackCloud(docData) {
  if (!isObj(docData)) return emptyData();
  if (Number.isFinite(docData.v) && docData.v > CLOUD_VERSION) {
    const e = new Error('アカウントの記録は、このアプリの新しい版で保存されています。アプリを更新してください。');
    e.code = 'onpu/newer-data';
    throw e;
  }
  try {
    return normalizeData(JSON.parse(docData.json));
  } catch {
    return emptyData();
  }
}
