// マイクで答える確認（本番と同じビルドを使う）。Chrome の偽マイクに、ド・ミ・ソを順に鳴らす WAV を流す
//   npm run e2e:mic            画面を出さずに走らせる
//   HEADFUL=1 npm run e2e:mic  画面を出して走らせる
// 確かめること：設定画面のメーターに聞こえた音名が出る／アプリの音が鳴っているあいだは聞かない／
//               譜読み即答にマイクの音で答えが入る／ギターを選ぶと 1 オクターブ上（楽譜に書く高さ）で受け取る／
//               オフにすると止まる／感度の設定（マイクがオンのときだけ出る・下限の線が動く・周りの音を測る・
//               小さな音は「ふつう」なら聞こえ、「とても低い」では聞こえない。小さな音は別の WAV で Chrome を開き直す）
// 手元の Google Chrome を使う（CHROME=/path/to/chrome で変えられる）
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'onpu-mic-'));

/** 倍音のある音（基音が 2 倍音より弱い）を、間をあけて順に鳴らす WAV。Chrome はくり返し流す */
function writeWav(path, notes, { dur = 0.45, gap = 0.3, lead = 0.3, tail = 0.6, sr = 48000, amp = 0.12 } = {}) {
  const total = lead + notes.length * (dur + gap) + tail;
  const x = new Float32Array(Math.ceil(total * sr));
  const amps = [0.5, 1, 0.6, 0.4, 0.25, 0.15, 0.1];
  notes.forEach((m, k) => {
    const f = 440 * 2 ** ((m - 69) / 12);
    const i0 = Math.floor((lead + k * (dur + gap)) * sr);
    for (let i = i0; i < Math.min(x.length, i0 + (dur + 0.25) * sr); i++) {
      const t = (i - i0) / sr;
      let g = Math.min(1, t / 0.008) * Math.exp(-t / 1.2);
      if (t > dur) g *= Math.exp(-(t - dur) / 0.04);
      let s = 0;
      amps.forEach((a, n) => { s += a * Math.sin(2 * Math.PI * f * (n + 1) * t + n); });
      x[i] += amp * g * s;
    }
  });
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(path, b);
}
const wav = join(work, 'ceg.wav');
writeWav(wav, [60, 64, 67]);
// 小さな音：大きさ（rms）は鳴り始めで 0.0075、消える前で 0.005。感度「ふつう」の下限 0.004 より大きく、
// 「とても低い」の下限 0.0126 より小さい
const quietWav = join(work, 'ceg-quiet.wav');
// 音がまったく来ないマイク（波形が 0 ばかり。OS でマイクが切られているときと同じ）
const silentWav = join(work, 'silent.wav');
writeWav(quietWav, [60, 64, 67], { amp: 0.0078 });
writeWav(silentWav, []);

// 開発中のフォルダ（dist）を書き換えないよう、別のところへビルドする
const outDir = join(work, 'dist');
await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
const server = await preview({ build: { outDir }, preview: { port: 5319, strictPort: true }, logLevel: 'error' });
const BASE = 'http://localhost:5319/';

const results = [];
const errors = [];
let browser = null;
let page = null;
/** 偽マイクに file を流す Chrome を開く（流す WAV は開くときにしか選べない） */
async function launch(file) {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.HEADFUL,
    args: [
      '--autoplay-policy=no-user-gesture-required', '--mute-audio',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`,
      '--disable-features=AudioServiceSandbox', // 音の部品が WAV を読めるように
    ],
    defaultViewport: { width: 400, height: 860, deviceScaleFactor: 1 },
  });
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
}
await launch(wav);

const global = (patch = {}) => ({ naming: 'doremi', sound: false, keyHints: true, volume: 0.7, midi: false, mic: true, theme: 'auto', ...patch });
async function open(hash, store) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((k, v) => localStorage.setItem(k, JSON.stringify(v)), KEY, store);
  await page.goto(`${BASE}${hash}`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
}
const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
async function waitFor(fn, ms = 10000, step = 50) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
async function scenario(name, fn) {
  const before = errors.length;
  const t = Date.now();
  try {
    await Promise.race([fn(), sleep(60000).then(() => { throw new Error('60 秒たっても終わらない'); })]);
    const newErr = errors.slice(before);
    if (newErr.length) throw new Error(newErr.join('\n'));
    results.push([name, true]);
    console.log(`✔ ${name}（${((Date.now() - t) / 1000).toFixed(1)}秒）`);
  } catch (e) {
    results.push([name, false]);
    console.log(`✖ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
/** ゲームを始めて、答え合わせの文（.reveal）を n 個集める */
async function collectAnswers(n) {
  await page.click('.actions.sticky .btn.primary');
  await page.evaluate(() => {
    window.__answers = [];
    new MutationObserver(() => {
      const r = document.querySelector('.reveal');
      const s = r?.textContent;
      if (s && window.__answers.at(-1) !== s) window.__answers.push(s);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  expect(await waitFor(async () => (await page.evaluate(() => window.__answers.length)) >= n, 15000), `マイクの音で答えが ${n} つ入らない`);
  return page.evaluate(() => window.__answers);
}
/** 設定画面のメーターに出た音を、しばらく集める */
async function collectMeter() {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    seen.add(await text('.mic-note'));
    await sleep(40);
  }
  return seen;
}

// ------------------------------------------------------------
await scenario('設定画面のメーターに、聞こえた音名（ド・ミ・ソ）が出る', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(async () => /マイクで聞いています/.test((await text('.mic-status')) || '')), `マイクがオンにならない: ${await text('.mic-status')}`);
  expect(!(await page.$eval('.mic-meter', (e) => e.hidden)), 'メーターが出ない');
  const seen = await collectMeter();
  for (const n of ['ド（C4）', 'ミ（E4）', 'ソ（G4）']) expect(seen.has(n), `${n} が出ない（出たもの: ${[...seen].join(' ')}）`);
  const other = [...seen].filter((n) => !['ド（C4）', 'ミ（E4）', 'ソ（G4）', '—'].includes(n));
  expect(!other.length, `鳴らしていない音が出た: ${other.join(' ')}`);
});

await scenario('マイクの様子は「マイクで答える」のすぐ下に出て、聞こえ方を言葉で知らせる', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(async () => /マイクで聞いています/.test((await text('.mic-status')) || '')), 'マイクがオンにならない');
  // メーターは、マイクの項目（オン・オフ）と楽器の選択のあいだにある
  const order = await page.evaluate(() => {
    const meter = document.querySelector('.mic-meter');
    const inst = document.querySelector('[data-fk="micInstrument"]');
    const toggle = document.querySelector('[data-fk="mic"]');
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { afterToggle: before(toggle, meter), beforeInst: before(meter, inst) };
  });
  expect(order.afterToggle && order.beforeInst, `メーターの場所: ${JSON.stringify(order)}`);
  expect(await waitFor(async () => /が聞こえています/.test((await text('.mic-say')) || ''), 8000), `聞こえ方の言葉が出ない: ${await text('.mic-say')}`);
  // MIDI がオフなら、マイクで聞こえた音を MIDI の「受け取った音」には出さない
  expect(await page.$eval('.midi-note', (e) => e.hidden), 'MIDI がオフなのに受け取った音が出る');
});

await scenario('ゲーム中、上の帯にマイクの印が出て、聞こえた音名が出る', async () => {
  await open('#/game/quick', { global: global(), mode: { quick: { length: 'count20', feedback: 'fast' } } });
  await page.click('.actions.sticky .btn.primary');
  expect(await waitFor(async () => !!(await page.$('.runbar .micbadge:not([hidden])')), 8000), 'マイクの印が出ない');
  expect(await waitFor(async () => (await page.$eval('.runbar .micbadge', (e) => e.dataset.kind)) === 'heard', 8000), `聞こえた音が出ない: ${await page.$eval('.runbar .micbadge', (e) => e.textContent)}`);
  expect(/[ドミソ]/.test(await page.$eval('.runbar .micbadge', (e) => e.textContent)), '音名が出ない');
});

await scenario('アプリの音が鳴っているあいだは聞かない', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(async () => /マイクで聞いています/.test((await text('.mic-status')) || '')), 'マイクがオンにならない');
  // 音量を変えると和音（0.6 秒）が鳴る
  await page.$eval('input[data-fk="volume"]', (e) => {
    e.value = '0.6';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await waitFor(async () => !!(await page.$('.mic-meter.gated')), 1000, 20), '和音のあいだも聞いている');
  expect((await text('.mic-note')) === 'アプリの音', `表示: ${await text('.mic-note')}`);
  expect(await waitFor(async () => !(await page.$('.mic-meter.gated')), 3000, 50), '和音が終わっても聞き始めない');
});

await scenario('譜読み即答に、マイクの音で答えが入る', async () => {
  await open('#/game/quick', { global: global(), mode: { quick: { length: 'count20', feedback: 'fast' } } });
  const answers = await collectAnswers(3);
  // 答えた音名：正解なら「✓ ド（C4）」、まちがいなら「… あなたの答え: ミ」
  const given = answers.map((s) => (s.startsWith('✓') ? s.slice(2).split('（')[0] : s.split('あなたの答え: ')[1]));
  expect(given.every((g) => ['ド', 'ミ', 'ソ'].includes(g)), `鳴らしていない音名で答えた: ${answers.join(' | ')}`);
});

await scenario('楽器をギターにすると、メーターに 1 オクターブ上の音（ド・ミ・ソの 5）が出て、保存される', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(async () => /マイクで聞いています/.test((await text('.mic-status')) || '')), 'マイクがオンにならない');
  await page.select('select[data-fk="micInstrument"]', 'guitar');
  await sleep(200);
  const seen = await collectMeter();
  const want = ['ド（C5）', 'ミ（E5）', 'ソ（G5）'];
  for (const n of want) expect(seen.has(n), `${n} が出ない（出たもの: ${[...seen].join(' ')}）`);
  const other = [...seen].filter((n) => ![...want, '—'].includes(n));
  expect(!other.length, `1 オクターブ上でない音が出た: ${other.join(' ')}`);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).global.micInstrument, KEY);
  expect(saved === 'guitar', `保存された値: ${saved}`);
});

await scenario('ギターで鳴らした音は、楽譜に書く高さ（1 オクターブ上）で答えになる', async () => {
  // 鍵盤で高さまで答える譜読み即答（ト音記号の五線の中 → 鍵盤は C4〜B5 なので、C4 でも C5 でも押せる）
  await open('#/game/quick', {
    global: global({ micInstrument: 'guitar' }),
    gen: { reading: { clefs: ['treble'], range: 'staff', accidentals: 'none', answer: 'piano', weak: false } },
    mode: { quick: { length: 'count20', feedback: 'fast' } },
  });
  const answers = await collectAnswers(3);
  // 正解なら「✓ ド（C5）」、まちがいなら「… あなたの答え: ミ（E5）」
  const given = answers.map((s) => (s.startsWith('✓') ? s.slice(2) : s.split('あなたの答え: ')[1]));
  expect(given.every((g) => ['ド（C5）', 'ミ（E5）', 'ソ（G5）'].includes(g)), `1 オクターブ上で受け取っていない: ${answers.join(' | ')}`);
});

await scenario('オフにするとメーターと楽器の選択が消え、設定が保存される', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(async () => /マイクで聞いています/.test((await text('.mic-status')) || '')), 'マイクがオンにならない');
  expect(!!(await page.$('select[data-fk="micInstrument"]')), '楽器の選択が出ない');
  await page.click('input[data-fk="mic"]');
  expect(await waitFor(async () => await page.$eval('.mic-meter', (e) => e.hidden)), 'メーターが消えない');
  expect(((await text('.mic-status')) || '') === '', '状態の文が残る');
  expect(!(await page.$('select[data-fk="micInstrument"]')), '楽器の選択が残る');
  await sleep(400);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).global.mic, KEY);
  expect(saved === false, `保存された値: ${saved}`);
});

// ---- マイクの感度 ----
const micOn = async () => /マイクで聞いています/.test((await text('.mic-status')) || '');
const floorAt = () => page.$eval('.mic-floor', (e) => parseFloat(e.style.left));
// メーターは -60〜0 dB を 0〜100%。下限 0.004（ふつう）は 20.1%、0.0126（とても低い）は 36.7%、0.00126（とても高い）は 3.4%
const nearPct = (a, b) => Math.abs(a - b) < 0.5;
const sensChecked = () => page.$eval('button[data-fk="micSens"][aria-checked="true"]', (e) => e.dataset.oid).catch(() => null);

await scenario('マイクの感度は、マイクがオンのときだけ楽器の選択の次に出る。変えると下限の線が動いて、保存される', async () => {
  await open('#/settings', { global: global({ mic: false }) });
  expect(!(await page.$('[data-fk="micSens"]')), 'マイクがオフなのに感度が出る');
  expect(await page.$eval('.mic-calib', (e) => e.hidden), 'マイクがオフなのに「周りの音を測る」が出る');
  await page.click('input[data-fk="mic"]');
  expect(await waitFor(micOn), `マイクがオンにならない: ${await text('.mic-status')}`);
  expect((await page.$$('button[data-fk="micSens"]')).length === 5, '感度の札が 5 つない');
  const order = await page.$$eval('.form .field', (fs) => fs.map((f) => f.querySelector('[data-fk]')?.dataset.fk));
  expect(order.indexOf('micSens') === order.indexOf('micInstrument') + 1, `並び: ${order.join(' ')}`);
  expect((await sensChecked()) === '3', `はじめの感度: ${await sensChecked()}`);
  expect(!(await page.$eval('.mic-calib', (e) => e.hidden)), '「周りの音を測る」が出ない');
  expect(nearPct(await floorAt(), 20.1), `ふつうの下限の線: ${await floorAt()}%`);
  await page.click('button[data-fk="micSens"][data-oid="1"]');
  expect(await waitFor(async () => nearPct(await floorAt(), 36.7), 2000), `とても低いの下限の線: ${await floorAt()}%`);
  await page.click('button[data-fk="micSens"][data-oid="5"]');
  expect(await waitFor(async () => nearPct(await floorAt(), 3.4), 2000), `とても高いの下限の線: ${await floorAt()}%`);
  await sleep(400);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).global.micSens, KEY);
  expect(saved === 5, `保存された値: ${saved}`);
});

await scenario('周りの音を測るあいだはボタンが押せず、終わると選んだ感度を知らせる（偽マイクは鳴りっぱなしなので、いちばん低い段）', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(micOn), 'マイクがオンにならない');
  await page.click('.mic-calib .btn');
  expect(await page.$eval('.mic-calib .btn', (e) => e.disabled), '測っているあいだもボタンが押せる');
  expect(/測っています/.test((await text('.mic-calib-said')) || ''), `測っているあいだの知らせ: ${await text('.mic-calib-said')}`);
  expect(await waitFor(async () => !(await page.$eval('.mic-calib .btn', (e) => e.disabled)), 8000), '測り終わらない');
  const said = (await text('.mic-calib-said')) || '';
  expect(/周りの音が大きく.*『とても低い』.*マイクの近く/.test(said), `知らせ: ${said}`);
  expect((await sensChecked()) === '1', `設定の札が選び直されない: ${await sensChecked()}`);
  expect(await waitFor(async () => nearPct(await floorAt(), 36.7), 2000), `下限の線: ${await floorAt()}%`);
  await sleep(400);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).global.micSens, KEY);
  expect(saved === 1, `保存された値: ${saved}`);
});

await browser.close();
await launch(quietWav);
await scenario('小さな音は、感度「ふつう」なら聞こえ、「とても低い」にすると聞こえない', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(micOn), 'マイクがオンにならない');
  const seen = await collectMeter();
  const want = ['ド（C4）', 'ミ（E4）', 'ソ（G4）'];
  for (const n of want) expect(seen.has(n), `ふつうで ${n} が出ない（出たもの: ${[...seen].join(' ')}）`);
  const other = [...seen].filter((n) => ![...want, '—'].includes(n));
  expect(!other.length, `鳴らしていない音が出た: ${other.join(' ')}`);
  await page.click('button[data-fk="micSens"][data-oid="1"]');
  await sleep(300);
  const low = await collectMeter();
  expect(low.size === 1 && low.has('—'), `とても低いでも聞こえた: ${[...low].join(' ')}`);
});

await browser.close();
await launch(silentWav);
await scenario('マイクから音がまったく届かないと（OS でマイクが切られているなど）、そう知らせる', async () => {
  await open('#/settings', { global: global() });
  expect(await waitFor(micOn), 'マイクがオンにならない');
  expect(await waitFor(async () => (await text('.mic-note')) === '音なし', 6000), `表示: ${await text('.mic-note')}`);
  expect(/届いていません/.test((await text('.mic-say')) || ''), `説明: ${await text('.mic-say')}`);
  await open('#/game/quick', { global: global(), mode: { quick: { length: 'count20', feedback: 'fast' } } });
  await page.click('.actions.sticky .btn.primary');
  expect(await waitFor(async () => (await page.$eval('.runbar .micbadge', (e) => e.dataset.kind).catch(() => '')) === 'nosignal', 6000), 'ゲーム中の印が「無音」にならない');
});

// ------------------------------------------------------------
await browser.close();
await server.close();
rmSync(work, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} / ${results.length} 通過`);
process.exit(failed ? 1 : 0);
