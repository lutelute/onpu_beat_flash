// ブラウザで全部のゲームを通しで動かす確認（本番と同じビルドを使う）
//   npm run e2e            画面を出さずに走らせる
//   HEADFUL=1 npm run e2e  画面を出して走らせる
// 手元の Google Chrome を使う（CHROME=/path/to/chrome で変えられる）
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await build({ logLevel: 'error' });
const server = await preview({ preview: { port: 5318, strictPort: true }, logLevel: 'error' });
const BASE = 'http://localhost:5318/';

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
// 偽の MIDI 鍵盤（Web MIDI の代わり）。window.__midi.plug(名前) でつなぎ、send(番号) で鍵盤を押したことにする
await page.evaluateOnNewDocument(() => {
  const inputs = new Map();
  const fake = {
    access: null,
    plug(name) {
      const id = `in${inputs.size}`;
      inputs.set(id, { id, name, onmidimessage: null });
      fake.access?.onstatechange?.({ port: inputs.get(id) });
    },
    send(note, vel = 100) {
      for (const i of inputs.values()) i.onmidimessage?.({ data: new Uint8Array([0x90, note, vel]) });
      for (const i of inputs.values()) i.onmidimessage?.({ data: new Uint8Array([0x80, note, 0]) });
    },
  };
  window.__midi = fake;
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: async () => (fake.access = { inputs, outputs: new Map(), onstatechange: null }),
  });
});
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

async function open(hash, store) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((k, v) => {
    if (v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, KEY, store);
  await page.goto(`${BASE}${hash}`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
}
const start = () => page.click('.actions.sticky .btn.primary');
// フラッシュの答えのボタンは光らせる前から薄く置いてあるので、答える段階（.below.waiting が消える）を待つ
const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
const count = (sel) => page.$$eval(sel, (es) => es.length);
async function waitFor(fn, ms = 15000, step = 50) {
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
    // 1 つの場面は 90 秒まで（止まったらどこで止まったか分かるように）
    await Promise.race([fn(), sleep(90000).then(() => { throw new Error('90 秒たっても終わらない'); })]);
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

const base = (patch = {}) => ({
  global: { naming: 'doremi', sound: true, keyHints: true, volume: 0.7 },
  gen: {}, mode: {}, stats: {}, records: {},
  ...patch,
});

// ------------------------------------------------------------
await scenario('ホームにゲームの札が並ぶ', async () => {
  await open('#/', undefined);
  expect((await count('a.gamecard')) >= 7, `札の数 ${await count('a.gamecard')}`);
});

await scenario('譜読みフラッシュ（自由練習）を最後まで', async () => {
  await open('#/game/flash', base({ mode: { flash: { style: 'free', count: 4, ms: 150, startLevel: '0', flashSound: true } } }));
  await start();
  expect(await waitFor(async () => (await count('.pad .key')) === 7 && !(await page.$('.below.waiting'))), '答えのボタンが出ない');
  expect((await count('.stage svg')) === 1, '五線が無い');
  for (const k of ['c', 'd', 'Backspace', 'e', 'f', 'g']) await page.keyboard.press(k);
  expect(await waitFor(async () => (await count('.qcard')) === 4), '結果のカードが 4 枚にならない');
  expect((await text('.result h2'))?.length > 0, '見出しが無い');
});

await scenario('譜読みフラッシュ（検定）', async () => {
  await open('#/game/flash', base({ mode: { flash: { style: 'kentei', count: 5, ms: 800, startLevel: '0', flashSound: false } } }));
  await start();
  expect(await waitFor(async () => (await count('.pad .key')) === 7 && !(await page.$('.below.waiting')), 20000), '答えのボタンが出ない');
  for (const k of ['c', 'd', 'e']) await page.keyboard.press(k);
  expect(await waitFor(async () => /10級/.test((await text('.result h2')) || '')), '10級の結果が出ない');
});

await scenario('譜読み即答（テノール＋ヘ音・鍵盤で答える・20問）', async () => {
  await open('#/game/quick', base({
    gen: { reading: { clefs: ['tenor', 'bass'], range: 'ledger2', answer: 'piano', accidentals: 'none', weak: true } },
    mode: { quick: { length: 'count20', feedback: 'fast' } },
  }));
  await start();
  expect(await waitFor(async () => (await count('.pad .wkey')) > 14), '鍵盤が出ない');
  for (let i = 0; i < 20; i++) {
    await waitFor(async () => !(await page.$('.pad.disabled')));
    // 鍵盤は横にスクロールするので、見えている場所でなく DOM の click で押す
    await page.$$eval('.pad .wkey', (ks, n) => ks[n % ks.length].click(), i);
    await sleep(60);
  }
  expect(await waitFor(async () => !!(await page.$('.result'))), '結果が出ない');
  expect((await count('.breakdown .bd-staff')) >= 1, '内訳の五線が無い');
});

await scenario('譜読み即答（30秒・時間切れ）', async () => {
  await open('#/game/quick', base({ mode: { quick: { length: 'time30', feedback: 'fast' } } }));
  await page.evaluate(() => {
    // 30 秒待たないよう、時計を 25 秒進める
    const real = performance.now.bind(performance);
    let skew = 0;
    performance.now = () => real() + skew;
    window.__skew = (ms) => { skew += ms; };
  });
  await start();
  await page.keyboard.press('c');
  await page.evaluate(() => window.__skew(29500));
  expect(await waitFor(async () => !!(await page.$('.result')), 4000), '時間切れで終わらない');
});

for (const [id, gen, keys] of [
  ['pitch', { set: 'chroma', ref: 'C', register: 'two', weak: false }, ['c', 'd', 'e']],
  ['pitch', { set: 'white', ref: 'none', register: 'mid', weak: true }, ['c', 'g']],
  ['interval', { set: ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'], dir: 'mix', weak: false }, ['1', '0', '=']],
  ['chord', { set: ['maj', 'min', 'dim', 'aug', 'sus4', 'dom7', 'maj7', 'min7', 'm7b5', 'dim7', 'mM7'], play: 'both', inv: 'all', weak: false }, ['1', '5', '-']],
]) {
  await scenario(`${id}（${JSON.stringify(gen).slice(0, 40)}…）を10問`, async () => {
    await open(`#/game/${id}`, base({ gen: { [id]: gen }, mode: { [id]: { length: 'count10', feedback: 'study' } } }));
    await start();
    expect(await waitFor(async () => !!(await page.$('.listen'))), '「もう一度聞く」が出ない');
    await page.keyboard.press(' ');
    for (let i = 0; i < 10; i++) {
      await waitFor(async () => !(await page.$('.pad.disabled')));
      await page.keyboard.press(keys[i % keys.length]);
      await sleep(80);
      const cmp = await page.$$('.controls .btn');
      if (cmp.length > 1) await cmp[0].click(); // 聞き比べ
      await page.keyboard.press('Enter');
      await sleep(60);
    }
    expect(await waitFor(async () => !!(await page.$('.result'))), '結果が出ない');
    expect((await count('.bd-table tbody tr')) >= 1, '内訳の表が無い');
  });
}

await scenario('コード聞き取り：MIDI 鍵盤で和音を弾いて答えられる（ド・ミ・ソ＝メジャー、ラ・ド・ミ＝マイナー）', async () => {
  await open('#/game/chord', base({
    global: { naming: 'doremi', sound: false, keyHints: true, volume: 0.7, midi: true },
    gen: { chord: { set: ['maj', 'min'], play: 'block', inv: 'root', weak: false } },
    mode: { chord: { length: 'count10', feedback: 'study' } },
  }));
  await page.evaluate(() => window.__midi.plug('テスト鍵盤'));
  await start();
  for (const [notes, name] of [[[60, 64, 67], 'メジャー'], [[57, 60, 64], 'マイナー']]) {
    expect(await waitFor(async () => !(await page.$('.pad.disabled')), 5000), '答えを待たない');
    await page.evaluate((ns) => ns.forEach((n) => window.__midi.send(n)), notes);
    expect(await waitFor(async () => /[✓×]/.test((await text('.reveal')) || ''), 3000), `和音で答えが入らない（${name}）`);
    const r = await text('.reveal');
    expect(new RegExp(`✓.*${name}|あなたの答え: ${name}`).test(r), `${name} と答えていない: ${r}`);
    await page.keyboard.press('Enter');
    await sleep(200);
  }
  // 2 音だけ（ド・ミ）では答えにならない
  expect(await waitFor(async () => !(await page.$('.pad.disabled')), 5000), '答えを待たない');
  await page.evaluate(() => [60, 64].forEach((n) => window.__midi.send(n)));
  await sleep(400);
  expect(!/[✓×]/.test((await text('.reveal')) || ''), '2 音で答えになった');
});

await scenario('譜読みリズム（16音・速め）', async () => {
  await open('#/game/rhythm', base({ mode: { rhythm: { bpm: 200, density: 'every1', length: 'n16', metronome: true, pitch: true, offset: 0 } } }));
  await start();
  expect(await waitFor(async () => (await count('.rnote')) > 0, 5000), '音符が流れてこない');
  const keys = 'cdefgab';
  let i = 0;
  const done = await waitFor(async () => {
    await page.keyboard.press(keys[i++ % 7]);
    return !!(await page.$('.result'));
  }, 20000, 150);
  expect(done, 'リズムが終わらない');
  expect(/Miss/.test(await page.$eval('.tiles', (e) => e.textContent)), '判定の内訳が無い');
});

await scenario('リズム練習（叩いて最後まで）', async () => {
  await open('#/game/tap', base({
    gen: { rhythmPattern: { level: '3', time: '3', measures: '1', rests: true, weak: false } },
    mode: { tap: { bpm: 160, count: 'n4', listen: false, metronome: true, offset: 0 } },
  }));
  await start();
  expect(await waitFor(async () => (await count('.tapscore svg')) === 1, 5000), 'リズム譜が出ない');
  const done = await waitFor(async () => {
    await page.keyboard.press(' ');
    return !!(await page.$('.result'));
  }, 40000, 120);
  expect(done, 'リズム練習が終わらない');
  expect((await page.$eval('.tiles', (e) => e.textContent)).includes('空振り'), '空振りの数が無い');
  expect((await count('.bd-table tbody tr')) >= 1, '型ごとの表が無い');
});

await scenario('フラッシュ：もう一度見ても答えが残り、答えを見るで答え合わせ', async () => {
  await open('#/game/flash', base({ mode: { flash: { style: 'free', display: 'flash', count: 4, ms: 150, startLevel: '0', flashSound: false } } }));
  await start();
  const answering = async () => (await count('.pad .key')) === 7 && !(await page.$('.below.waiting'));
  expect(await waitFor(answering), '答える段階にならない');
  await page.keyboard.press('c');
  await page.keyboard.press('d');
  await page.keyboard.press('r');
  await sleep(300);
  expect(await waitFor(answering), 'もう一度見たあと答える段階に戻らない');
  expect((await count('.slot.filled')) === 2, `答えが消えた（${await count('.slot.filled')}）`);
  await page.evaluate(() => [...document.querySelectorAll('.below .btn')].find((b) => b.textContent.includes('答えを見る')).click());
  expect(await waitFor(async () => (await count('.qcard')) === 4), '答え合わせに進まない');
  expect((await page.$eval('.qcards', (e) => e.textContent)).includes('答えなし'), '答えていない音の表示が無い');
});

await scenario('オトバトル：届かれるとハートが減り、答えると倒せる。一時停止とやめる', async () => {
  await open('#/game/battle', base({
    gen: { reading: { clefs: ['tenor'], range: 'staff', accidentals: 'none', answer: 'name', weak: false } },
    mode: { battle: { length: 's3', speed: 'fast', pad: 'keys', hint: false, pitch: true } },
  }));
  await start();
  expect(await waitFor(async () => (await count('canvas.battle-canvas')) === 1 && (await count('.hearts svg.on')) === 5, 5000), '戦場かハートが出ない');
  // 何もしないと、そのうち砦に届かれる
  expect(await waitFor(async () => (await count('.hearts svg.on')) < 5, 20000), 'ハートが減らない');
  // 音名のキーを順に押せば、どれかが当たる（外すと少し撃てないので間をあける）
  const score = () => page.$eval('.scoreline b', (e) => Number(e.textContent.replace(/\D/g, '')));
  const hit = await waitFor(async () => {
    for (const k of 'cdefgab') {
      await page.keyboard.press(k);
      await sleep(480);
      if ((await score()) > 0) return true;
    }
    return false;
  }, 30000, 0);
  expect(hit, '答えても倒せない');
  await page.keyboard.press('Escape');
  expect(await waitFor(async () => !(await page.$eval('.battle-pause', (e) => e.hidden))), '一時停止にならない');
  await page.keyboard.press('Enter');
  expect(await waitFor(async () => await page.$eval('.battle-pause', (e) => e.hidden)), '続けられない');
  await page.keyboard.press('Escape');
  await page.evaluate(() => [...document.querySelectorAll('.battle-pause .btn')].find((b) => b.textContent.includes('やめる')).click());
  expect(await waitFor(async () => !!(await page.$('.result'))), '結果の画面にならない');
  expect((await page.$eval('.result-line', (e) => e.textContent)).includes('届かれた'), '結果の数字が無い');
  // 続けるボタンは、内訳より上にある
  expect(await page.evaluate(() => document.querySelector('.result-actions').getBoundingClientRect().top < document.querySelector('.result-details').getBoundingClientRect().top), '続けるボタンが内訳の下にある');
  expect((await count('.bd-staff')) >= 1, '音ごとの結果が無い');
  const rec = await page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k)).stats.read || {}).length, KEY);
  expect(rec >= 1, '苦手な音の記録に残らない');
});

await scenario('オトバトル（四方から・だんだん広がる・照準）：面の名前が出て、届かれるとハートが減り、狙って倒せる', async () => {
  await open('#/game/battle', base({
    gen: { reading: { clefs: ['tenor'], range: 'ledger1', accidentals: 'both', answer: 'name', weak: false } },
    mode: { battle: { field: 'around', course: 'grow', length: 's3', speed: 'fast', pad: 'keys', hint: false, colors: true, pitch: true } },
  }));
  await start();
  expect(await waitFor(async () => (await count('canvas.battle-canvas')) === 1, 5000), '戦場が出ない');
  // 1 面は「ハ長調の門」（ト音記号・五線の中・臨時記号なし）。鍵盤は白鍵だけ使う
  expect(await waitFor(async () => (await page.$eval('.battle-banner', (e) => e.textContent)).includes('ハ長調の門'), 4000), '面の名前が出ない');
  expect((await page.$eval('canvas.battle-canvas', (e) => e.getAttribute('aria-label'))).includes('四方から'), '四方からの説明が無い');
  // 照準：戦場をクリックしても止まらない（同じ音の敵が 2 つのとき近いほうを撃つ）
  const box = await (await page.$('canvas.battle-canvas')).boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  expect(await waitFor(async () => (await count('.hearts svg.on')) < 5, 25000), 'ハートが減らない');
  const score = () => page.$eval('.scoreline b', (e) => Number(e.textContent.replace(/\D/g, '')));
  const hit = await waitFor(async () => {
    for (const k of 'cdefgab') {
      await page.keyboard.press(k);
      await sleep(480);
      if ((await score()) > 0) return true;
    }
    return false;
  }, 30000, 0);
  expect(hit, '答えても倒せない');
  await page.keyboard.press('Escape');
  await page.evaluate(() => [...document.querySelectorAll('.battle-pause .btn')].find((b) => b.textContent.includes('やめる')).click());
  expect(await waitFor(async () => !!(await page.$('.result'))), '結果の画面にならない');
  const sub = await page.$eval('.result', (e) => e.textContent);
  expect(sub.includes('ハ長調の門') && sub.includes('四方から'), '結果に面の名前か戦い方が無い');
});

await scenario('記録の画面', async () => {
  // 直前のリズムの成績が残っている前提
  await page.goto(`${BASE}#/stats`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  expect((await count('.bd-staff svg')) >= 1, '譜読みの記録の五線が出ない');
  expect((await count('section.card .bd-table tbody tr')) >= 1, '苦手な順の表が出ない');
});

await scenario('譜読み即答（臨時記号 ♯♭・12音のボタン・Shift で ♯）', async () => {
  await open('#/game/quick', base({
    gen: { reading: { clefs: ['tenor'], range: 'ledger1', accidentals: 'both', answer: 'name', weak: false } },
    mode: { quick: { length: 'count20', feedback: 'fast' } },
  }));
  await start();
  expect(await waitFor(async () => (await count('.pad-chroma .bkey')) === 5), '12音のボタンが出ない');
  for (let i = 0; i < 20; i++) {
    await waitFor(async () => !(await page.$('.pad.disabled')));
    await page.keyboard.down('Shift');
    await page.keyboard.press('f');
    await page.keyboard.up('Shift');
    await sleep(60);
  }
  expect(await waitFor(async () => !!(await page.$('.result'))), '結果が出ない');
  expect(/♯|♭/.test(await page.$eval('.breakdown', (e) => e.textContent)), '内訳に臨時記号つきの音が無い');
});

await scenario('共有リンク：同じ問題番号なら同じ問題', async () => {
  const shared = { g: { clefs: ['tenor'], range: 'ledger1', accidentals: 'none', answer: 'name', weak: false }, m: { length: 'count20', feedback: 'fast' }, seed: 4242 };
  const q = Buffer.from(JSON.stringify(shared)).toString('base64url');
  const firstThree = async () => {
    // アプリは共有の部分を読んだらアドレスから外すので、読み込み直さずにリンクへ移る
    await open('#/', base());
    await page.evaluate((h) => { location.hash = h; }, `#/game/quick?s=${q}`);
    await sleep(300);
    expect((await page.$eval('main', (e) => e.textContent)).includes('問題番号 #4242'), '共有のお知らせが出ない');
    expect(!page.url().includes('?s='), 'アドレスから共有の設定が消えていない');
    await start();
    const out = [];
    for (let i = 0; i < 3; i++) {
      await waitFor(async () => !(await page.$('.pad.disabled')) && !!(await page.$('.stage svg')));
      out.push(await page.$eval('.stage svg', (e) => e.innerHTML));
      await page.keyboard.press('c');
      await sleep(1300);
    }
    return out.join('|');
  };
  const a = await firstThree();
  const b = await firstThree();
  expect(a === b, '同じ問題番号なのに問題が違う');
});

await scenario('読み方ガイド・このアプリについて', async () => {
  await open('#/guide', base());
  expect((await count('.guide .score svg')) === 7, `早見表の五線が 7 つでない: ${await count('.guide .score svg')}`);
  expect((await page.$eval('main', (e) => e.textContent)).includes('中央のド'), 'テノール記号のコツが無い');
  await page.evaluate(() => { location.hash = '#/about'; });
  await sleep(200);
  expect((await page.$eval('main', (e) => e.textContent)).includes('VexFlow'), 'ライセンスの表記が無い');
});

await scenario('明るさの切り替え', async () => {
  await open('#/', base({ global: { naming: 'doremi', sound: true, keyHints: true, volume: 0.7, midi: false, theme: 'dark' } }));
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '暗い画面にならない');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg === 'rgb(20, 21, 24)', `背景の色が暗くない: ${bg}`);
});

await scenario('フォーカスのあるリンクで Enter を押しても、ゲームは始まらない', async () => {
  await open('#/game/flash', base());
  await page.focus('a.back');
  await page.keyboard.press('Enter');
  await sleep(300);
  expect((await count('a.gamecard')) >= 7, 'ホームへ戻らない（Enter がゲームに取られた）');
});

await scenario('フラッシュ：答え終えた直後の ⌫ で答えが欠けない', async () => {
  await open('#/game/flash', base({ mode: { flash: { style: 'free', count: 3, ms: 150, startLevel: '0', flashSound: false } } }));
  await start();
  expect(await waitFor(async () => (await count('.pad .key')) === 7 && !(await page.$('.below.waiting'))), '答えのボタンが出ない');
  for (const k of ['c', 'd', 'e']) await page.keyboard.press(k);
  await page.keyboard.press('Backspace');
  expect(await waitFor(async () => (await count('.qcard')) === 3), '結果が出ない');
  expect(!(await page.$eval('.qcards', (e) => e.textContent)).includes('undefined'), '答えが欠けている（undefined）');
});

await scenario('即答を途中でやめた回は記録にしない', async () => {
  await open('#/game/quick', base({ mode: { quick: { length: 'time30', feedback: 'fast' } } }));
  await start();
  await page.keyboard.press('c');
  await sleep(300);
  await page.keyboard.press('Escape');
  expect(await waitFor(async () => !!(await page.$('.result'))), '結果が出ない');
  const head = await page.$eval('.result h2', (e) => e.textContent);
  expect(head.includes('途中まで') && !head.includes('自己ベスト'), `見出しがおかしい: ${head}`);
});

await scenario('オフラインでも開ける（Service Worker）', async () => {
  await open('#/', base());
  const ok = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-sw';
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return reg ? 'ready' : 'timeout';
  });
  expect(ok === 'ready', `Service Worker が動かない: ${ok}`);
  await page.reload({ waitUntil: 'load' }); // 制御下に入る
  await page.setOfflineMode(true);
  try {
    await page.reload({ waitUntil: 'load' });
    expect((await count('a.gamecard')) >= 7, 'オフラインでホームが出ない');
    await page.evaluate(() => { location.hash = '#/game/flash'; });
    await sleep(300);
    await start();
    expect(await waitFor(async () => (await count('.stage svg')) === 1, 5000), 'オフラインで五線が出ない');
  } finally {
    await page.setOfflineMode(false);
  }
});

await scenario('途中で画面を離れても後を引かない', async () => {
  await open('#/game/flash', base({ mode: { flash: { style: 'free', count: 10, ms: 400, startLevel: '0', flashSound: true } } }));
  await start();
  await sleep(1500);
  await page.evaluate(() => { location.hash = '#/'; });
  await sleep(300);
  const html = await page.$eval('main', (e) => e.innerHTML);
  await sleep(4000);
  expect(html === (await page.$eval('main', (e) => e.innerHTML)), 'ホームに戻ったあとも画面が書き換わる');
  expect((await count('a.gamecard')) >= 7, 'ホームが出ていない');
});

await scenario('壊れた保存データでも開ける', async () => {
  for (const bad of [
    '{not json',
    JSON.stringify({ gen: { reading: { clefs: [], range: 'nope', answer: 'x' }, interval: { set: [] }, chord: { set: ['zzz'] } }, mode: { quick: { length: 'bad' }, flash: { count: 'x', ms: -5 }, battle: { field: 'zzz', look: 9, flashMs: 'x', speed: 'warp', course: null } } }),
    JSON.stringify({ global: null, gen: null, stats: { read: { 'tenor:abc': { n: 'x' } } } }),
  ]) {
    await open('#/', bad);
    expect((await count('a.gamecard')) >= 7, `ホームが出ない: ${bad.slice(0, 30)}`);
    for (const g of ['flash', 'quick', 'interval', 'chord', 'rhythm', 'tap', 'battle']) {
      await page.evaluate((h) => { location.hash = h; }, `#/game/${g}`);
      await sleep(150);
      expect(!!(await page.$('.actions.sticky .btn.primary')), `${g} の設定画面が出ない`);
    }
    await page.evaluate(() => { location.hash = '#/stats'; });
    await sleep(150);
  }
});

await scenario('MIDI 鍵盤：あとからつないでも使え、設定の画面に受け取った音が出て、オトバトルで撃てる', async () => {
  await open('#/settings', base({ global: { naming: 'doremi', sound: false, keyHints: true, volume: 0.7, midi: true } }));
  expect(await waitFor(async () => (await text('.midi-status'))?.includes('見つかりません')), '鍵盤が無いときの知らせが出ない');
  await page.evaluate(() => window.__midi.plug('テスト鍵盤'));
  expect(await waitFor(async () => (await text('.midi-status'))?.includes('テスト鍵盤')), 'あとからつないだ鍵盤が出ない');
  await page.evaluate(() => window.__midi.send(60));
  expect(await waitFor(async () => (await text('.midi-note'))?.includes('MIDI 60')), '受け取った音が出ない');
  // オトバトル：鍵盤の音で撃てる（ド〜シを順に）
  await page.evaluate(() => { location.hash = '#/game/battle'; });
  await sleep(300);
  await page.evaluate(() => {
    const k = 'onpu-beat-flash.v1';
    const st = JSON.parse(localStorage.getItem(k));
    st.gen.reading = { clefs: ['treble'], range: 'staff', accidentals: 'none', answer: 'name', weak: false };
    st.mode.battle = { field: 'fall', course: 'set', length: 's3', speed: 'fast', look: 'always', flashMs: 900, pad: 'keys', hint: false, colors: false, pitch: false };
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => window.__midi.plug('テスト鍵盤'));
  await start();
  expect(await waitFor(async () => (await count('canvas.battle-canvas')) === 1, 5000), '戦場が出ない');
  const score = () => page.$eval('.scoreline b', (e) => Number(e.textContent.replace(/\D/g, '')));
  const hit = await waitFor(async () => {
    for (const n of [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77]) {
      await page.evaluate((m) => window.__midi.send(m), n);
      await sleep(480);
      if ((await score()) > 0) return true;
    }
    return false;
  }, 30000, 0);
  expect(hit, '鍵盤の音で倒せない');
});

await scenario('オトバトル（フラッシュ・おまかせ）：音符が「?」になり、Space でもう一度見られる', async () => {
  await open('#/game/battle', base({
    gen: { reading: { clefs: ['tenor'], range: 'staff', accidentals: 'none', answer: 'name', weak: false } },
    mode: { battle: { field: 'fall', course: 'set', length: 's3', speed: 'auto', look: 'flash', flashMs: 300, pad: 'keys', hint: false, colors: false, pitch: true } },
  }));
  await start();
  expect(await waitFor(async () => (await page.$eval('.battle-banner', (e) => e.textContent)).includes('Space'), 4000), 'フラッシュの説明が出ない');
  await sleep(5000);
  await page.keyboard.press('Space');
  await sleep(200);
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await page.evaluate(() => [...document.querySelectorAll('.battle-pause .btn')].find((b) => b.textContent.includes('やめる')).click());
  expect(await waitFor(async () => !!(await page.$('.result'))), '結果の画面にならない');
  const res = await page.$eval('.result', (e) => e.textContent);
  expect(res.includes('もう一度見た') && res.includes('最後の速さ') && res.includes('おまかせ'), '結果にフラッシュ・おまかせの数字が無い');
  const peeks = await page.$eval('.result-line [data-k="もう一度見た"] b', (e) => e.textContent).catch(() => null);
  expect(peeks === '2', `もう一度見た回数が 2 でない: ${peeks}`);
});

await scenario('スマホの幅で、どのゲームの設定の画面も横にはみ出さない', async () => {
  // 長い選択肢（加線1本まで（テノール A2–A4・アルト C3–C5）など）が出るように、音部記号を 2 つにしておく
  await open('#/', base({ gen: { reading: { clefs: ['tenor', 'alto'], range: 'ledger1', accidentals: 'both', answer: 'piano', weak: false } } }));
  for (const g of ['flash', 'quick', 'interval', 'chord', 'rhythm', 'battle', 'tap', 'pitch']) {
    await page.evaluate((x) => { location.hash = x; }, `#/game/${g}`);
    await sleep(200);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw <= cw, `${g} の設定が横にはみ出す（${sw} > ${cw}）`);
  }
});

await scenario('オトバトル（横向きのスマホ）：戦場と答えが左右に並び、描く大きさが見えている大きさと同じ', async () => {
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  try {
    await open('#/game/battle', base({
      gen: { reading: { clefs: ['tenor'], range: 'ledger1', accidentals: 'both', answer: 'name', weak: false } },
      mode: { battle: { field: 'around', course: 'set', length: 's3', speed: 'normal', look: 'always', flashMs: 900, pad: 'buttons', hint: false, colors: false, pitch: true } },
    }));
    await start();
    expect(await waitFor(async () => (await count('canvas.battle-canvas')) === 1, 5000), '戦場が出ない');
    await sleep(300);
    const m = await page.evaluate(() => {
      const c = document.querySelector('canvas.battle-canvas').getBoundingClientRect();
      const p = document.querySelector('.pad').getBoundingClientRect();
      const cv = document.querySelector('canvas.battle-canvas');
      return { cw: c.width, ch: c.height, iw: cv.width / Math.min(devicePixelRatio, 2), ih: cv.height / Math.min(devicePixelRatio, 2), padLeft: p.left, canvasRight: c.right, padBottom: p.bottom, vh: innerHeight, grid: document.querySelectorAll('.pad-grid12 .key').length };
    });
    expect(Math.abs(m.iw - m.cw) < 2 && Math.abs(m.ih - m.ch) < 2, `描く大きさがずれている ${JSON.stringify(m)}`);
    expect(m.padLeft >= m.canvasRight - 1, `答えが戦場の右にない ${JSON.stringify(m)}`);
    expect(m.padBottom <= m.vh + 1, '答えが画面からはみ出す');
    expect(m.grid === 12, '「ボタン」で 12 音のボタンにならない');
  } finally {
    await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 1, hasTouch: false });
  }
});

// ------------------------------------------------------------
await browser.close();
await server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} / ${results.length} 通過`);
process.exit(failed ? 1 : 0);
