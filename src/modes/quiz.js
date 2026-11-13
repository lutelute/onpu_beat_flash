// 1 問ずつ答える遊び方。譜面の問題（即答）にも音の問題（聞き取り）にも使う
import { h, fmtSec, typingInField, onControl } from '../ui/dom.js';
import { makePad } from '../ui/pads.js';
import { onMidiNote, onChord } from '../ui/midi.js';
import { makeRng, newSeed } from '../core/rng.js';
import { getSettings, saveSettings, globalSettings, recordAnswer, getRecord, offerRecord } from '../core/store.js';
import { playEvents, stopAll, sfx } from '../render/audio.js';
import { COLOR } from '../render/staff.js';
import { promptSVG, breakdown, summary, setupScreen, shareButton, spaceOf, snapshotWeights, weightFn, phase, resultScreen } from './common.js';
import { icon } from '../ui/icons.js';
import { readShared } from './share.js';

export const LENGTHS = {
  count10: { label: '10問', count: 10 },
  count20: { label: '20問', count: 20 },
  count50: { label: '50問', count: 50 },
  time30: { label: '30秒', sec: 30 },
  time60: { label: '60秒', sec: 60 },
  endless: { label: 'エンドレス' },
};

const modeFields = (game) => () => [
  { key: 'length', type: 'segmented', label: '長さ', options: game.lengths.map((id) => ({ id, label: LENGTHS[id].label })) },
  {
    key: 'feedback', type: 'segmented', label: '答えたあと',
    options: [
      { id: 'fast', label: 'テンポよく次へ' },
      { id: 'study', label: '止まって確かめる' },
    ],
  },
];

// 記録：時間の部は正解数が多いほど、問題数の部は全問の時間が短いほど上
const recordKey = (game, gen, gs, ms) => `quiz|${game.id}|${ms.length}|${gen.signature(gs)}`;
const recordText = (r, ms) => (!r ? 'まだ記録なし' : LENGTHS[ms.length].sec ? `正解 ${r.ok}（ミス ${r.ng}）` : `${r.ok}問正解・${(r.time / 1000).toFixed(1)}秒`);

export function mountQuiz(root, { game, gen, life, query }) {
  const FIELDS = modeFields(game);
  let gs = getSettings('gen', gen.id, gen.defaults, gen.fields);
  let ms = getSettings('mode', game.id, game.modeDefaults, FIELDS);
  // 共有リンクで来たら、その設定にして、はじめの 1 回はその問題番号で出す
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
  const setupBase = {
    root, game, gen, modeFields: FIELDS,
    get: () => ({ gs, ms }),
    set: (p) => {
      if (p.gs) saveSettings('gen', gen.id, (gs = p.gs));
      if (p.ms) saveSettings('mode', game.id, (ms = p.ms));
    },
  };

  setup();

  // ---------------- 設定 ----------------
  function setup() {
    setupScreen({
      ...setupBase, L: life.child(), modeTitle: '進め方', sharedSeed,
      info: () => {
        const best = ms.length === 'endless' ? '' : `自己ベスト（この設定）: ${recordText(getRecord(recordKey(game, gen, gs, ms)), ms)}`;
        // コード聞き取りは、楽器で和音を弾いても答えられる（マイク・MIDI 鍵盤がオンのとき）
        const g = globalSettings();
        const how = gen.id === 'chord' && (g.mic || g.midi) ? `聞いた和音を${g.mic ? '楽器（マイク）' : ''}${g.mic && g.midi ? 'や ' : ''}${g.midi ? 'MIDI 鍵盤' : ''}で弾いても答えられます（どの高さで弾いても、種類が合えば正解）` : '';
        return [best, how].filter(Boolean).join('\n');
      },
      onStart: () => run(takeSeed()),
    });
  }

  // ---------------- 出題 ----------------
  // weights: 「同じ問題でもう一度」のときは前回の重みの写しを使う（同じ並びになる）
  function run(seed, weights = snapshotWeights(gen, gs)) {
    const L = life.child();
    phase('run');
    const g = globalSettings();
    const space = spaceOf(gen, gs);
    const len = LENGTHS[ms.length];
    const rng = makeRng(seed);
    const log = [];
    let prev = null;
    let q = null;
    let t0 = 0;
    let state = 'wait'; // ask → 答え待ち / shown → 答え合わせ中 / done
    let advanceTimer = 0;
    let asked = 0; // 出した問題の数（いま何問目か）
    const startAt = performance.now();

    const progress = h('div', { class: 'progress' });
    // 上の細い棒：時間の部は残り時間、問題数の部は進み具合
    const bar = h('div', { class: len.sec ? 'timebar' : 'pbar' }, h('span'));
    const score = h('div', { class: 'scoreline' });
    const stage = h('div', { class: 'stage' });
    const reveal = h('div', { class: 'reveal', 'aria-live': 'polite' });
    const controls = h('div', { class: 'controls' });
    const pad = makePad(gen.answerPad(gs), { naming: g.naming, keyHints: g.keyHints, onAnswer: answer });

    root.replaceChildren(...[
      h('div', { class: 'runbar' }, progress, score, h('button', { class: 'btn ghost small', onclick: () => finish(false) }, 'やめる', h('kbd', {}, 'Esc'))),
      len.sec || len.count ? bar : null,
      stage, reveal, pad.el, controls,
    ].filter(Boolean));

    const updateTop = () => {
      const ok = log.filter((r) => r.ok).length;
      score.innerHTML = `<b class="ok">○ ${ok}</b>　<b class="ng">× ${log.length - ok}</b>`;
      if (len.count) {
        progress.textContent = `${asked} / ${len.count}`;
        bar.firstChild.style.width = `${(100 * log.length) / len.count}%`;
      }
      else if (!len.sec) progress.textContent = `${asked}問目`;
    };

    if (len.sec) {
      const tick = () => {
        if (!L.alive || state === 'done') return;
        const left = Math.max(0, len.sec * 1000 - (performance.now() - startAt));
        progress.textContent = `残り ${Math.ceil(left / 1000)}秒`;
        bar.firstChild.style.width = `${(100 * left) / (len.sec * 1000)}%`;
        if (left <= 0) finish(true);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    const play = () => {
      if (q?.prompt.type !== 'audio') return;
      stopAll();
      stage.classList.remove('playing');
      void stage.offsetWidth;
      stage.classList.add('playing');
      const dur = playEvents(q.prompt.events);
      L.timeout(() => stage.classList.remove('playing'), dur * 1000);
    };

    // 聞き直しのボタンは押したらフォーカスを外す（そのあとの Enter・Space が「次へ」「聞く」になるように）
    const playAndBlur = (e) => {
      e?.currentTarget?.blur?.();
      play();
    };

    function next() {
      L.clear(advanceTimer);
      if (len.count && log.length >= len.count) return finish(true);
      stopAll();
      q = gen.make(gs, { rng, prev, weight: weightFn(weights) });
      prev = q;
      asked++;
      pad.clear();
      pad.setEnabled(true);
      reveal.replaceChildren();
      reveal.className = 'reveal';
      controls.replaceChildren();
      stage.className = `stage ${q.prompt.type}`;
      if (q.prompt.type === 'staff') {
        stage.innerHTML = promptSVG(q);
      } else {
        stage.replaceChildren(h('button', { class: 'listen', onclick: playAndBlur, 'aria-label': 'もう一度聞く' },
          h('span', { class: 'ring' }), h('span', { html: icon('play') }), h('span', { class: 'txt' }, 'もう一度聞く'), h('kbd', {}, 'Space')));
        L.timeout(play, 250);
      }
      updateTop();
      state = 'ask';
      t0 = performance.now();
    }

    function answer(id) {
      if (state !== 'ask') return;
      state = 'shown';
      const ok = id === q.answer;
      const dt = performance.now() - t0;
      recordAnswer(space, q.key, { ok, ms: dt, given: id });
      log.push({ q, id, ok, ms: dt });
      pad.mark(id, ok ? 'ok' : 'ng');
      if (!ok) pad.mark(q.answer, 'ok');
      pad.setEnabled(false);
      stage.classList.add(ok ? 'is-ok' : 'is-ng');
      if (q.prompt.type === 'staff') {
        stage.innerHTML = promptSVG(q, ok ? COLOR.ok : COLOR.ng);
        if (g.sound) {
          stopAll();
          playEvents(q.sound);
          if (!ok) sfx('ng');
        }
      }
      // 判定の文：大きく正解、小さくあなたの答え
      reveal.className = `reveal ${ok ? 'ok' : 'ng'}`;
      reveal.replaceChildren(...[
        h('span', { class: 'r-main' }, `${ok ? '✓' : '×'} ${q.reveal(g.naming)}`),
        ok ? null : h('span', { class: 'r-sub' }, `あなたの答え: ${gen.answerLabel(id, gs, g.naming)}`),
      ].filter(Boolean)); // replaceChildren は null を「null」という文字にしてしまうので除く
      updateTop();

      if (ms.feedback === 'fast') {
        advanceTimer = L.timeout(next, ok ? 160 : 1100);
        return;
      }
      // 止まって確かめる：音の問題なら聞き比べられる
      const btns = [];
      if (q.prompt.type === 'audio') {
        btns.push(h('button', { class: 'btn', onclick: playAndBlur }, '正解を聞く'));
        if (!ok && q.compare) btns.push(h('button', { class: 'btn', onclick: (e) => { e.currentTarget.blur(); stopAll(); playEvents(q.compare(id)); } }, `「${gen.answerLabel(id, gs, g.naming)}」を聞く`));
      }
      btns.push(h('button', { class: 'btn primary', onclick: next }, '次へ', h('kbd', {}, 'Enter')));
      controls.replaceChildren(...btns);
      if (ok) advanceTimer = L.timeout(next, 1400);
    }

    // done: 最後まで（時間切れ・全問）やったか。途中でやめた回は記録にしない
    function finish(done) {
      if (state === 'done') return;
      state = 'done';
      stopAll();
      L.end();
      result(log, seed, { done, weights });
    }

    L.on(window, 'keydown', (e) => {
      if (typingInField(e)) return;
      if (e.key === 'Escape') return finish(false);
      if ((e.key === ' ' || e.key === 'Enter') && (onControl(e) || e.repeat)) return; // ボタンなどの上ではその部品に任せる
      if (e.key === ' ' && q?.prompt.type === 'audio') {
        e.preventDefault();
        return play();
      }
      if (e.key === 'Enter' && state === 'shown') {
        e.preventDefault();
        return next();
      }
      if (state === 'ask' && pad.handleKey(e)) e.preventDefault();
    });

    onMidiNote(L, (m) => state === 'ask' && pad.handleMidi(m));
    // コード聞き取り：楽器（マイク）や MIDI 鍵盤で和音を弾いて答えられる。弾いた和音の種類が答え
    // （同じ音の組み合わせになる読みが出す種類の中にあれば、それで答える。出す種類の中から選ぶ）
    if (gen.id === 'chord') {
      onChord(L, (c) => {
        if (state !== 'ask') return;
        answer(c.alts.includes(q.answer) ? q.answer : c.quality);
      }, { allow: gs.set });
    }
    next();
  }

  // ---------------- 結果 ----------------
  function result(log, seed, { done, weights }) {
    const L = life.child();
    const g = globalSettings();
    const s = summary(log);
    const len = LENGTHS[ms.length];
    let isNew = false;
    const total = log.reduce((t, r) => t + r.ms, 0);
    const finished = done && (len.sec || len.count);
    if (finished && log.length) {
      const rec = len.sec ? { ok: s.ok, ng: s.ng } : { ok: s.ok, ng: s.ng, time: total };
      isNew = offerRecord(recordKey(game, gen, gs, ms), rec); // 比べ方は core/sync.js の betterRecord
    }
    const perfect = finished && s.n > 0 && s.rate === 100;
    const best = getRecord(recordKey(game, gen, gs, ms));
    resultScreen({
      root, L,
      pass: perfect,
      title: perfect ? '全問正解！' : !done ? '途中までの結果' : s.rate >= 90 ? 'よくできました' : s.rate >= 70 ? 'もう少し' : '結果',
      sub: s.n === 0 ? 'まだ答えていません' : len.sec ? `${len.label}で ${s.ok}問 正解` : `${s.n}問中 ${s.ok}問 正解`,
      badge: isNew ? '自己ベスト更新' : null,
      tiles: s.n ? [
        ['正答率', `${s.rate}%`, s.rate >= 90 ? 'ok' : ''],
        ['正解', `${s.ok}`],
        s.avg != null ? ['正解までの平均', fmtSec(s.avg)] : null,
        ['まちがい', `${s.ng}`, 'dim'],
      ] : null,
      body: [breakdown(gen, gs, log, g.naming)],
      primary: ['もう一度', () => run(newSeed())],
      secondary: [['同じ問題で再挑戦', () => run(seed, weights)], ['設定を変える', setup]],
      foot: [
        ms.length === 'endless' ? null : h('span', {}, `自己ベスト: ${recordText(best, ms)}`),
        shareButton(game, gs, ms, seed),
      ],
    });
  }
}
