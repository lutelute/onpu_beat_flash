// 設定・成績・記録の保存（ブラウザの localStorage。使えない環境でも動くよう全部 try で包む）
//
// 置き場所は 2 つある：
//   端末の記録   … 設定（どのゲームにも効くもの・ゲームごとのもの）と、ログインしていないときの成績・自己ベスト。
//                   この端末のブラウザの中だけにあり、どこにも送らない。
//   アカウントの記録 … ログインしているあいだの成績・自己ベスト。アカウントごとに別の入れ物に置き、
//                   account/account.js がアカウント（釣りすごろくと同じ Firebase）と合わせる。
//                   つながらないときもこの入れ物に書いておき、つながったら送る。
// 設定はいつも端末のもの（音量・マイク・鍵盤の答え方などは端末ごとに違うので、アカウントには入れない）。
import { sanitizeSettings } from './settings.js';
import { GLOBAL_DEFAULTS, globalFields } from './globals.js';
import { normalizeData, emptyData, merge3, addData, countData, sameData, betterRecord } from './sync.js';

const KEY = 'onpu-beat-flash.v1';
/** いま使っているアカウント { uid, name }。画面を開いた直後（Firebase を読み込む前）から、その人の記録を出すため */
const WHO_KEY = 'onpu-beat-flash.account';
const acctKey = (uid) => `${KEY}.u.${uid}`;
const VERSION = 1;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const blank = () => ({ v: VERSION, global: { ...GLOBAL_DEFAULTS }, gen: {}, mode: {}, ...emptyData() });

/** 読み込んだデータの形を確かめ、使えない部分を捨てる */
function normalize(saved) {
  const db = blank();
  if (!isObj(saved)) return db;
  db.global = sanitizeSettings(saved.global, GLOBAL_DEFAULTS, globalFields);
  for (const k of ['gen', 'mode']) if (isObj(saved[k])) for (const [id, v] of Object.entries(saved[k])) if (isObj(v)) db[k][id] = v;
  return Object.assign(db, normalizeData(saved));
}

/** アカウントの入れ物：いまの中身（stats・records）と、前に合わせたときの中身（base。まだ合わせていなければ null） */
function normalizeAcct(uid, name, saved) {
  const s = isObj(saved) ? saved : {};
  return {
    uid,
    name: name ?? (typeof s.name === 'string' ? s.name : ''),
    ...normalizeData(s),
    base: isObj(s.base) ? normalizeData(s.base) : null,
    at: Number.isFinite(s.at) ? s.at : null,
  };
}

function read(key) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

let db = blank();
let acct = null;
let storageOk = true;
try {
  db = normalize(read(KEY));
} catch {
  // 読めない（壊れている・保存できない環境）。初期の状態で始める
  try {
    localStorage.getItem(KEY);
  } catch {
    storageOk = false;
  }
}
try {
  const who = read(WHO_KEY);
  if (isObj(who) && typeof who.uid === 'string' && who.uid) acct = loadAcct(who.uid, typeof who.name === 'string' ? who.name : '');
} catch {
  /* 読めなければ端末の記録で始める */
}

function loadAcct(uid, name) {
  let saved = null;
  try {
    saved = read(acctKey(uid));
  } catch {
    /* 壊れていたら空から */
  }
  return normalizeAcct(uid, name, saved);
}

let timer = 0;
let dirtyDb = false;
let dirtyAcct = false;
function flush() {
  clearTimeout(timer);
  timer = 0;
  try {
    if (dirtyDb) localStorage.setItem(KEY, JSON.stringify(db));
    if (dirtyAcct && acct) localStorage.setItem(acctKey(acct.uid), JSON.stringify(acct));
  } catch {
    storageOk = false;
  }
  dirtyDb = dirtyAcct = false;
}
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}
const touchDb = () => {
  dirtyDb = true;
  persist();
};
/** 成績・自己ベストが変わった。ログイン中ならアカウントの入れ物、そうでなければ端末の記録 */
const touchData = () => {
  if (acct) {
    dirtyAcct = true;
    persist();
    for (const fn of dataListeners) fn();
  } else touchDb();
};
/** いまの成績・自己ベストの入れ物 */
const cur = () => acct ?? db;

// 閉じる・裏に回るときは待たずに書く
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => timer && flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && timer && flush());
  // 別のタブで書き換わったら取り込む（古いタブが新しい記録を上書きしないように）
  window.addEventListener('storage', (e) => {
    try {
      if (e.key === KEY) {
        db = e.newValue ? normalize(JSON.parse(e.newValue)) : blank();
        dirtyDb = false;
      } else if (acct && e.key === acctKey(acct.uid)) {
        acct = normalizeAcct(acct.uid, acct.name, e.newValue ? JSON.parse(e.newValue) : null);
        dirtyAcct = false;
      }
    } catch {
      /* 読めない値は無視 */
    }
  });
}

/** この端末に保存できているか（プライベートブラウズなどで保存できないと false） */
export const canSave = () => storageOk;

export const globalSettings = () => db.global;
export function setGlobal(patch) {
  db.global = sanitizeSettings({ ...db.global, ...patch }, GLOBAL_DEFAULTS, globalFields);
  touchDb();
}

/** 保存値を設定項目の定義に照らして返す（合わない値は初期値に戻す） */
export function getSettings(bucket, id, defaults, fields) {
  return sanitizeSettings(db[bucket][id], defaults, fields);
}
export function saveSettings(bucket, id, values) {
  db[bucket][id] = { ...values };
  touchDb();
}

// ---- 成績 ----
export function recordAnswer(space, key, { ok, ms, given }) {
  const sp = (cur().stats[space] ||= {});
  const s = (sp[key] ||= { n: 0, ok: 0, ms: 0, msN: 0, conf: {} });
  s.n++;
  if (ok) {
    s.ok++;
    if (ms != null && ms > 0 && ms < 15000) {
      s.ms += ms;
      s.msN++;
    }
  } else if (given != null) {
    s.conf[given] = (s.conf[given] || 0) + 1;
  }
  touchData();
}
export const statsOf = (space) => cur().stats[space] || {};
export function resetStats(space) {
  if (space) delete cur().stats[space];
  else cur().stats = {};
  touchData();
}

/** 苦手ほど大きい重み。まだ出していないものも少し多めに出す */
export function weakWeight(space, key) {
  const s = cur().stats[space]?.[key];
  if (!s || s.n === 0) return 2;
  const err = (s.n - s.ok + 0.5) / (s.n + 1);
  const avg = s.msN ? s.ms / s.msN : null;
  const slow = avg ? Math.min(1.5, Math.max(0, (avg - 900) / 900)) : 0;
  return 1 + 6 * err + slow;
}

// ---- 自己ベスト ----
export const getRecord = (key) => cur().records[key];
/** better(新, 旧) が真なら更新して true を返す。比べ方は core/sync.js の betterRecord（アカウントと合わせるときも同じ比べ方） */
export function offerRecord(key, value, better = betterRecord) {
  const old = cur().records[key];
  if (old == null || better(value, old)) {
    cur().records[key] = value;
    touchData();
    return true;
  }
  return false;
}

// ---- まるごと（このアプリについて の画面） ----
export function exportData() {
  flush();
  const { stats, records } = cur();
  return JSON.stringify({ app: 'onpu-beat-flash', exportedAt: new Date().toISOString(), ...db, stats, records }, null, 1);
}
/** 書き出したデータを読み込む。読めなければ例外。ログイン中は、成績・自己ベストをアカウントの記録に入れる */
export function importData(text) {
  const saved = JSON.parse(text);
  if (!isObj(saved) || saved.app !== 'onpu-beat-flash') throw new Error('このアプリで書き出したデータではありません');
  const next = normalize(saved);
  if (acct) {
    Object.assign(acct, normalizeData(next));
    Object.assign(next, { stats: db.stats, records: db.records }); // 端末の記録（ログイン前のもの）はそのまま
  }
  db = next;
  dirtyDb = true;
  touchData();
  flush();
}
/** 設定と、いま見えている成績・自己ベストを消す（ログイン中はアカウントの記録が消える） */
export function resetAll() {
  const keep = acct ? { stats: db.stats, records: db.records } : null;
  db = Object.assign(blank(), keep);
  if (acct) Object.assign(acct, emptyData());
  dirtyDb = true;
  touchData();
  flush();
}

// ---- アカウント（account/account.js から使う） ----
const dataListeners = new Set();
/** ログイン中に成績・自己ベストが変わるたびに呼ばれる（アカウントへ送るきっかけ） */
export function onAccountData(fn) {
  dataListeners.add(fn);
  return () => dataListeners.delete(fn);
}

/** いま使っているアカウント { uid, name }。ログインしていなければ null */
export const activeAccount = () => (acct ? { uid: acct.uid, name: acct.name } : null);

/** 成績・自己ベストの入れ物を切り替える。user = { uid, name } でそのアカウント、null で端末の記録 */
export function useAccount(user) {
  if ((user?.uid ?? null) === (acct?.uid ?? null)) {
    if (acct && user.name && user.name !== acct.name) {
      acct.name = user.name;
      dirtyAcct = true;
      saveWho();
      flush();
    }
    return;
  }
  flush();
  acct = user ? loadAcct(user.uid, user.name ?? '') : null;
  saveWho();
}
function saveWho() {
  try {
    if (acct) localStorage.setItem(WHO_KEY, JSON.stringify({ uid: acct.uid, name: acct.name }));
    else localStorage.removeItem(WHO_KEY);
  } catch {
    storageOk = false;
  }
}

/** アカウントと合わせる材料：前に合わせたときの中身（base）と、いまの中身（local）の写し */
export function syncSnapshot() {
  if (!acct) return null;
  return { uid: acct.uid, base: acct.base ? normalizeData(acct.base) : emptyData(), local: normalizeData(acct) };
}
/**
 * 合わせた結果を取り込む。合わせているあいだにこの端末で増えた分（いま − sent）は、その上に足す。
 * sent は syncSnapshot() の local。途中でアカウントが替わっていたら何もしない
 */
export function applySync(uid, merged, sent) {
  if (!acct || acct.uid !== uid) return false;
  Object.assign(acct, merge3(sent, normalizeData(acct), merged));
  acct.base = normalizeData(merged);
  acct.at = Date.now();
  dirtyAcct = true;
  flush();
  return true;
}
/** この端末に、まだアカウントへ送っていない記録があるか */
export const accountDirty = () => !!acct && !sameData(normalizeData(acct), acct.base ?? emptyData());
/** 最後にアカウントと合わせた時刻（ms）。まだなら null */
export const lastSyncAt = () => acct?.at ?? null;

/** いま見えている記録の量 { answers, bests }（ログイン中はアカウントの記録） */
export const dataCounts = () => countData(cur());
/** 端末の記録（ログインする前のもの）の量 { answers, bests } */
export const deviceCounts = () => countData(db);
/** 端末の記録をいまのアカウントに足し、端末の記録は空にする（2 回足さないように）。足したら true */
export function moveDeviceToAccount() {
  if (!acct) return false;
  Object.assign(acct, addData(normalizeData(acct), normalizeData(db)));
  Object.assign(db, emptyData());
  dirtyDb = true;
  touchData();
  flush();
  return true;
}
