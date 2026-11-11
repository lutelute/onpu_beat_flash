// リズム練習：リズム譜を見て、メトロノームに合わせて音符のところで叩く
// 1 問 = 1〜4 小節。数え（1 小節）→（お手本）→ 数え → あなたの番。判定は譜読みリズムと同じ rhythmEngine
import { h, typingInField } from '../ui/dom.js';
import { onMidiNote } from '../ui/midi.js';
import { makeRng, newSeed } from '../core/rng.js';
import { getSettings, saveSettings, globalSettings, recordAnswer, getRecord, offerRecord } from '../core/store.js';
import { audioReady, audioNow, clickAt, clapAt, stopAll, sfx } from '../render/audio.js';
import { COLOR } from '../render/staff.js';
import { renderRhythm } from '../render/rhythmScore.js';
import { makeRhythmEngine, WINDOWS } from '../core/rhythmEngine.js';
import { setupScreen, shareButton, spaceOf, snapshotWeights, weightFn, phase, resultScreen, rateCell } from './common.js';
import { readShared } from './share.js';

const COUNT = { n4: { label: '4問', n: 4 }, n8: { label: '8問', n: 8 }, n16: { label: '16問', n: 16 }, endless: { label: 'エンドレス', n: Infinity } };
const GRADE_COLOR = { perfect: COLOR.ok, great: COLOR.ok, good: COLOR.warn, miss: COLOR.ng };
const GRADE_LABEL = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };

const modeFields = () => [
  { key: 'bpm', type: 'slider', label: 'テンポ', min: 40, max: 160, step: 4, format: (v) => `♩ = ${v}` },
  { key: 'count', type: 'segmented', label: '問題の数', options: Object.entries(COUNT).map(([id, c]) => ({ id, label: c.label })) },
  { key: 'listen', type: 'toggle', label: 'お手本を先に聞く', note: 'はじめにお手本が鳴り、そのあと 1 小節数えてからあなたの番です' },
  { key: 'metronome', type: 'toggle', label: 'メトロノーム' },
  {
    key: 'offset', type: 'slider', label: 'タイミングの調整', min: -200, max: 200, step: 10,
    format: (v) => (v === 0 ? '0 ミリ秒' : `${v > 0 ? '+' : ''}${v} ミリ秒`),
    note: 'いつも「遅め」と出るならプラスへ（Bluetooth のイヤホンは音が遅れがち）',
  },
];

const recordKey = (gen, gs, ms) => `tap|${gen.signature(gs)}|${ms.bpm}|${ms.count}`;

export function mountTap(root, { game, gen, life, query }) {
  const FIELDS = modeFields;
  let gs = getSettings('gen', gen.id, gen.defaults, gen.fields);
  let ms = getSettings('mode', game.id, game.modeDefaults, FIELDS);
  const shared = readShared(query, { gen, game, modeFields: FIELDS });
  let sharedSeed = null;
  if (shared) {
    ({ gs, ms } = shared);
    saveSettings('gen', gen.id, gs);
    saveSettings('mode', game.id, ms);
    sharedSeed = shared.seed;
  }
  const takeSeed = () => {
    const s = sharedSeed ?? newSeed();
    sharedSeed = null;
    return s;
  };

  setup();

  function setup() {
    setupScreen({
      root, game, gen, modeFields: FIELDS, L: life.child(), modeTitle: '進め方', sharedSeed,
      get: () => ({ gs, ms }),
      set: (p) => {
        if (p.gs) saveSettings('gen', gen.id, (gs = p.gs));
        if (p.ms) saveSettings('mode', game.id, (ms = p.ms));
      },
      info: () => {
        const r = getRecord(recordKey(gen, gs, ms));
        return ms.count === 'endless' ? '' : `自己ベスト（この設定）: ${r == null ? 'まだ記録なし' : `${r}%`}`;
      },
      onStart: () => run(takeSeed()),
    });
  }

  // ---------------- 叩く ----------------
  async function run(seed, weights = snapshotWeights(gen, gs)) {
    const L = life.child();
    phase('run');
    const g = globalSettings();
    const space = spaceOf(gen, gs);
    root.replaceChildren(h('p', { class: 'lead center' }, '準備しています…'));
    const sound = await audioReady();
    if (!L.alive) return;
    const clock = sound ? audioNow : () => performance.now() / 1000;
    const rng = makeRng(seed);
    const beat = 60 / ms.bpm;
    const offset = ms.offset / 1000;
    const total = COUNT[ms.count].n;
    const log = []; // { cell, grade, dt }
    let extra = 0;
    let ended = false;
    let prev = null;
    let done = 0;

    const progress = h('div', { class: 'progress' });
    const status = h('div', { class: 'tap-status' });
    const score = h('div', { class: 'score tapscore' });
    const stage = h('div', { class: 'stage tapstage' }, status, score);
    const count = h('div', { class: 'overlay' });
    const pop = h('div', { class: 'tap-pop', 'aria-live': 'polite' });
    const tapBtn = h('button', { class: 'tapbtn', type: 'button', 'aria-label': '叩く' },
      h('span', {}, 'ここを叩く'), h('kbd', {}, 'Space'));
    root.replaceChildren(
      h('div', { class: 'runbar' }, progress, h('button', { class: 'btn ghost small', onclick: () => finish(false) }, 'やめる', h('kbd', {}, 'Esc'))),
      h('div', { class: 'pbar' }, h('span')),
      h('div', { class: 'stage-wrap' }, stage, count),
      pop,
      tapBtn,
    );
    const perRow = root.clientWidth < 560 ? 1 : 2;
    // 開発中だけ、自動テストから判定を覗けるようにする
    if (import.meta.env?.DEV) window.__tap = { get eng() { return eng; }, clock, offset };

    let eng = null; // いまの問題の判定（あなたの番のときだけ）
    let cur = null; // { q, r, notes, timeline }
    const showPop = (text, color) => {
      pop.textContent = text;
      pop.style.color = color;
      pop.classList.remove('go');
      void pop.offsetWidth;
      pop.classList.add('go');
    };

    function tap() {
      if (ended) return;
      tapBtn.classList.remove('hit');
      void tapBtn.offsetWidth;
      tapBtn.classList.add('hit');
      if (!eng) return;
      const r = eng.press('tap', clock() - offset);
      if (!r) {
        extra++;
        showPop('…', COLOR.mute);
        return;
      }
      judged(r);
    }
    function judged({ note, grade, dt }) {
      const n = cur.notes[note.item.i];
      if (n?.el) n.el.style.color = GRADE_COLOR[grade];
      log.push({ cell: note.item.cell, grade, dt });
      recordAnswer(space, note.item.cell, { ok: grade !== 'miss', ms: grade !== 'miss' ? Math.abs(dt) * 1000 + 1 : undefined });
      const timing = grade === 'great' || grade === 'good' ? (dt < 0 ? ' 早め' : ' 遅め') : '';
      showPop(GRADE_LABEL[grade] + timing, GRADE_COLOR[grade]);
    }

    // 1 問ぶんの流れ（時刻はすべて clock の秒）
    async function playOne() {
      const q = gen.make(gs, { rng, prev, weight: weightFn(weights) });
      prev = q;
      const r = renderRhythm(score, q.prompt, perRow);
      const perBar = q.prompt.beats; // 1 小節の拍
      const bars = q.prompt.measures.length;
      const t0 = clock() + 0.35;
      const listenStart = t0 + perBar * beat; // 数えのあと
      const youStart = ms.listen ? listenStart + (bars + 1) * beat * bpm : listenStart; // お手本のあと、もう 1 小節数える
      const end = youStart + bars * perBar * beat;
      cur = { q, r, notes: r.notes };
      // メトロノームと、お手本の音を予約
      if (sound) {
        for (let t = t0, k = 0; t < end - 1e-6; t += beat, k++) if (ms.metronome || t < listenStart || (ms.listen && t >= listenStart + bars * perBar * beat && t < youStart)) clickAt(t, k % perBar === 0);
        if (ms.listen) for (const o of q.onsets) clapAt(listenStart + o.beat * beat);
      }
      // あなたの番の判定
      eng = makeRhythmEngine({ windows: WINDOWS });
      q.onsets.forEach((o, i) => eng.add({ answer: 'tap', i, cell: o.cell }, youStart + o.beat * beat));
      progress.textContent = Number.isFinite(total) ? `${done + 1} / ${total}` : `${done + 1}問目`;

      // 画面：縦の線・数え・いまの場面
      await new Promise((resolve) => {
        const frame = () => {
          if (!L.alive || ended) return resolve();
          const now = clock();
          eng.sweep(now - offset).forEach(judged);
          let label = '';
          let b = null;
          if (now < listenStart) label = '数えて…';
          else if (ms.listen && now < listenStart + bars * perBar * beat) { label = 'お手本'; b = (now - listenStart) / beat; }
          else if (now < youStart) label = 'あなたの番（数えて…）';
          else if (now < end) { label = 'あなたの番'; b = (now - youStart) / beat; }
          status.textContent = label;
          status.className = `tap-status${label.startsWith('あなた') ? ' you' : ''}`;
          // 数え（あなたの番の前の 1 小節と、はじめの 1 小節）
          const cdTarget = now < listenStart ? listenStart : now < youStart && now >= youStart - perBar * beat ? youStart : null;
          const left = cdTarget ? Math.ceil((cdTarget - now) / beat) : 0;
          count.textContent = left > 0 ? String(left) : '';
          count.className = left > 0 ? 'overlay show soft' : 'overlay';
          if (b != null) {
            const p = r.at(b);
            r.playhead.setAttribute('x1', p.x); r.playhead.setAttribute('x2', p.x);
            r.playhead.setAttribute('y1', p.y1); r.playhead.setAttribute('y2', p.y2);
            r.playhead.style.opacity = 1;
          } else r.playhead.style.opacity = 0;
          if (now > end + WINDOWS.good + 0.05) return resolve();
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      eng.sweep(Infinity).forEach(judged);
      eng = null;
      done++;
      root.querySelector('.pbar span').style.width = Number.isFinite(total) ? `${(100 * done) / total}%` : '0';
    }

    function finish(completed, note) {
      if (ended) return;
      ended = true;
      stopAll();
      L.end();
      result(seed, { log, extra, completed, weights, note });
    }

    tapBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tap();
    });
    L.on(window, 'keydown', (e) => {
      if (typingInField(e) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') return finish(false);
      // Space・Enter・文字のキーで叩く（Tab などは除く）
      if (e.key === ' ' || e.key === 'Enter' || /^[a-z0-9]$/i.test(e.key)) {
        e.preventDefault();
        tap();
      }
    });
    L.on(document, 'visibilitychange', () => {
      if (document.hidden) finish(false, '画面を離れたので止めました。');
    });
    onMidiNote(L, () => tap());

    while (!ended && done < total) {
      await playOne();
      if (!L.alive || ended) return;
      // 次の問題の前に少し間
      if (!(await L.sleep(500))) return;
    }
    finish(true);
  }

  // ---------------- 結果 ----------------
  function result(seed, { log, extra, completed, weights, note }) {
    const L = life.child();
    const g = globalSettings();
    const tally = { perfect: 0, great: 0, good: 0, miss: 0 };
    for (const r of log) tally[r.grade]++;
    const n = log.length;
    const pts = tally.perfect * 3 + tally.great * 2 + tally.good;
    const acc = n ? Math.round((100 * pts) / (3 * n)) : 0;
    let isNew = false;
    if (completed && Number.isFinite(COUNT[ms.count].n) && n) isNew = offerRecord(recordKey(gen, gs, ms), acc);
    if (completed && g.sound) sfx(tally.miss === 0 && n ? 'fanfare' : 'ok');
    const hits = log.filter((r) => r.grade !== 'miss');
    const mean = hits.length ? (hits.reduce((s, r) => s + r.dt, 0) / hits.length) * 1000 : 0;
    const tendency = !hits.length ? '' : Math.abs(mean) < 20 ? 'ずれはほとんどありません' : `平均で ${Math.round(Math.abs(mean))} ミリ秒${mean > 0 ? '遅め' : '早め'}です`;
    // 型ごとの結果
    const byCell = new Map();
    for (const r of log) {
      const b = byCell.get(r.cell) || { n: 0, ok: 0, dt: 0 };
      b.n++;
      if (r.grade !== 'miss') {
        b.ok++;
        b.dt += r.dt;
      }
      byCell.set(r.cell, b);
    }
    const rows = [...byCell.entries()].sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
    const table = rows.length
      ? h('div', { class: 'breakdown' },
        h('h3', {}, 'リズムの型ごと'),
        h('div', { class: 'table-scroll' }, h('table', { class: 'bd-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '型'), h('th', {}, '正解'), h('th', {}, 'ずれ'))),
          h('tbody', {}, rows.map(([cell, b]) => h('tr', {},
            h('th', {}, gen.keyLabel(cell)),
            h('td', {}, rateCell(b.ok, b.n)),
            h('td', {}, b.ok ? `${b.dt / b.ok >= 0 ? '+' : ''}${Math.round((b.dt / b.ok) * 1000)}ms` : '—')))))))
      : null;
    const rec = getRecord(recordKey(gen, gs, ms));
    const full = completed && tally.miss === 0 && n > 0;
    resultScreen({
      root, L, pass: full,
      title: full ? 'ぜんぶ叩けました！' : completed ? (acc >= 90 ? 'よくできました' : '結果') : '途中までの結果',
      sub: [`♩ = ${ms.bpm}`, tendency].filter(Boolean).join('・'),
      badge: isNew ? '自己ベスト更新' : null,
      tiles: [
        ['正確さ', `${acc}%`, acc >= 90 ? 'ok' : ''],
        ['Perfect', `${tally.perfect}`, 'dim'],
        ['Great', `${tally.great}`, 'dim'],
        ['Good', `${tally.good}`, 'dim'],
        ['Miss', `${tally.miss}`, tally.miss ? 'ng' : 'dim'],
        ['空振り', `${extra}`, 'dim'],
      ],
      body: [note ? h('p', { class: 'notice' }, note) : null, table].filter(Boolean),
      primary: ['もう一度', () => run(newSeed())],
      secondary: [['同じ問題で再挑戦', () => run(seed, weights)], ['設定を変える', setup]],
      foot: [h('span', {}, `自己ベスト: ${rec == null ? '—' : `${rec}%`}`), shareButton(game, gs, ms, seed)],
    });
  }
}

