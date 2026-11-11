// アカウント：ログインの状態と、記録をアカウントと合わせる段取り
// 釣りすごろくと同じアカウント（Firebase）を使う。ログインしなくても、今までどおり端末の記録で遊べる。
// Firebase の部品は大きいので、画面が出たあとで読み込む（backend.js）。読み込めなくても遊べる。
import {
  activeAccount, useAccount, syncSnapshot, applySync, accountDirty, lastSyncAt, onAccountData,
} from '../core/store.js';
import { toEmail, isGuestEmail, sessionExpired, checkCredentials, authMessage, SESSION_KEY } from '../core/account.js';
import { merge3, packCloud, unpackCloud, sameData } from '../core/sync.js';
import { toast } from '../ui/toast.js';

/**
 * phase:
 *   'checking' … ログインしているか確かめている（最初だけ）
 *   'out'      … ログインしていない（端末の記録）
 *   'guest'    … 釣りすごろくのゲストで入っている（端末の記録。同じ場所で公開したときだけ起きる）
 *   'in'       … ログイン中（アカウントの記録）
 * confirmed: Firebase に確かめたか（false のあいだの 'in' は、前回のログインを覚えているだけ）
 * sync: 'idle' | 'busy' | 'ok' | 'offline' | 'error'
 */
const who = activeAccount();
const state = {
  phase: who ? 'in' : 'checking',
  confirmed: false,
  uid: who?.uid ?? null,
  name: who?.name ?? '',
  busy: false,
  error: '',
  sync: 'idle',
  syncError: '',
  syncAt: lastSyncAt(),
  notice: '',
};
const listeners = new Set();
export const account = () => state;
/** 状態が変わるたびに fn(state)。life を渡すと、画面を離れるときに外れる */
export function onAccount(fn, life) {
  listeners.add(fn);
  life?.signal.addEventListener('abort', () => listeners.delete(fn), { once: true });
}
function set(patch) {
  Object.assign(state, patch);
  for (const fn of [...listeners]) fn(state);
}

// ---- 最後に使った時刻（釣りすごろくと同じキー。24 時間使わないとログアウト） ----
const stamp = {
  get() {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      if (v == null) localStorage.removeItem(SESSION_KEY);
      else localStorage.setItem(SESSION_KEY, String(v));
    } catch {
      /* 保存できない環境 */
    }
  },
};

// ---- Firebase につなぐ部分（テストでは window.__ONPU_ACCOUNT_BACKEND__ に偽物を置ける） ----
let backend = null;
let loading = null;
function loadBackend() {
  loading ||= (async () => {
    const fake = globalThis.__ONPU_ACCOUNT_BACKEND__;
    const b = fake ?? (await import('./backend.js')).createBackend(globalThis.__ONPU_FIREBASE_EMULATOR__);
    backend = b;
    b.onUser(handleUser);
    return b;
  })().catch((e) => {
    loading = null; // 次に使うとき、もう一度読み込みを試す
    throw e;
  });
  return loading;
}

/** 画面が出たあとで呼ぶ。ログインの状態を確かめ、ログイン中なら記録を合わせる */
export function initAccount() {
  const start = () =>
    loadBackend().catch(() => {
      // 読み込めない（つながっていない・初めて開いた）。前回ログインしていたなら、その人の記録のまま遊べる
      if (state.phase === 'checking') set({ phase: 'out' });
      else set({ sync: 'offline' });
    });
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 300);

  onAccountData(() => schedule(4000)); // 答えるたびに呼ばれる。区切りがつくまで待ってから送る
  window.addEventListener('online', () => {
    if (!backend) loadBackend().catch(() => {});
    else schedule(500);
  });
  document.addEventListener('visibilitychange', () => {
    // 戻ってきたとき、ほかの端末で進んだ分を取り込む
    if (document.visibilityState === 'visible' && state.phase === 'in' && Date.now() - (state.syncAt ?? 0) > 60_000) schedule(500);
  });
}

let confirmedUid; // Firebase が最後に知らせた人（同じ知らせが 2 回来ても、合わせ直さない）
function handleUser(user) {
  const uid = user?.uid ?? null;
  if (state.confirmed && uid === confirmedUid) {
    // 同じ人の知らせ。名前だけ変わることがある（登録した直後は、まだ名前が付いていない知らせが先に来る）
    if (user && state.phase === 'in' && user.name && user.name !== state.name) {
      useAccount({ uid, name: user.name });
      set({ name: user.name });
    }
    return;
  }
  confirmedUid = uid;

  if (user && !isGuestEmail(user.email)) {
    if (sessionExpired(stamp.get(), Date.now())) {
      // 24 時間使っていない → ログアウト（釣りすごろくと同じ決まり）。この端末にある分は残り、次にログインしたとき送る
      stamp.set(null);
      backend.signOut().catch(() => {});
      confirmedUid = null;
      useAccount(null);
      set({ phase: 'out', confirmed: true, uid: null, name: '', sync: 'idle', syncAt: null, notice: 'しばらく使っていなかったので、ログアウトしました。' });
      toast('しばらく使っていなかったので、ログアウトしました');
      return;
    }
    stamp.set(Date.now()); // 使っているあいだは延びる
    useAccount({ uid: user.uid, name: user.name });
    set({ phase: 'in', confirmed: true, uid: user.uid, name: user.name, sync: 'idle', syncError: '', syncAt: lastSyncAt(), notice: '' });
    syncNow();
    return;
  }
  useAccount(null);
  set({ phase: user ? 'guest' : 'out', confirmed: true, uid: null, name: '', sync: 'idle', syncError: '', syncAt: null });
}

async function enter(kind, username, password) {
  const bad = checkCredentials(username, password, { register: kind === 'register' });
  if (bad) {
    set({ error: bad });
    return false;
  }
  const name = username.trim();
  const before = stamp.get();
  set({ busy: true, error: '', notice: '' });
  try {
    const b = await loadBackend();
    stamp.set(Date.now()); // ログインの知らせより先に書く（知らせを受けた側が期限切れと見ないように）
    const user = kind === 'register' ? await b.signUp(toEmail(name), password, name) : await b.signIn(toEmail(name), password);
    handleUser(user);
    set({ busy: false });
    return true;
  } catch (e) {
    stamp.set(before); // 失敗したら元に戻す（前から入っていた人を、巻き添えでログアウトさせない）
    set({ busy: false, error: authMessage(e, kind) });
    return false;
  }
}
export const login = (username, password) => enter('login', username, password);
export const register = (username, password) => enter('register', username, password);
export const clearError = () => state.error && set({ error: '' });

/** ログアウト。まだ送っていない記録があれば、先に送ってみる（送れなくても、この端末に残っていて次のログインで送る） */
export async function logout() {
  set({ busy: true, error: '' });
  try {
    // 待つのは 5 秒まで（つながりが悪くても、ログアウトは終わらせる）
    if (accountDirty()) await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 5000))]);
    stamp.set(null);
    await (await loadBackend()).signOut();
    handleUser(null);
  } catch (e) {
    set({ error: authMessage(e, 'login') });
  }
  set({ busy: false });
}

// ---- 記録を合わせる ----
let timer = 0;
let running = null;
let again = false;
function schedule(ms) {
  if (state.phase !== 'in') return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

/** いますぐ合わせる。合わせている最中に呼ばれたら、終わってからもう一度だけやる */
export function syncNow() {
  clearTimeout(timer);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again && state.phase === 'in');
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce() {
  if (state.phase !== 'in' || !state.confirmed || !backend) return;
  const uid = state.uid;
  set({ sync: 'busy' });
  try {
    // 同じブラウザのタブどうしで、同じ増えた分を 2 回送らないように、1 つずつ順番に
    await exclusive(async () => {
      const snap = syncSnapshot();
      if (!snap || snap.uid !== uid) return;
      const merged = await backend.exchange(uid, (docData) => {
        const remote = unpackCloud(docData);
        const next = merge3(snap.base, snap.local, remote);
        return { result: next, write: sameData(next, remote) ? null : packCloud(next) };
      });
      applySync(uid, merged, snap.local);
    });
    if (state.uid === uid) set({ sync: 'ok', syncError: '', syncAt: lastSyncAt() });
  } catch (e) {
    if (state.uid !== uid) return;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    set({ sync: offline ? 'offline' : 'error', syncError: e?.code === 'onpu/newer-data' ? e.message : authMessage(e, 'sync') });
  }
}

function exclusive(fn) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  return locks?.request ? locks.request('onpu-beat-flash.sync', fn) : fn();
}

/** 記録がどこにあるかの一言（記録・このアプリについて の画面で使う） */
export function whereText() {
  if (state.phase === 'in') return `記録は ${state.name} さんのアカウントにあります。`;
  return '記録はこの端末のブラウザの中だけにあります。';
}
