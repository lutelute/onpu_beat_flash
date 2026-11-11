// アカウントの通しの確認（本番と同じビルドをブラウザで動かす）
//   npm run e2e:account            画面を出さずに走らせる
//   HEADFUL=1 npm run e2e:account  画面を出して走らせる
// Firebase にはつながない。window.__ONPU_ACCOUNT_BACKEND__ に偽物を置き、アカウントの中身は localStorage の
// 「__fake_cloud__」に持たせる（読み込み直しても残る。アプリのキーだけ消せば「別の端末」になる）。
// 本物の Firebase につなぐ部分（src/account/backend.js）は、tests/e2e/account-emu.mjs がエミュレータで確かめる。
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

const KEY = 'onpu-beat-flash.v1';
const WHO = 'onpu-beat-flash.account';
const SESSION = 'tsuri_session_at';
const CLOUD = '__fake_cloud__';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await build({ logLevel: 'error' });
const server = await preview({ preview: { port: 5319, strictPort: true }, logLevel: 'error' });
const BASE = 'http://localhost:5319/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !process.env.HEADFUL,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=420,900'],
  defaultViewport: { width: 400, height: 860, deviceScaleFactor: 1, hasTouch: false },
});

const results = [];
const errors = [];
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

// 偽のアカウント（Firebase の代わり）。本物と同じ約束（src/account/backend.js）で動く
await page.evaluateOnNewDocument((CLOUD) => {
  const load = () => JSON.parse(localStorage.getItem(CLOUD) || '{"users":{},"docs":{},"current":null,"fail":null,"hang":false,"writes":0}');
  const save = (c) => localStorage.setItem(CLOUD, JSON.stringify(c));
  const err = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });
  const listeners = new Set();
  const pick = (c) => {
    const u = Object.values(c.users).find((x) => x.uid === c.current);
    return u ? { uid: u.uid, email: u.email, name: u.name } : null;
  };
  const tell = (u = pick(load())) => {
    for (const fn of listeners) fn(u);
  };
  window.__ONPU_ACCOUNT_BACKEND__ = {
    onUser(fn) {
      listeners.add(fn);
      if (!load().hang) setTimeout(() => fn(pick(load())), 30); // hang: いつまでも確かめ終わらない（つながらないとき）
      return () => listeners.delete(fn);
    },
    async signIn(email, password) {
      const c = load();
      if (c.fail) throw err('auth/network-request-failed');
      const u = c.users[email];
      if (!u || u.password !== password) throw err('auth/invalid-credential');
      c.current = u.uid;
      save(c);
      tell();
      return pick(c);
    },
    async signUp(email, password, name) {
      const c = load();
      if (c.fail) throw err('auth/network-request-failed');
      if (c.users[email]) throw err('auth/email-already-in-use');
      const uid = `u${Object.keys(c.users).length + 1}`;
      c.users[email] = { uid, email, password, name };
      c.current = uid;
      save(c);
      tell({ uid, email, name: email.split('@')[0] }); // 本物と同じく、名前が付く前の知らせが先に来る
      return pick(c);
    },
    async signOut() {
      const c = load();
      c.current = null;
      save(c);
      tell();
    },
    async exchange(uid, fn) {
      await new Promise((r) => setTimeout(r, 40));
      const c = load();
      if (c.fail) throw err('unavailable');
      if (c.current !== uid) throw err('permission-denied');
      const out = fn(c.docs[uid] ?? null);
      if (out.write) {
        c.docs[uid] = out.write;
        c.writes++;
        save(c);
      }
      return out.result;
    },
  };
}, CLOUD);

// ---- 小道具 ----
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
  const before = errors.length;
  const t = Date.now();
  try {
    await Promise.race([fn(), sleep(90000).then(() => { throw new Error('90 秒たっても終わらない'); })]);
    const newErr = errors.slice(before);
    if (newErr.length) throw new Error(newErr.join('\n'));
    results.push([name, true]);
    console.log(`✔ ${name}（${((Date.now() - t) / 1000).toFixed(1)}秒）`);
  } catch (e) {
    results.push([name, false]);
    // 画面の側で起きたエラーも一緒に出す（期待が外れた原因であることが多い）
    const also = errors.slice(before).filter((x) => !String(e.message).includes(x));
    console.log(`✖ ${name}\n    ${[String(e.message), ...also].join('\n').split('\n').join('\n    ')}`);
  }
}
const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
const count = (sel) => page.$$eval(sel, (es) => es.length);
const has = async (sel) => (await page.$(sel)) != null;
const ls = (k) => page.evaluate((key) => localStorage.getItem(key), k);
const lsJSON = async (k) => JSON.parse((await ls(k)) ?? 'null');
const setLS = (k, v) => page.evaluate((key, val) => (val == null ? localStorage.removeItem(key) : localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val))), k, v);
const cloud = () => lsJSON(CLOUD);
const patchCloud = async (fn) => setLS(CLOUD, fn((await cloud()) ?? { users: {}, docs: {}, current: null, fail: null, hang: false, writes: 0 }));
const cloudData = async (uid) => JSON.parse((await cloud())?.docs?.[uid]?.json ?? '{"stats":{},"records":{}}');
const answers = (d) => Object.values(d.stats).flatMap((m) => Object.values(m)).reduce((t, s) => t + s.n, 0);

/** ページを開く（必ず 1 回だけ読み込み直す）。pending の書き込みが終わるのを少し待ってから */
async function go(hash) {
  await sleep(300);
  await page.goto('about:blank');
  await page.goto(`${BASE}${hash}`, { waitUntil: 'load' });
}
/** 何も無い端末にする（アカウントの中身は残す）。fresh = アカウントの側も空に */
async function device({ fresh = false } = {}) {
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(400);
  await page.evaluate((CLOUD, fresh) => {
    for (const k of Object.keys(localStorage)) if (k !== CLOUD || fresh) localStorage.removeItem(k);
    const c = JSON.parse(localStorage.getItem(CLOUD) ?? 'null');
    if (c) localStorage.setItem(CLOUD, JSON.stringify({ ...c, current: null, fail: null, hang: false }));
  }, CLOUD, fresh);
}
const stat = (n, ok, ms = 0, msN = 0, conf = {}) => ({ n, ok, ms, msN, conf });
const store = (patch = {}) => ({ global: { naming: 'doremi', sound: true, keyHints: true, volume: 0.7 }, gen: {}, mode: {}, stats: {}, records: {}, ...patch });

const loggedIn = () => has('a.iconbtn.acct[data-on]');
const tone = () => page.$eval('.acct-status', (e) => e.dataset.tone).catch(() => null);
const synced = () => waitFor(async () => (await tone()) === 'ok');
const shownAnswers = async () => Number(/答えた回数 (\d+)/.exec((await text('main .card .field-note')) ?? '')?.[1] ?? NaN);
async function fill(name, pass) {
  expect(await waitFor(() => has('.acct-form')), 'ログインの入力欄が出ない');
  await page.$eval('.acct-form input[name=username]', (e) => (e.value = ''));
  await page.$eval('.acct-form input[name=password]', (e) => (e.value = ''));
  if (name) await page.type('.acct-form input[name=username]', name);
  if (pass) await page.type('.acct-form input[name=password]', pass);
}
const submit = () => page.click('.acct-form button[type=submit]');
async function signIn(name, pass) {
  await go('#/account');
  expect(await waitFor(() => has('.acct-form')), 'ログインの入力欄が出ない');
  await fill(name, pass);
  await submit();
  expect(await waitFor(loggedIn), 'ログイン中にならない');
}

// ------------------------------------------------------------
await scenario('ログインしていないときは、今までどおり端末の記録で遊べる', async () => {
  await device({ fresh: true });
  await setLS(KEY, store({ stats: { 'ear:pitch': { C: stat(4, 3, 2400, 3, { D: 1 }) } } }));
  await go('#/');
  expect((await count('a.gamecard')) >= 8, `札の数 ${await count('a.gamecard')}`);
  expect(await waitFor(async () => /ログインすると/.test((await text('a.gamecard[href="#/account"] .gc-l')) ?? '')), 'アカウントの札の説明が違う');
  expect(!(await loggedIn()), 'ログインしていないのに印が付いている');
  expect((await page.$eval('a.iconbtn.acct', (e) => e.getAttribute('aria-label'))) === 'アカウント（ログインしていません）', '読み上げの名前が違う');
  await go('#/stats');
  expect(/この端末のブラウザの中だけ/.test((await text('main .lead')) ?? ''), '記録の置き場所の説明が違う');
  expect((await ls(WHO)) == null, 'アカウントの印が残っている');
  await go('#/about');
  expect(/どこにも送りません/.test((await text('main')) ?? ''), 'このアプリについての説明が違う');
});

await scenario('アカウントを作る → ログイン中になる（名前は入れたとおりの大文字・小文字）', async () => {
  await device({ fresh: true });
  await go('#/account');
  expect(await waitFor(() => has('.acct-form')), '入力欄が出ない');
  expect((await text('main h2')) === 'ログイン', `見出し ${await text('main h2')}`);
  await page.click('.acct-form .linkbtn');
  expect((await text('main h2')) === 'アカウントを作る', '登録の画面に替わらない');
  // 短いパスワードは、送る前に止める
  await fill('Taro', '12345');
  await submit();
  expect(await waitFor(async () => /6 文字以上/.test((await text('.notice.bad')) ?? '')), '短いパスワードの注意が出ない');
  expect((await page.$eval('.acct-form input[name=username]', (e) => e.value)) === 'Taro', '入れた文字が消えた');
  await fill('Taro', 'secret1');
  await submit();
  expect(await waitFor(loggedIn), 'ログイン中にならない');
  expect(await waitFor(async () => (await text('main h2')) === 'Taro さんログイン中'), `見出し ${await text('main h2')}`);
  expect(await synced(), '「アカウントと合っています」にならない');
  const c = await cloud();
  expect(c.users['taro@tsuri.local']?.name === 'Taro', '釣りすごろくと同じ形（小文字 + @tsuri.local）で登録されていない');
  expect((await lsJSON(WHO))?.name === 'Taro', 'アカウントの印に名前が無い');
  expect(Date.now() - Number(await ls(SESSION)) < 60000, '最後に使った時刻が書かれていない');
  expect(c.writes === 0, '記録が無いのに、アカウントに書き込んだ');
  // ホームの札と、右上の印
  await go('#/');
  expect(await waitFor(async () => /Taro さんでログイン中/.test((await text('a.gamecard[href="#/account"] .gc-l')) ?? '')), 'ホームの札がログイン中にならない');
  expect((await page.$eval('a.iconbtn.acct', (e) => e.getAttribute('aria-label'))) === 'アカウント（Taro さんでログイン中）', '読み上げの名前が違う');
});

await scenario('同じ名前では作れない。パスワードが違うと入れない（入れた文字は残る）', async () => {
  await device();
  await go('#/account');
  expect(await waitFor(() => has('.acct-form')), '入力欄が出ない');
  await page.click('.acct-form .linkbtn');
  await fill('taro', 'another1');
  await submit();
  expect(await waitFor(async () => /もう使われています/.test((await text('.notice.bad')) ?? '')), '「もう使われています」が出ない');
  await page.click('.acct-form .linkbtn'); // ログインに戻る
  expect((await page.$eval('.notice.bad', (e) => e.hidden)) === true, '前の注意が残っている');
  await fill('Taro', 'wrong-pass');
  await submit();
  expect(await waitFor(async () => /ユーザー名かパスワードが違います/.test((await text('.notice.bad')) ?? '')), '間違いの注意が出ない');
  expect(!(await loggedIn()), '間違ったパスワードで入れた');
  expect((await page.$eval('.acct-form input[name=username]', (e) => e.value)) === 'Taro', '入れた文字が消えた');
  expect((await ls(SESSION)) == null && (await ls(WHO)) == null, '失敗したのに印が残っている');
});

await scenario('端末の記録は、ログインしても勝手に混ざらない。「アカウントに足す」で移る', async () => {
  await device();
  await setLS(KEY, store({
    stats: { 'ear:pitch': { C: stat(4, 3, 2400, 3, { D: 1 }), E: stat(2, 2, 900, 2) } },
    records: { 'battle|x': 1200 },
  }));
  await signIn('taro', 'secret1'); // 小文字で入れても同じアカウント
  expect(await synced(), '合わない');
  expect((await shownAnswers()) === 0, `アカウントの記録が空でない: ${await shownAnswers()}`);
  const dev = 'main section.card:nth-of-type(2)';
  expect(/答えた回数 6・自己ベスト 1 件/.test((await text(`${dev} p`)) ?? ''), `端末の記録の数が違う: ${await text(`${dev} p`)}`);
  await page.click(`${dev} .btn`);
  expect(/もう一度押すと/.test((await text(`${dev} .btn`)) ?? ''), '確認が出ない');
  expect((await shownAnswers()) === 0, '1 回押しただけで足された');
  await page.click(`${dev} .btn`);
  expect(await waitFor(async () => (await shownAnswers()) === 6), `足されない: ${await shownAnswers()}`);
  expect(await waitFor(async () => (await page.$eval(dev, (e) => e.hidden)) === true), '端末の記録の札が消えない');
  expect(await waitFor(async () => answers(await cloudData('u1')) === 6), 'アカウントに送られない');
  expect((await cloudData('u1')).records['battle|x'] === 1200, '自己ベストが送られない');
  await sleep(300);
  const left = await lsJSON(KEY);
  expect(Object.keys(left.stats).length === 0 && Object.keys(left.records).length === 0, '端末の記録が空になっていない（2 回足せてしまう）');
  expect(left.global.naming === 'doremi', '端末の設定まで消えた');
});

await scenario('ログイン中に遊ぶと、その記録がアカウントに送られる', async () => {
  const before = answers(await cloudData('u1'));
  await setLS(KEY, { ...(await lsJSON(KEY)), mode: { flash: { style: 'free', count: 4, ms: 150, startLevel: '0', flashSound: true } } });
  await go('#/game/flash');
  expect(await waitFor(loggedIn), 'ログイン中でない');
  await page.click('.actions.sticky .btn.primary');
  expect(await waitFor(async () => (await count('.pad .key')) === 7 && !(await has('.below.waiting'))), '答えのボタンが出ない');
  for (const k of ['c', 'd', 'e', 'f']) await page.keyboard.press(k);
  expect(await waitFor(async () => (await count('.qcard')) === 4), '結果が出ない');
  expect(await waitFor(async () => answers(await cloudData('u1')) === before + 4, 12000), `アカウントに送られない: ${answers(await cloudData('u1'))}`);
  const local = await lsJSON(KEY);
  expect(Object.keys(local.stats).length === 0, 'ログイン中の記録が、端末の記録に入った');
  expect((await cloud()).docs.u1.app === 'onpu-beat-flash' && typeof (await cloud()).docs.u1.json === 'string', 'アカウントに置く形が違う');
});

await scenario('別の端末でログインすると、アカウントの記録が出る', async () => {
  const total = answers(await cloudData('u1'));
  const writes = (await cloud()).writes;
  await device();
  await go('#/stats');
  expect(await waitFor(async () => /まだ記録がありません/.test((await text('main')) ?? '')), '何も無い端末なのに記録がある');
  await signIn('Taro', 'secret1');
  expect(await synced(), '合わない');
  expect(await waitFor(async () => (await shownAnswers()) === total), `記録が来ない: ${await shownAnswers()} / ${total}`);
  expect(!(await has('main section.card:nth-of-type(2):not([hidden]) .btn')) || (await page.$eval('main section.card:nth-of-type(2)', (e) => e.hidden)), '端末の記録が無いのに「足す」が出ている');
  expect((await cloud()).writes === writes, '読んだだけなのに、アカウントに書き込んだ');
  await go('#/stats');
  expect(await waitFor(async () => (await count('main section.card')) >= 1 && !/まだ記録がありません/.test((await text('main')) ?? '')), '記録の画面に出ない');
  expect(/Taro さんのアカウントにあります/.test((await text('main .lead')) ?? ''), '記録の置き場所の説明が違う');
  await go('#/about');
  expect(/Taro さんでログイン中です/.test((await text('main')) ?? ''), 'このアプリについての説明が違う');
});

await scenario('ほかの端末で進んだ分と、この端末の分が合計される', async () => {
  await go('#/account');
  expect(await synced(), '合わない');
  const total = await shownAnswers();
  // ほかの端末が、アカウントの記録を 7 回ぶん進めた
  await patchCloud((c) => {
    const d = JSON.parse(c.docs.u1.json);
    d.stats['ear:pitch'].C.n += 5;
    d.stats['ear:pitch'].C.ok += 5;
    d.stats['ear:pitch'].G = { n: 2, ok: 1, ms: 500, msN: 1, conf: { A: 1 } };
    d.records['battle|x'] = 3000;
    return { ...c, docs: { ...c.docs, u1: { ...c.docs.u1, json: JSON.stringify(d) } } };
  });
  // この端末では、つながらないあいだに成績を 1 つ消した（ear:pitch の E は 2 回ぶん）
  await patchCloud((c) => ({ ...c, fail: 'network' }));
  await page.evaluate((k) => {
    const a = JSON.parse(localStorage.getItem(k));
    delete a.stats['ear:pitch'].E;
    a.records['battle|x'] = 2000;
    a.records['kentei|y'] = 3;
    localStorage.setItem(k, JSON.stringify(a));
  }, `${KEY}.u.u1`);
  await go('#/account');
  expect(await waitFor(async () => (await tone()) === 'bad'), 'つながらないのに、つながらない表示にならない');
  expect(/つながっていません|合わせられませんでした/.test((await text('.acct-status')) ?? ''), `表示: ${await text('.acct-status')}`);
  expect((await shownAnswers()) === total - 2, 'つながらないあいだも、この端末の記録で遊べるはず');
  // つながった
  await patchCloud((c) => ({ ...c, fail: null }));
  await page.click('main .card .actions .btn');
  expect(await synced(), 'つながっても合わない');
  expect(await waitFor(async () => (await shownAnswers()) === total + 7 - 2), `合計が違う: ${await shownAnswers()}（${total} + 7 − 2 のはず）`);
  const d = await cloudData('u1');
  expect(answers(d) === total + 5, 'アカウントの側の合計が違う');
  expect(!d.stats['ear:pitch'].E && d.stats['ear:pitch'].G.n === 2, '消した分・増えた分が合っていない');
  expect(d.records['battle|x'] === 3000 && d.records['kentei|y'] === 3, `自己ベストが良いほうになっていない: ${JSON.stringify(d.records)}`);
  // もう一度合わせても増えない
  const writes = (await cloud()).writes;
  await page.click('main .card .actions .btn');
  await sleep(600);
  expect(await synced(), '2 回目が合わない');
  expect((await cloud()).writes === writes && answers(await cloudData('u1')) === total + 5, '2 回目で増えた・書き込んだ');
});

await scenario('開いた直後（まだ確かめ終わっていないとき）から、その人の記録が出る', async () => {
  const total = answers(await cloudData('u1'));
  await patchCloud((c) => ({ ...c, hang: true }));
  await go('#/account');
  expect(await loggedIn(), '前回ログインしていた人の印が出ない');
  expect((await text('main h2')) === 'Taro さんログイン中', `見出し ${await text('main h2')}`);
  expect(/ログインを確かめています/.test((await text('.acct-status')) ?? ''), `表示: ${await text('.acct-status')}`);
  expect((await shownAnswers()) === total, '記録が出ない');
  expect((await page.$eval('main .card .actions .btn', (e) => e.disabled)) === true, '確かめ終わる前に「いま合わせる」が押せる');
  await patchCloud((c) => ({ ...c, hang: false }));
});

await scenario('初めて開いて確かめているあいだは、ログインの入力欄を出さない（8 秒たっても分からなければ出す）', async () => {
  await device();
  await patchCloud((c) => ({ ...c, hang: true }));
  await go('#/account');
  expect(await waitFor(async () => /ログインしているか確かめています/.test((await text('main .acct-status')) ?? '')), `確かめている表示が出ない: ${await text('main')}`);
  expect(!(await has('.acct-form')), '確かめ終わる前に入力欄が出た');
  expect(await waitFor(() => has('.acct-form'), 12000), '8 秒たっても入力欄が出ない');
  await patchCloud((c) => ({ ...c, hang: false }));
  await signIn('Taro', 'secret1'); // 次の場面のために入り直す
});

await scenario('ログアウトすると端末の記録に戻り、入り直すとアカウントの記録に戻る', async () => {
  await go('#/account');
  expect(await synced(), '合わない');
  const total = await shownAnswers();
  await page.click('main .card .actions .btn.ghost');
  expect(await waitFor(() => has('.acct-form')), 'ログインの画面に戻らない');
  expect(!(await loggedIn()), '印が残っている');
  expect((await ls(WHO)) == null && (await ls(SESSION)) == null && (await cloud()).current == null, 'ログアウトの後始末が足りない');
  await go('#/stats');
  expect(/まだ記録がありません/.test((await text('main')) ?? ''), 'ログアウトしたのに、アカウントの記録が見える');
  await signIn('Taro', 'secret1');
  expect(await waitFor(async () => (await shownAnswers()) === total), '入り直しても記録が戻らない');
});

await scenario('全部消す：ログイン中はアカウントの記録が消え、端末の（ログイン前の）記録は残る', async () => {
  await setLS(KEY, store({ stats: { 'ear:pitch': { C: stat(9, 9, 900, 9) } }, global: { naming: 'german' } }));
  await go('#/about');
  expect(await waitFor(loggedIn), 'ログイン中でない');
  const wipe = 'main .card:nth-of-type(2) .actions:last-of-type .btn';
  expect(await waitFor(async () => (await text(wipe)) === 'アカウントの記録と、この端末の設定を全部消す'), `ボタンの名前: ${await text(wipe)}`);
  await page.click(wipe);
  await page.click(wipe);
  expect(await waitFor(async () => answers(await cloudData('u1')) === 0, 12000), 'アカウントの記録が消えない');
  await sleep(300);
  const left = await lsJSON(KEY);
  expect(left.stats['ear:pitch']?.C?.n === 9, '端末の（ログイン前の）記録まで消えた');
  expect(left.global.naming === 'doremi', '設定が初期に戻っていない');
});

await scenario('24 時間使わないと、自動でログアウトする（この端末にある分は残る）', async () => {
  await go('#/account');
  // 確かめ終わるまで待つ（前回のログインを覚えているだけの間に時刻を書き換えると、この画面のほうがログアウトしてしまう）
  expect(await synced(), 'ログイン中でない');
  // まだ送っていない記録を、この端末に作っておく
  await patchCloud((c) => ({ ...c, fail: 'network' }));
  await page.evaluate((k) => {
    const a = JSON.parse(localStorage.getItem(k));
    a.stats = { 'ear:pitch': { C: { n: 3, ok: 3, ms: 900, msN: 3, conf: {} } } };
    localStorage.setItem(k, JSON.stringify(a));
  }, `${KEY}.u.u1`);
  await setLS(SESSION, String(Date.now() - 25 * 60 * 60 * 1000));
  await go('#/account');
  expect(await waitFor(() => has('.acct-form')), 'ログアウトされない');
  expect(/しばらく使っていなかった/.test((await text('main .notice')) ?? ''), '理由が出ない');
  expect(/ログアウトしました/.test((await text('.toast')) ?? ''), '下の知らせが出ない');
  await page.click('header .back'); // 読み込み直さずにホームへ（知らせは、読み込み直すまで出しておく）
  expect(await waitFor(async () => /しばらく使っていなかった/.test((await text('main > .notice')) ?? '') && (await has('main > .notice a[href="#/account"]'))), 'ホームに、ログアウトしたことが出ない');
  expect((await cloud()).current == null && (await ls(WHO)) == null, 'ログアウトの後始末が足りない');
  expect((await lsJSON(`${KEY}.u.u1`)).stats['ear:pitch'].C.n === 3, 'この端末にあった分が消えた');
  // 入り直すと、残っていた分がアカウントに送られる
  await patchCloud((c) => ({ ...c, fail: null }));
  await signIn('Taro', 'secret1');
  expect(await waitFor(async () => answers(await cloudData('u1')) === 3), '残っていた分が送られない');
  // 23 時間なら、そのまま（使ったので延びる）
  await setLS(SESSION, String(Date.now() - 23 * 60 * 60 * 1000));
  await go('#/account');
  expect(await waitFor(loggedIn), '23 時間でログアウトされた');
  expect(await waitFor(async () => Date.now() - Number(await ls(SESSION)) < 60000), '使ったのに期限が延びない');
});

await scenario('釣りすごろくのゲストで入っているときは、端末の記録のまま（アカウントには送らない）', async () => {
  await device();
  await patchCloud((c) => ({ ...c, users: { ...c.users, 'guest@tsuri.local': { uid: 'g', email: 'guest@tsuri.local', password: 'x', name: 'ゲスト' } }, current: 'g' }));
  const writes = (await cloud()).writes;
  await setLS(KEY, store({ stats: { 'ear:pitch': { C: stat(2, 2, 600, 2) } } }));
  await go('#/account');
  expect(await waitFor(async () => /釣りすごろくのゲスト/.test((await text('main .notice')) ?? '')), 'ゲストの説明が出ない');
  expect(await has('.acct-form'), '自分のアカウントで入る入力欄が無い');
  expect(!(await loggedIn()) && (await ls(WHO)) == null, 'ゲストなのにログイン中の扱い');
  await go('#/stats');
  expect(/この端末のブラウザの中だけ/.test((await text('main .lead')) ?? ''), '記録の置き場所の説明が違う');
  await sleep(600);
  expect((await cloud()).writes === writes && !(await cloud()).docs.g, 'ゲストの記録をアカウントに書いた');
  // ゲストのまま、自分のアカウントで入れる
  await signIn('Taro', 'secret1');
  expect((await cloud()).current === 'u1', '自分のアカウントに替わらない');
});

await scenario('つながらないときは、ログインできない理由を出す', async () => {
  await device();
  await patchCloud((c) => ({ ...c, fail: 'network' }));
  await go('#/account');
  await fill('Taro', 'secret1');
  await submit();
  expect(await waitFor(async () => /ネットワークにつながりません/.test((await text('.notice.bad')) ?? '')), 'つながらない理由が出ない');
  expect(!(await loggedIn()), 'つながらないのに入れた');
  await patchCloud((c) => ({ ...c, fail: null }));
});

await scenario('スマホの幅で、アカウントの画面が横にはみ出さない', async () => {
  await page.setViewport({ width: 340, height: 700, deviceScaleFactor: 1 });
  for (const who of ['out', 'in']) {
    if (who === 'in') await signIn('Taro', 'secret1');
    else {
      await device();
      await go('#/account');
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over <= 0, `横に ${over}px はみ出している（${who}）`);
    const head = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { person: r('a.iconbtn.acct').width, gear: r('a.iconbtn[href="#/settings"]').right, w: innerWidth };
    });
    expect(who === 'in' || head.gear <= head.w, 'ヘッダーの歯車が画面の外');
  }
  await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 1 });
});

// ------------------------------------------------------------
await browser.close();
await server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} / ${results.length} 通過`);
process.exit(failed ? 1 : 0);
