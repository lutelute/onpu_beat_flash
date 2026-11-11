// アプリのアイコンを作る（public/ に SVG と PNG を書く）
//   node scripts/make-icons.mjs
// 字形は VexFlow に入っている Bravura（ハ音記号と全音符）。PNG は手元の Chrome で描く
import { Glyph } from 'vexflow/bravura';
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));

function path(code, x, y, point) {
  let d = '';
  const f = (n) => n.toFixed(1);
  const rec = {
    beginPath() {}, fill() {}, closePath() { d += 'Z'; },
    moveTo(a, b) { d += `M${f(a)} ${f(b)}`; },
    lineTo(a, b) { d += `L${f(a)} ${f(b)}`; },
    quadraticCurveTo(a, b, c, e) { d += `Q${f(a)} ${f(b)} ${f(c)} ${f(e)}`; },
    bezierCurveTo(a, b, c, e, g, k) { d += `C${f(a)} ${f(b)} ${f(c)} ${f(e)} ${f(g)} ${f(k)}`; },
  };
  Glyph.renderGlyph(rec, x, y, point, code);
  return d;
}

const NAVY = '#233d5c';
const CREAM = '#f6f3ec';
const AMBER = '#f0a929';

/** pad: 外周の余白の割合（maskable は大きめ） */
function iconSVG({ pad = 0.1, round = true } = {}) {
  const S = 512;
  const inner = S * (1 - 2 * pad);
  const k = inner / 400; // 400 角の図を inner に収める
  const o = S * pad;
  const sp = 46 * k; // 線の間隔
  const top = o + 215 * k - 2 * sp; // 記号が上に 1 間はみ出すぶん少し下げる
  const lines = [0, 1, 2, 3, 4].map((i) => `<rect x="${o}" y="${(top + i * sp - 2.2 * k).toFixed(1)}" width="${inner}" height="${(4.4 * k).toFixed(1)}" rx="${2 * k}" fill="${CREAM}" opacity="0.35"/>`).join('');
  // テノール記号：ハ音記号の中心を第4線（上から2本目）に。point は線の間隔から決める
  const point = (sp / 10) * 39;
  const clef = path('cClef', o + 34 * k, top + sp, point);
  // 全音符：同じ第4線の上に（＝中央のド）。バナーと同じく光らせる
  const nx = o + 240 * k;
  const note = path('noteheadWhole', nx, top + sp, point * 1.25);
  const ncx = nx + (17.1 * (point * 1.25)) / 39 / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3552"/><stop offset="1" stop-color="#2b4c7e"/></linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.6"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${S}" height="${S}" ${round ? 'rx="112"' : ''} fill="url(#bg)"/>
${lines}
<circle cx="${ncx.toFixed(1)}" cy="${(top + sp).toFixed(1)}" r="${(sp * 1.9).toFixed(1)}" fill="url(#glow)"/>
<path d="${clef}" fill="${CREAM}"/>
<path d="${note}" fill="${AMBER}"/>
</svg>`;
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon.svg', iconSVG({ pad: 0.1, round: true }));
writeFileSync('public/icon-maskable.svg', iconSVG({ pad: 0.2, round: false }));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
async function png(svg, size, file) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
const round = iconSVG({ pad: 0.1, round: true });
const square = iconSVG({ pad: 0.1, round: false });
const mask = iconSVG({ pad: 0.2, round: false });
await png(round, 192, 'public/icon-192.png');
await png(round, 512, 'public/icon-512.png');
await png(mask, 512, 'public/icon-maskable-512.png');
await png(square, 180, 'public/apple-touch-icon.png'); // iOS は自分で角を丸める
await png(round, 32, 'public/favicon-32.png');
await browser.close();
console.log('public/ にアイコンを書きました');
