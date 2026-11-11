// 釣りすごろくとログインが共有されるかを確かめる
//   npm run e2e:share   （Firebase のエミュレータを起動して走らせる。Java 21 以上と、ネットにつながっていることが要る）
// 公開中の釣りすごろく（https://lutelute.github.io/Tsuri_sugoroku/）の静的なファイルを一時フォルダに写し、
// いまの音符ビートフラッシュのビルドと同じ場所（同じオリジン）に置いて、片方でのログイン・ログアウト・登録・
// 24 時間の期限がもう片方に伝わるかを見る。Firebase への通信は、ブラウザの中で手元のエミュレータへ回す
// （本番の Firebase には出ない。回しそこねた通信は、名前を引けないようにして失敗させる）。
import puppeteer from 'puppeteer-core';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';

const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));
if (!CHROME) {
  console.error('Chrome が見つかりません。CHROME=/path/to/chrome を指定してください');
  process.exit(2);
}
const SITE = mkdtempSync(join(tmpdir(), 'onpu-share-'));
process.on('exit', () => rmSync(SITE, { recursive: true, force: true }));

// ---- 公開中の釣りすごろくを写す（index.html から辿れるファイルを全部） ----
const TSURI = 'https://lutelute.github.io';
{
  const seen = new Set();
  const queue = ['/Tsuri_sugoroku/'];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await fetch(TSURI + path);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const file = join(SITE, path.endsWith('/') ? `${path}index.html` : path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    if (/\.(html|js|css)$/.test(file)) {
      const text = buf.toString('utf8');
      for (const m of text.matchAll(/\/Tsuri_sugoroku\/[A-Za-z0-9_./-]+\.(?:js|css|svg|png|webp|jpg|woff2?|json|webmanifest|ico)/g)) queue.push(m[0]);
      for (const m of text.matchAll(/(?<![\w/])(?:\.\/|assets\/)[A-Za-z0-9_.-]+\.(?:js|css|svg|png|webp|jpg|woff2?)/g)) queue.push(`/Tsuri_sugoroku/assets/${m[0].replace(/^\.\//, '').replace(/^assets\//, '')}`);
    }
  }
  if (!existsSync(join(SITE, 'Tsuri_sugoroku/index.html'))) {
    console.error('公開中の釣りすごろくを読めませんでした（ネットにつながっているか確かめてください）');
    process.exit(2);
  }
}
// ---- いまの音符ビートフラッシュをビルドして隣に置く ----
await build({ logLevel: 'error', build: { outDir: join(SITE, 'onpu_beat_flash'), emptyOutDir: true } });

const PORT = 5321;
const LOCAL = `http://localhost:${PORT}`;
const AUTH = 'http://127.0.0.1:9099';
const FS = 'http://127.0.0.1:8080';
const DEMO = 'demo-tsuri-sugoroku';
const P_REAL = 'projects/tsuri-sugoroku/';
const P_DEMO = `projects/${DEMO}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 前の残りを消す
await fetch(`${AUTH}/emulator/v1/projects/${DEMO}/accounts`, { method: 'DELETE' });
await fetch(`${FS}/emulator/v1/projects/${DEMO}/databases/(default)/documents`, { method: 'DELETE' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, LOCAL).pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(SITE, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !process.env.HEADFUL,
  // 本番の Firebase・Google の名前は引けないようにしておく（ブラウザの中で回しそこねたら、通信は失敗する）
  args: ['--mute-audio', '--host-resolver-rules=MAP *.googleapis.com ~NOTFOUND, MAP *.gstatic.com ~NOTFOUND, MAP *.firebaseapp.com ~NOTFOUND'],
  defaultViewport: { width: 1100, height: 800 },
});
const proxied = [];
const aborted = [];
const onpuErrors = [];
const cors = { 'access-control-allow-origin': LOCAL, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

async function handle(req) {
  const raw = req.url();
  if (raw.startsWith(LOCAL) || /^(data|blob|about):/.test(raw)) return req.continue();
  const url = new URL(raw);
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
  let target = null;
  let rewrite = false;
  if (url.host === 'identitytoolkit.googleapis.com' || url.host === 'securetoken.googleapis.com') target = `${AUTH}/${url.host}${url.pathname}${url.search}`;
  else if (url.host === 'firestore.googleapis.com' && url.pathname.startsWith('/v1/')) {
    target = `${FS}${url.pathname.replaceAll(P_REAL, P_DEMO)}${url.search}`;
    rewrite = true;
  }
  if (!target) {
    aborted.push(`${req.method()} ${url.host}${url.pathname.slice(0, 60)}`);
    return req.abort();
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers())) if (/^(content-type|authorization|google-cloud-resource-prefix)$/i.test(k)) headers[k] = rewrite ? v.replaceAll(P_REAL, P_DEMO) : v;
  const body = req.postData();
  try {
    const res = await fetch(target, { method: req.method(), headers, body: body && rewrite ? body.replaceAll(P_REAL, P_DEMO) : body });
    let text = await res.text();
    if (rewrite) text = text.replaceAll(P_DEMO, P_REAL);
    proxied.push(`${req.method()} ${url.host}${url.pathname} → ${res.status}`);
    return req.respond({ status: res.status, headers: { ...cors, 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: text });
  } catch (e) {
    aborted.push(`proxy failed ${url.pathname}: ${e.message}`);
    return req.abort();
  }
}

const ctx = await browser.createBrowserContext(); // 1 つの端末（同じ保存場所）
async function open(path) {
  const page = await ctx.newPage();
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (r) => handle(r).catch(() => {}));
  if (path.startsWith('/onpu')) page.on('pageerror', (e) => onpuErrors.push(e.message));
  await page.goto(LOCAL + path, { waitUntil: 'load' });
  return page;
}
async function waitFor(fn, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn().catch(() => false)) return true;
    await sleep(80);
  }
  return false;
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const results = [];
async function scenario(name, fn) {
  const t = Date.now();
  const pages = (await ctx.pages()).length;
  try {
    await fn();
    results.push(true);
    console.log(`✔ ${name}（${((Date.now() - t) / 1000).toFixed(1)}秒）`);
  } catch (e) {
    results.push(false);
    console.log(`✖ ${name}\n    ${e.message}`);
  }
  for (const p of (await ctx.pages()).slice(pages)) await p.close();
}

// ---- 釣りすごろくの画面 ----
const tsuri = {
  open: () => open('/Tsuri_sugoroku/'),
  /** タイトルの右上：ログイン中なら名前、そうでなければ null（決まるまで待つ） */
  async who(page) {
    let r;
    await waitFor(async () => {
      r = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const out = btns.find((b) => b.textContent.trim() === 'ログアウト');
        if (out) return { name: out.previousElementSibling?.textContent.trim() ?? '?' };
        if (btns.some((b) => b.textContent.trim() === 'ログイン')) return { name: null };
        return undefined;
      });
      return r !== undefined;
    });
    await sleep(1200); // ログインの状態が分かるまで少し待って、もう一度
    return page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const out = btns.find((b) => b.textContent.trim() === 'ログアウト');
      return out ? out.previousElementSibling?.textContent.trim() ?? '?' : null;
    });
  },
  async login(page, name, pass) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ログイン').click());
    expect(await waitFor(() => page.$('input[placeholder="ユーザー名を入力"]')), '釣りすごろくのログインの画面が出ない');
    await page.type('input[placeholder="ユーザー名を入力"]', name);
    await page.type('input[type=password]', pass);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ログイン' && !b.disabled).click());
    expect(await waitFor(() => page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'ログアウト'))), '釣りすごろくでログインできない');
  },
  logout: (page) => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ログアウト').click()),
};
// ---- 音符ビートフラッシュの画面 ----
const onpu = {
  open: () => open('/onpu_beat_flash/#/account'),
  async who(page) {
    expect(await waitFor(async () => (await page.$('.acct-form')) || (await page.$eval('.acct-status', (e) => e.dataset.tone === 'ok'))), `音符ビートフラッシュのアカウントの画面が決まらない: ${await page.$eval('main', (e) => e.textContent.slice(0, 120)).catch(() => '')}`);
    const h = await page.$eval('main h2', (e) => e.textContent);
    return /ログイン中$/.test(h) ? h.replace(/ さんログイン中$/, '') : null;
  },
};
const emu = (path, body) => fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const made = await emu('accounts:signUp', { email: 'kyoyu@tsuri.local', password: 'share-pass1', returnSecureToken: true });
await emu('accounts:update', { idToken: made.idToken, displayName: 'Kyoyu', returnSecureToken: true });

// ------------------------------------------------------------
await scenario('釣りすごろくでログイン → 音符ビートフラッシュもログイン中（記録もアカウントと合う）', async () => {
  const t = await tsuri.open();
  expect((await tsuri.who(t)) === null, '初めからログインしている');
  await tsuri.login(t, 'Kyoyu', 'share-pass1');
  const o = await onpu.open();
  const who = await onpu.who(o);
  expect(who === 'Kyoyu', `音符ビートフラッシュでは: ${who}`);
  expect(await o.$eval('.acct-status', (e) => e.dataset.tone === 'ok'), '記録がアカウントと合わない');
});

await scenario('音符ビートフラッシュでログアウト → 釣りすごろくもログアウト', async () => {
  const o = await onpu.open();
  expect((await onpu.who(o)) === 'Kyoyu', 'ログイン中でない');
  await o.click('main .card .actions .btn.ghost');
  expect(await waitFor(() => o.$('.acct-form')), 'ログアウトできない');
  const t = await tsuri.open();
  const who = await tsuri.who(t);
  expect(who === null, `釣りすごろくでは: ${who}`);
});

await scenario('音符ビートフラッシュで新しく登録 → 釣りすごろくでもその人でログイン中・ユーザーを探せる', async () => {
  const o = await onpu.open();
  await o.waitForSelector('.acct-form');
  await o.click('.acct-form .linkbtn');
  await o.type('.acct-form input[name=username]', 'OnpuNew');
  await o.type('.acct-form input[name=password]', 'newpass1');
  await o.click('.acct-form button[type=submit]');
  expect(await waitFor(() => o.$('a.iconbtn.acct[data-on]')), `登録できない: ${await o.$eval('.notice.bad', (e) => e.textContent).catch(() => '')}`);
  const t = await tsuri.open();
  const who = await tsuri.who(t);
  expect(who === 'OnpuNew', `釣りすごろくでは: ${who}`);
  const name = await fetch(`${FS}/v1/projects/${DEMO}/databases/(default)/documents/usernames/onpunew`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json());
  expect(name.fields?.displayName?.stringValue === 'OnpuNew', `usernames: ${JSON.stringify(name).slice(0, 200)}`);
});

await scenario('釣りすごろくでログアウト → 音符ビートフラッシュもログアウト', async () => {
  const t = await tsuri.open();
  expect((await tsuri.who(t)) === 'OnpuNew', 'ログイン中でない');
  await tsuri.logout(t);
  expect(await waitFor(() => t.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'ログイン'))), '釣りすごろくでログアウトできない');
  const o = await onpu.open();
  const who = await onpu.who(o);
  expect(who === null, `音符ビートフラッシュでは: ${who}`);
});

await scenario('24 時間の期限も共有：期限が切れていたら、どちらを開いてもログアウト', async () => {
  const t = await tsuri.open();
  await tsuri.who(t);
  await tsuri.login(t, 'kyoyu', 'share-pass1'); // 小文字でも同じ人
  await t.evaluate(() => localStorage.setItem('tsuri_session_at', String(Date.now() - 25 * 60 * 60 * 1000)));
  const o = await onpu.open();
  const who = await onpu.who(o);
  expect(who === null, `音符ビートフラッシュでは: ${who}`);
  const t2 = await tsuri.open();
  const who2 = await tsuri.who(t2);
  expect(who2 === null, `釣りすごろくでは: ${who2}`);
});

await browser.close();
server.close();
const prod = aborted.filter((a) => !/fonts\.googleapis|fonts\.gstatic|google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel|www\.google\.com\/images\/cleardot\.gif/.test(a));
console.log(`\nエミュレータへ回した通信 ${proxied.length} 件（${[...new Set(proxied.map((p) => p.replace(/ → .*/, '').replace(/\?.*/, '')))].slice(0, 8).join('、')} …）`);
console.log(`止めた通信 ${aborted.length} 件（フォントと、釣りすごろくの Firestore の常時接続・その接続確認）。それ以外: ${prod.length ? prod.join(', ') : 'なし'}`);
console.log(`音符ビートフラッシュの画面のエラー: ${onpuErrors.length ? onpuErrors.join(' / ') : 'なし'}`);
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed} / ${results.length} 通過`);
process.exit(failed || prod.length || onpuErrors.length ? 1 : 0);
