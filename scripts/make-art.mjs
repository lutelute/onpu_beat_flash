// バナーと紹介画像を作る（手元の Chrome で描いて PNG にする）
//   node scripts/make-art.mjs
//   public/og.png       SNS に貼ったときに出る画像（1200×630）
//   docs/banner.png     README の上に置くバナー（1280×400）
//   docs/square.png     SNS に投稿する正方形（1080×1080）
//   docs/screens.png    アプリの画面を 3 台のスマホに並べた紹介（本番と同じビルドを撮る）
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { bannerArt, ART } from '../src/art/banner.js';
import { icon } from '../src/ui/icons.js';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const FONT = `system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif`;
mkdirSync('docs', { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();

async function render(html, w, h, file) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    body{width:${w}px;height:${h}px;overflow:hidden;font-family:${FONT};color:${ART.cream};background:${ART.navy};
      word-break:auto-phrase;-webkit-font-smoothing:antialiased}
    .art{position:absolute;inset:0}.art svg{width:100%;height:100%;display:block}
    .logo{display:inline-grid;place-items:center;border-radius:22%;background:${ART.cream};color:${ART.navy}}
    .logo svg{width:70%;height:70%}
    .chips{display:flex;gap:12px;flex-wrap:wrap}
    .chip{padding:8px 16px;border-radius:999px;background:rgb(246 243 236 / .12);border:1.5px solid rgb(246 243 236 / .28);font-weight:700}
    .amber{color:${ART.amber}}
  </style></head><body>${html}</body></html>`, { waitUntil: 'load' });
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`  ${file}`);
}

const logo = (size) => `<span class="logo" style="width:${size}px;height:${size}px">${icon('flash')}</span>`;
const chips = (size) => `<div class="chips" style="font-size:${size}px">
  <span class="chip">譜読みフラッシュ</span><span class="chip">即答</span><span class="chip">リズム</span><span class="chip">音名・音程・コード</span></div>`;

console.log('バナー');
// SNS 用（1200×630）：上に文字、下に五線
await render(`
  <div class="art">${bannerArt({ w: 1200, h: 630, sp: 34, cy: 445, notes: 8, lit: 2, id: 'og' })}</div>
  <div style="position:absolute;left:72px;top:64px;right:72px">
    <div style="display:flex;align-items:center;gap:22px">${logo(84)}
      <div style="font-size:66px;font-weight:800;letter-spacing:.02em">音符ビートフラッシュ</div></div>
    <div style="font-size:32px;margin-top:22px;opacity:.9">テノール記号の譜読みを、<span class="amber">見た瞬間に</span>。ランダムな問題でいくらでも。</div>
  </div>`, 1200, 630, 'public/og.png');

// README 用（1280×400）：左に文字、右に五線
await render(`
  <div class="art">${bannerArt({ w: 1280, h: 400, sp: 26, cy: 200, x0: 640, x1: 1240, notes: 6, lit: 1, id: 'rd' })}</div>
  <div style="position:absolute;left:64px;top:84px;width:580px">
    <div style="display:flex;align-items:center;gap:18px">${logo(64)}
      <div style="font-size:46px;font-weight:800">音符ビートフラッシュ</div></div>
    <div style="font-size:23px;margin:20px 0 26px;opacity:.9">テノール記号などの譜読みと、音名・音程・コードの聞き取りを練習するウェブアプリ</div>
    ${chips(17)}
  </div>`, 1280, 400, 'docs/banner.png');

// 正方形（1080×1080）
await render(`
  <div class="art">${bannerArt({ w: 1080, h: 1080, sp: 44, cy: 640, notes: 6, lit: 2, id: 'sq' })}</div>
  <div style="position:absolute;left:84px;top:96px;right:84px">
    ${logo(120)}
    <div style="font-size:84px;font-weight:800;margin-top:36px;line-height:1.15">音符<br>ビートフラッシュ</div>
    <div style="font-size:34px;margin-top:24px;opacity:.9">テノール記号の譜読みを、<span class="amber">見た瞬間に</span>。</div>
  </div>
  <div style="position:absolute;left:84px;right:84px;bottom:90px">${chips(26)}</div>`, 1080, 1080, 'docs/square.png');

// 画面の紹介：本番と同じビルドを撮って、3 台のスマホに並べる
console.log('画面の紹介');
await build({ logLevel: 'error' });
const server = await preview({ preview: { port: 5320, strictPort: true }, logLevel: 'error' });
const BASE = 'http://localhost:5320/';
const KEY = 'onpu-beat-flash.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await browser.newPage();
await app.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
async function shot(hash, store, act) {
  await app.goto(BASE, { waitUntil: 'load' });
  await app.evaluate((k, v) => localStorage.setItem(k, JSON.stringify(v)), KEY, store);
  await app.goto(BASE + hash, { waitUntil: 'load' });
  await app.reload({ waitUntil: 'load' });
  await sleep(400);
  if (act) await act();
  return `data:image/png;base64,${await app.screenshot({ encoding: 'base64' })}`;
}
const base = (patch = {}) => ({ global: { naming: 'doremi', sound: false, keyHints: false, volume: 0.7, midi: false, theme: 'light' }, gen: {}, mode: {}, stats: {}, records: {}, ...patch });
const start = () => app.evaluate(() => document.querySelector('.actions.sticky .btn.primary').click());
const shots = [
  await shot('#/', base()),
  await shot('#/game/flash', base({ gen: { reading: { clefs: ['tenor'], range: 'ledger1', accidentals: 'both', answer: 'name', weak: false } }, mode: { flash: { style: 'free', display: 'stay', count: 10, ms: 400, startLevel: '0', flashSound: false } } }), async () => {
    await start();
    await app.waitForFunction(() => document.querySelector('.pad .key, .pad .wkey') && !document.querySelector('.below.waiting'), { timeout: 20000 });
    for (const k of ['c', 'e', 'g']) await app.keyboard.press(k);
    await sleep(200);
  }),
  await shot('#/game/battle', base({ gen: { reading: { clefs: ['tenor', 'alto'], range: 'near', accidentals: 'none', answer: 'name', weak: false } }, mode: { battle: { length: 's3', speed: 'normal', pad: 'keys', hint: false, pitch: false } } }), async () => {
    await start();
    await sleep(7600);
  }),
];
await server.close();
const phone = (src, i) => `<div style="position:absolute;top:${i === 1 ? 70 : 120}px;left:${80 + i * 420}px;width:360px;height:720px;border-radius:44px;background:#111;padding:12px;box-shadow:0 30px 60px rgb(0 0 0 / .35)">
  <img src="${src}" style="width:100%;height:100%;object-fit:cover;object-position:top;border-radius:34px;display:block"></div>`;
await render(`<div class="art">${bannerArt({ w: 1400, h: 900, sp: 30, cy: 450, notes: 10, lit: 4, id: 'sc' })}</div>
  ${shots.map(phone).join('')}`, 1400, 900, 'docs/screens.png');

await browser.close();
console.log('できました');
