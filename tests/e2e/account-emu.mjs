// 本物の Firebase の部品（src/account/backend.js）を、手元のエミュレータ（Auth・Firestore）につないで確かめる
//   npm run e2e:emu   （初回は firebase-tools とエミュレータを取ってくる。Java が要る）
// 見るもの：
//   - 釣りすごろくと同じ形（小文字のユーザー名 + @tsuri.local）で登録・ログインできる
//   - 釣りすごろくの firestore.rules（emu/firestore.rules に写し）のもとで、このアプリの記録が読み書きできる
//   - 2 台が同時に送っても、どちらの分も残る（Firestore のトランザクション）
// 本番の Firebase には出ない：プロジェクトは demo- で始まる名前（エミュレータ専用）にし、
// ブラウザは localhost 以外の名前を引けないようにして、それでも外へ出ようとした通信があれば失敗にする。
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));
if (!CHROME) {
  console.error('Chrome が見つかりません。CHROME=/path/to/chrome を指定してください');
  process.exit(2);
}

const PROJECT = 'demo-tsuri-sugoroku';
const AUTH = 'http://127.0.0.1:9099';
const FS = 'http://127.0.0.1:8080';
const EMU = { auth: AUTH, firestore: ['127.0.0.1', 8080], projectId: PROJECT };
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
const KEY = 'onpu-beat-flash.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// エミュレータが動いているか（npm run e2e:emu から起動される）
try {
  await fetch(`${AUTH}/`);
  await fetch(`${FS}/`);
} catch {
  console.error('Firebase のエミュレータにつながりません。「npm run e2e:emu」で走らせてください（Auth 9099・Firestore 8080）');
  process.exit(2);
}
// 前の実行の残りを消す
await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

await build({ logLevel: 'error' });
const server = await preview({ preview: { port: 5320, strictPort: true }, logLevel: 'error' });
const BASE = 'http://localhost:5320/';
const ALLOWED = [BASE, `${AUTH}/`, `${FS}/`];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !process.env.HEADFUL,
  args: [
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=420,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', // 外の名前は引けない
  ],
  defaultViewport: { width: 400, height: 860, deviceScaleFactor: 1, hasTouch: false },
});

const results = [];
const leaks = []; // localhost 以外へ出ようとした通信
const pageErrors = [];

/** 新しい端末（保存もログインの状態も別のブラウザ） */
async function device() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument((emu) => {
    window.__ONPU_FIREBASE_EMULATOR__ = emu;
  }, EMU);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (ALLOWED.some((a) => u.startsWith(a)) || /^(data|blob|about):/.test(u)) return req.continue();
    leaks.push(u);
    return req.abort();
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const d = {
    page,
    close: () => ctx.close(),
    text: (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null),
    has: async (sel) => (await page.$(sel)) != null,
    async go(hash) {
      await sleep(300);
      await page.goto('about:blank');
      await page.goto(`${BASE}${hash}`, { waitUntil: 'load' });
    },
    loggedIn: () => d.has('a.iconbtn.acct[data-on]'),
    tone: () => page.$eval('.acct-status', (e) => e.dataset.tone).catch(() => null),
    synced: () => waitFor(async () => (await d.tone()) === 'ok'),
    shown: async () => Number(/答えた回数 (\d+)/.exec((await d.text('main .card .field-note')) ?? '')?.[1] ?? NaN),
    async fill(name, pass) {
      await page.$eval('.acct-form input[name=username]', (e) => (e.value = ''));
      await page.$eval('.acct-form input[name=password]', (e) => (e.value = ''));
      await page.type('.acct-form input[name=username]', name);
      await page.type('.acct-form input[name=password]', pass);
    },
    submit: () => page.click('.acct-form button[type=submit]'),
    async signIn(name, pass) {
      await d.go('#/account');
      expect(await waitFor(() => d.has('.acct-form')), 'ログインの入力欄が出ない');
      await d.fill(name, pass);
      await d.submit();
      expect(await waitFor(d.loggedIn), `ログイン中にならない: ${await d.text('.notice.bad')}`);
      expect(await d.synced(), `記録が合わない: ${await d.text('.acct-status')} ${await d.text('.notice.bad')}`);
    },
    /** この端末の（ログインする前の）記録を置く */
    seed: (stats, records = {}) => page.evaluate((k, v) => localStorage.setItem(k, JSON.stringify(v)), KEY,
      { global: {}, gen: {}, mode: {}, stats, records }),
    /** 「アカウントに足す」を 2 回押す */
    async add() {
      const btn = 'main section.card:nth-of-type(2) .btn';
      await page.click(btn);
      await page.click(btn);
    },
    sync: () => page.click('main .card .actions .btn'),
  };
  return d;
}

async function waitFor(fn, ms = 15000, step = 50) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function scenario(name, fn) {
  const t = Date.now();
  const before = pageErrors.length;
  try {
    await Promise.race([fn(), sleep(90000).then(() => { throw new Error('90 秒たっても終わらない'); })]);
    if (pageErrors.length > before) throw new Error(pageErrors.slice(before).join('\n'));
    if (leaks.length) throw new Error(`localhost の外へ出ようとした: ${leaks.join(', ')}`);
    results.push([name, true]);
    console.log(`✔ ${name}（${((Date.now() - t) / 1000).toFixed(1)}秒）`);
  } catch (e) {
    results.push([name, false]);
    console.log(`✖ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`);
  }
}

// ---- エミュレータを直接見る ----
const plain = (v) =>
  'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)])) : null;
/** ルールを通さずに読む（管理者として）。無ければ null */
async function readDoc(path, { asGuest = false } = {}) {
  const res = await fetch(`${DOCS}/${path}`, asGuest ? {} : { headers: { Authorization: 'Bearer owner' } });
  if (asGuest) return res.status;
  if (res.status === 404) return null;
  const body = await res.json();
  return Object.fromEntries(Object.entries(body.fields ?? {}).map(([k, v]) => [k, plain(v)]));
}
const cloudData = async (uid) => JSON.parse((await readDoc(`users/${uid}/data/onpuBeatFlash`))?.json ?? '{"stats":{},"records":{}}');
const answers = (d) => Object.values(d.stats).flatMap((m) => Object.values(m)).reduce((t, s) => t + s.n, 0);
/** 釣りすごろくがログインするときと同じ呼び出し（メールアドレスとパスワード） */
async function restSignIn(email, password) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) return null;
  const me = await res.json();
  // 表示名は、ログインの返事ではなくアカウントの情報のほうにある
  const info = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: me.idToken }),
  }).then((r) => r.json());
  return { ...me, displayName: info.users?.[0]?.displayName };
}
const stat = (n, ok, ms = 0, msN = 0, conf = {}) => ({ n, ok, ms, msN, conf });

// ------------------------------------------------------------
const A = await device();
let uid = null;

await scenario('アカウントを作る：釣りすごろくと同じ形で登録され、向こうの「ユーザーを探す」用の名前も書かれる', async () => {
  await A.go('#/account');
  expect(await waitFor(() => A.has('.acct-form')), '入力欄が出ない');
  await A.page.click('.acct-form .linkbtn');
  await A.fill('EmuTaro', 'secret1');
  await A.submit();
  expect(await waitFor(A.loggedIn), `ログイン中にならない: ${await A.text('.notice.bad')}`);
  expect(await waitFor(async () => (await A.text('main h2')) === 'EmuTaro さんログイン中'), `見出し ${await A.text('main h2')}`);
  expect(await A.synced(), `記録が合わない: ${await A.text('.acct-status')}`);
  // 釣りすごろくと同じ呼び出しで入れる（= 向こうでも同じユーザー名・パスワードで入れる）
  const me = await restSignIn('emutaro@tsuri.local', 'secret1');
  expect(me?.localId, '小文字のユーザー名 + @tsuri.local で登録されていない');
  uid = me.localId;
  expect(me.displayName === 'EmuTaro', `表示名 ${me.displayName}`);
  const name = await readDoc('usernames/emutaro');
  expect(name?.uid === uid && name.displayName === 'EmuTaro', `usernames: ${JSON.stringify(name)}`);
  const prof = await readDoc(`profiles/${uid}`);
  expect(prof?.displayNameLower === 'emutaro' && prof.uid === uid, `profiles: ${JSON.stringify(prof)}`);
  expect((await readDoc(`users/${uid}/data/profile`))?.displayName === 'EmuTaro', 'users/…/profile が無い');
  expect((await readDoc(`users/${uid}/data/onpuBeatFlash`)) == null, '記録が無いのに書き込んだ');
});

await scenario('記録がアカウント（Firestore）に書かれる。読み込み直してもログイン中', async () => {
  await A.seed({ 'ear:pitch': { C: stat(4, 3, 2400, 3, { D: 1 }), 'F♯': stat(2, 2, 900, 2) } }, { 'battle|x/y.z': 1200 });
  await A.go('#/account');
  expect(await waitFor(A.loggedIn), '読み込み直したらログアウトしていた');
  expect(await A.synced(), '記録が合わない');
  await A.add();
  expect(await waitFor(async () => answers(await cloudData(uid)) === 6), `Firestore に書かれない: ${JSON.stringify(await readDoc(`users/${uid}/data/onpuBeatFlash`))}`);
  const doc = await readDoc(`users/${uid}/data/onpuBeatFlash`);
  expect(doc.app === 'onpu-beat-flash' && doc.v === 1 && typeof doc.updatedAt === 'string', `置いた形: ${JSON.stringify(doc)}`);
  const d = await cloudData(uid);
  expect(d.records['battle|x/y.z'] === 1200 && d.stats['ear:pitch']['F♯'].n === 2, '記号の入ったキーが保てていない');
});

await scenario('釣りすごろくのルール：ログインしていないと記録は読めない（ユーザー名の一覧は読める）', async () => {
  expect((await readDoc(`users/${uid}/data/onpuBeatFlash`, { asGuest: true })) === 403, 'ログインしていないのに記録が読めた（ルールが効いていない）');
  expect((await readDoc('usernames/emutaro', { asGuest: true })) === 200, 'ユーザー名が読めない');
});

const B = await device();
await scenario('別の端末でログインすると、アカウントの記録が出る', async () => {
  await B.signIn('emutaro', 'secret1'); // 小文字でも同じアカウント
  expect((await B.text('main h2')) === 'EmuTaro さんログイン中', `見出し ${await B.text('main h2')}`);
  expect(await waitFor(async () => (await B.shown()) === 6), `記録が来ない: ${await B.shown()}`);
});

await scenario('2 台で別々に練習し、同時に送っても、どちらの分も残る', async () => {
  // A は 3 回、B は 5 回ぶんを、それぞれの端末でためてある（まだ送っていない）
  const bump = (d, key, n) => d.page.evaluate((k, key, n) => {
    const a = JSON.parse(localStorage.getItem(k));
    a.stats['ear:pitch'][key] = { n, ok: n, ms: 300 * n, msN: n, conf: {} };
    localStorage.setItem(k, JSON.stringify(a));
  }, `${KEY}.u.${uid}`, key, n);
  await bump(A, 'A', 3);
  await bump(B, 'B', 5);
  // 読み込み直して（ためた分を持った状態で）同時に開く → どちらも開いた直後に送る
  await Promise.all([A.go('#/account'), B.go('#/account')]);
  expect((await A.synced()) && (await B.synced()), `合わない: A=${await A.text('.acct-status')} B=${await B.text('.acct-status')}`);
  expect(await waitFor(async () => answers(await cloudData(uid)) === 14), `アカウントの合計 ${answers(await cloudData(uid))}（6 + 3 + 5 = 14 のはず）`);
  // 先に送ったほうは、もう一度合わせると相手の分が来る
  await A.sync();
  await B.sync();
  expect(await waitFor(async () => (await A.shown()) === 14 && (await B.shown()) === 14), `A=${await A.shown()} B=${await B.shown()}`);
  expect(answers(await cloudData(uid)) === 14, '合わせ直したら増えた');
});

await scenario('パスワードが違うと入れない。同じ名前では作れない', async () => {
  const C = await device();
  await C.go('#/account');
  expect(await waitFor(() => C.has('.acct-form')), '入力欄が出ない');
  await C.fill('EmuTaro', 'wrong-pass');
  await C.submit();
  expect(await waitFor(async () => /ユーザー名かパスワードが違います/.test((await C.text('.notice.bad')) ?? '')), `出た文: ${await C.text('.notice.bad')}`);
  await C.fill('nobody', 'secret1');
  await C.submit();
  expect(await waitFor(async () => /ユーザー名かパスワードが違います/.test((await C.text('.notice.bad')) ?? '')), `出た文: ${await C.text('.notice.bad')}`);
  await C.page.click('.acct-form .linkbtn');
  await C.fill('emutaro', 'secret2');
  await C.submit();
  expect(await waitFor(async () => /もう使われています/.test((await C.text('.notice.bad')) ?? '')), `出た文: ${await C.text('.notice.bad')}`);
  expect(!(await C.loggedIn()), '入れてしまった');
  await C.close();
});

await scenario('釣りすごろくで作ったアカウントで、そのまま入れる', async () => {
  // 釣りすごろくの登録と同じ呼び出し：メールアドレスで作り、表示名を付ける
  const post = (path, body) => fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=x`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  const made = await post('accounts:signUp', { email: 'fishman@tsuri.local', password: 'tsuri-pass', returnSecureToken: true });
  await post('accounts:update', { idToken: made.idToken, displayName: 'FishMan', returnSecureToken: true });
  const C = await device();
  await C.signIn('FISHMAN', 'tsuri-pass');
  expect((await C.text('main h2')) === 'FishMan さんログイン中', `見出し ${await C.text('main h2')}`);
  expect((await C.shown()) === 0, '別の人の記録が見えている');
  await C.close();
});

await scenario('釣りすごろくの側でログインした状態（このアプリの印は無い）でも、開くとログイン中になる', async () => {
  // 同じ場所（同じオリジン）で公開すると、Firebase が覚えているログインの状態と「最後に使った時刻」を両方のゲームが共有する。
  // 釣りすごろくでログインした直後と同じ状態を作る：このアプリの印と記録の写しを消し、Firebase の保存と時刻だけ残す
  await B.go('#/account');
  expect(await B.synced(), '合わない');
  await sleep(300);
  await B.page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('onpu-beat-flash')) localStorage.removeItem(k);
  });
  await B.go('#/');
  expect(await waitFor(B.loggedIn), 'Firebase が覚えているログインを使っていない');
  expect(await waitFor(async () => /EmuTaro さんでログイン中/.test((await B.text('a.gamecard[href="#/account"] .gc-l')) ?? '')), 'ホームの札がログイン中にならない');
  await B.go('#/account');
  expect(await B.synced(), '合わない');
  expect(await waitFor(async () => (await B.shown()) === 14), `記録が来ない: ${await B.shown()}`);
  // 釣りすごろくの側で 24 時間たっていた（時刻が古い）なら、こちらでもログアウトになる
  await B.page.evaluate(() => localStorage.setItem('tsuri_session_at', String(Date.now() - 25 * 60 * 60 * 1000)));
  await B.go('#/account');
  expect(await waitFor(() => B.has('.acct-form')), '期限が切れているのにログイン中');
  await B.go('#/account');
  await sleep(500);
  expect(!(await B.loggedIn()), 'Firebase の側のログインが残っている');
});

await scenario('ログアウトすると、読み込み直してもログアウトのまま。記録はアカウントに残る', async () => {
  await A.go('#/account');
  expect(await A.synced(), '合わない');
  await A.page.click('main .card .actions .btn.ghost');
  expect(await waitFor(() => A.has('.acct-form')), 'ログインの画面に戻らない');
  await A.go('#/account');
  expect(await waitFor(() => A.has('.acct-form')), '読み込み直したらログインしていた');
  await sleep(500);
  expect(!(await A.loggedIn()), '印が残っている');
  expect(answers(await cloudData(uid)) === 14, 'アカウントの記録が変わった');
});

// ------------------------------------------------------------
await browser.close();
await server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} / ${results.length} 通過`);
process.exit(failed ? 1 : 0);
