// フラッシュ（フラッシュ暗算の形）：音符が次々に光り、消えたあと出た順に答える
import { h, typingInField } from '../ui/dom.js';
import { makePad } from '../ui/pads.js';
import { onMidiNote } from '../ui/midi.js';
import { makeRng, newSeed } from '../core/rng.js';
import { getSettings, saveSettings, globalSettings, recordAnswer, getRecord, offerRecord } from '../core/store.js';
import { playEvents, stopAll, sfx } from '../render/audio.js';
import { staffSVG, COLOR } from '../render/staff.js';
import { promptSVG, setupScreen, shareButton, spaceOf, snapshotWeights, weightFn, phase, resultScreen } from './common.js';
import { icon } from '../ui/icons.js';
import { readShared } from './share.js';

// 検定の級。n = 音の数、ms = 1 音を見せる時間
export const LADDER = [
  { name: '10級', n: 3, ms: 1500 },
  { name: '9級', n: 3, ms: 1200 },
  { name: '8級', n: 4, ms: 1100 },
  { name: '7級', n: 4, ms: 900 },
  { name: '6級', n: 5, ms: 800 },
  { name: '5級', n: 5, ms: 650 },
  { name: '4級', n: 6, ms: 550 },
  { name: '3級', n: 7, ms: 480 },
  { name: '2級', n: 8, ms: 420 },
  { name: '1級', n: 8, ms: 360 },
  { name: '初段', n: 10, ms: 320 },
  { name: '二段', n: 10, ms: 270 },
  { name: '三段', n: 12, ms: 230 },
  { name: '四段', n: 12, ms: 200 },
  { name: '五段', n: 15, ms: 170 },
];

const sec = (ms) => `${(ms / 1000).toFixed(2)}秒`;

const modeFields = () => [
  {
    key: 'style', type: 'segmented', label: '遊び方',
    options: [{ id: 'free', label: '自由練習' }, { id: 'kentei', label: '検定（10級→五段）' }],
  },
  {
    key: 'display', type: 'segmented', label: '表示のしかた',
    options: [{ id: 'flash', label: '光って消える' }, { id: 'stay', label: '消えずに並ぶ' }],
    note: '消えずに並ぶ：音符が順に出て、そのまま五線に残ります。出そろったら見ながら順に答えます',
  },
  { key: 'count', type: 'stepper', label: '1回に出す音の数', min: 2, max: 20, format: (v) => `${v}音`, show: (s) => s.style === 'free' },
  { key: 'ms', type: 'slider', label: '1音を見せる時間', min: 150, max: 3000, step: 50, format: sec, show: (s) => s.style === 'free' },
  {
    key: 'startLevel', type: 'select', label: 'はじめる級', show: (s) => s.style === 'kentei',
    options: LADDER.map((l, i) => ({ id: String(i), label: `${l.name}（${l.n}音・1音${sec(l.ms)}）` })),
  },
  {
    key: 'flashSound', type: 'toggle', label: '光るときに音も鳴らす',
    note: '見た目と音の高さを結びつける練習に。音で答えが分かる人は切っておく',
  },
];

const kenteiKey = (gen, gs, ms) => `kentei|${gen.signature(gs)}${ms.flashSound ? '|sound' : ''}${ms.display === 'stay' ? '|stay' : ''}`;

const FOCUS = '#2b6cd6'; // 次に答える音符・いま出た音符の色
const PER_LINE = 8; // 消えずに並ぶとき、1 段に置く音の数

export function mountFlash(root, { game, gen, life, query }) {
  const FIELDS = modeFields;
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
      ...setupBase, L: life.child(), modeTitle: 'フラッシュ', sharedSeed,
      info: () => {
        const b = getRecord(kenteiKey(gen, gs, ms));
        return ms.style === 'kentei' ? `この設定での最高: ${b == null ? 'まだ合格なし' : LADDER[b].name}${ms.flashSound ? '（音つき）' : ''}` : '';
      },
      onStart: () => (ms.style === 'kentei' ? runLevel(Number(ms.startLevel), takeSeed()) : run({ n: ms.count, ms: ms.ms }, takeSeed())),
    });
  }

  const runLevel = (level, seed = newSeed(), weights) => run({ n: LADDER[level].n, ms: LADDER[level].ms, level }, seed, weights);

  // ---------------- 光らせる → 答える ----------------
  // weights: 「同じ問題でもう一度」のときは前回の重みの写しを使う（同じ並びになる）
  async function run(cfg, seed, weights = snapshotWeights(gen, gs)) {
    const L = life.child();
    phase('run');
    const g = globalSettings();
    const rng = makeRng(seed);
    const qs = [];
    let prev = null;
    for (let i = 0; i < cfg.n; i++) {
      prev = gen.make(gs, { rng, prev, weight: weightFn(weights) });
      qs.push(prev);
    }
    // 速く切り替えても遅れないよう、先に全部描いておく
    const stay = ms.display === 'stay';
    const frames = qs.map((q) => promptSVG(q));
    const blanks = qs.map((q) => staffSVG({ clef: q.prompt.clef, items: [], frame: q.prompt.frame }));
    // 消えずに並ぶ：upto 個目まで出した五線。focus 番目の音符に色を付ける
    // 音部記号が 1 つなら 8 音ごとの段に並べ、まざるなら 1 音ずつの小さな五線を並べる
    const oneClef = qs.every((q) => q.prompt.clef === qs[0].prompt.clef);
    const stayHTML = (upto, focus) => {
      const item = (q, i, slot) => ({ step: q.prompt.step, acc: q.prompt.acc, slot, color: i === focus ? FOCUS : undefined });
      if (oneClef) {
        const lines = [];
        for (let a = 0; a < qs.length; a += PER_LINE) lines.push(qs.slice(a, a + PER_LINE).map((q, k) => [q, a + k]));
        return lines.map((line) => `<div class="sys">${staffSVG({
          clef: qs[0].prompt.clef, frame: qs[0].prompt.frame, gap: 40, slots: Math.min(PER_LINE, qs.length),
          items: line.filter(([, i]) => i < upto).map(([q, i], k) => item(q, i, k)),
        })}</div>`).join('');
      }
      return `<div class="minis">${qs.map((q, i) => `<div class="mini${i === focus ? ' focus' : ''}">${staffSVG({
        clef: q.prompt.clef, frame: q.prompt.frame, width: 150, items: i < upto ? [item(q, i)] : [],
      })}</div>`).join('')}</div>`;
    };
    const gap = Math.round(Math.min(300, Math.max(70, cfg.ms * 0.25)));

    const title = cfg.level != null ? `${LADDER[cfg.level].name}　${cfg.n}音` : `${cfg.n}音`;
    const stage = h('div', { class: `stage staff flash${stay ? ' stay' : ''}` });
    const overlay = h('div', { class: 'overlay' });
    const dots = h('div', { class: 'dots' }, qs.map(() => h('span')));
    const slots = h('div', { class: 'slots' });
    const below = h('div', { class: 'below' });
    // いま何をする時間か（準備・見て覚える・答える）。待っているのか止まっているのか分からなくならないように
    const state = h('span', { class: 'flash-state', 'aria-live': 'polite' }, '準備');
    const hint = h('div', { class: 'hint' });
    root.replaceChildren(
      h('div', { class: 'runbar' }, h('div', { class: 'progress' }, title, state), h('button', { class: 'btn ghost small', onclick: () => { L.end(); stopAll(); setup(); } }, 'やめる', h('kbd', {}, 'Esc'))),
      h('div', { class: 'stage-wrap' }, stage, overlay),
      dots, slots, below,
    );
    L.on(window, 'keydown', (e) => {
      if (e.key === 'Escape') {
        L.end();
        stopAll();
        setup();
      }
    });

    // 答える部分は先に作っておき、光らせている間は押せないようにしておく
    const given = [];
    const canReplay = cfg.level == null && !stay; // 検定は一発勝負。消えない表示ではいらない
    let replays = 0;
    let gaveUp = false; // 「答えを見る」で答え合わせに進んだ
    let showing = true; // はじめは光らせる前。答えは受け付けない
    const drawSlots = () => {
      slots.replaceChildren(...qs.map((_, i) => h('span', { class: `slot${i === given.length ? ' cur' : ''}${given[i] != null ? ' filled' : ''}` },
        given[i] != null ? gen.answerLabel(given[i], gs, g.naming) : String(i + 1))));
      if (stay && !showing) stage.innerHTML = stayHTML(qs.length, given.length < qs.length ? given.length : -1);
      if (!showing) setState(`答える ${Math.min(given.length + 1, qs.length)}/${qs.length}`, 'answer');
    };
    function setState(text, cls) {
      state.textContent = text;
      state.className = `flash-state ${cls}`;
    }
    const pad = makePad(gen.answerPad(gs), {
      naming: g.naming, keyHints: g.keyHints,
      onAnswer: (id) => {
        if (showing || given.length >= qs.length) return;
        given.push(id);
        drawSlots();
        if (given.length === qs.length) {
          pad.setEnabled(false);
          L.timeout(() => { L.end(); judge(cfg, seed, qs, given, weights, replays, gaveUp); }, 220);
        }
      },
    });
    const undo = () => {
      if (showing || given.length >= qs.length) return; // 全部答えたあとは答え合わせに入るので消せない
      given.pop();
      drawSlots();
    };
    // もう一度見る：それまでに入れた答えは残したまま、もう一度光らせる
    const replay = () => {
      if (!canReplay || showing || given.length >= qs.length) return;
      replays++;
      flashAll(true);
    };
    // 答えを見る：そこまでの答えで答え合わせに進む（答えていないところは「答えなし」）
    const reveal = () => {
      if (showing || given.length >= qs.length) return;
      gaveUp = true;
      pad.setEnabled(false);
      L.end();
      judge(cfg, seed, qs, given, weights, replays, true);
    };
    below.replaceChildren(
      hint,
      pad.el,
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: undo }, 'ひとつ消す', h('kbd', {}, '⌫')),
        canReplay ? h('button', { class: 'btn ghost small', onclick: replay }, 'もう一度見る', h('kbd', {}, 'R')) : null,
        h('button', { class: 'btn ghost small', onclick: reveal }, '答えを見る')),
    );
    onMidiNote(L, (m) => !showing && pad.handleMidi(m));
    L.on(window, 'keydown', (e) => {
      if (typingInField(e) || showing) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        undo();
      } else if ((e.key === 'r' || e.key === 'R') && canReplay && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        replay();
      } else if (pad.handleKey(e)) e.preventDefault();
    });

    // 光らせる（again: もう一度見るときは数えを短く）
    async function flashAll(again = false) {
      showing = true;
      pad.setEnabled(false);
      below.classList.add('waiting');
      slots.classList.add('waiting');
      dots.classList.remove('done');
      for (const d of dots.children) d.classList.remove('on');
      stage.innerHTML = stay ? stayHTML(0, -1) : blanks[0];
      setState('準備', 'ready');
      hint.textContent = stay ? '音符が順に出ます。出そろったら答えます' : '音符が順に光ります。光った順に覚えてください';
      for (const c of again ? ['2', '1'] : ['3', '2', '1']) {
        overlay.textContent = c;
        overlay.className = 'overlay show';
        if (g.sound) sfx('tick');
        if (!(await L.sleep(450))) return;
      }
      overlay.className = 'overlay';
      if (!(await L.sleep(250))) return;
      for (let i = 0; i < qs.length; i++) {
        stage.innerHTML = stay ? stayHTML(i + 1, i) : frames[i];
        if (!stay) {
          stage.classList.remove('pop');
          void stage.offsetWidth;
          stage.classList.add('pop');
        }
        dots.children[i].classList.add('on');
        setState(`見て覚える ${i + 1}/${qs.length}`, 'look');
        if (ms.flashSound) {
          stopAll();
          playEvents(qs[i].sound);
        }
        if (!(await L.sleep(cfg.ms))) return;
        if (!stay) stage.innerHTML = blanks[i];
        if (!(await L.sleep(stay ? 0 : gap))) return;
      }
      // 答える
      showing = false;
      dots.classList.add('done');
      if (!stay) {
        overlay.textContent = '？';
        overlay.className = 'overlay show soft';
      }
      below.classList.remove('waiting');
      slots.classList.remove('waiting');
      hint.textContent = stay ? '青い音符から順に答えてください' : '出た順に答えてください';
      drawSlots();
      pad.setEnabled(true);
    }

    drawSlots();
    flashAll();
  }

  // ---------------- 答え合わせ ----------------
  function judge(cfg, seed, qs, given, weights, replays = 0, gaveUp = false) {
    const L = life.child();
    const g = globalSettings();
    const space = spaceOf(gen, gs);
    const marks = qs.map((q, i) => given[i] === q.answer);
    qs.forEach((q, i) => recordAnswer(space, q.key, { ok: marks[i], given: given[i] ?? null }));
    const okN = marks.filter(Boolean).length;
    const all = okN === qs.length;
    const kentei = cfg.level != null;
    let newBest = false;
    if (kentei && all) newBest = offerRecord(kenteiKey(gen, gs, ms), cfg.level);
    if (g.sound) sfx(all ? (kentei ? 'fanfare' : 'ok') : 'ng');

    const cards = qs.map((q, i) =>
      h('figure', { class: `qcard ${marks[i] ? 'ok' : 'ng'}` },
        h('div', { class: 'score', html: promptSVG(q, marks[i] ? COLOR.ok : COLOR.ng) }),
        h('figcaption', {},
          h('b', {}, q.reveal(g.naming),
            h('button', { class: 'play', 'aria-label': '音を聞く', html: icon('play'), onclick: () => { stopAll(); playEvents(q.sound); } })),
          marks[i] ? null : h('span', { class: 'yours' }, given[i] == null ? '（答えなし）' : `あなたの答え: ${gen.answerLabel(given[i], gs, g.naming)}`))));
    const body = [h('h3', {}, '出た順'), h('div', { class: 'qcards' }, cards)];
    const top = LADDER.length - 1;
    const tl = [
      ['正解', `${okN} / ${qs.length}`, all ? 'ok' : ''],
      ['1音', sec(cfg.ms)],
      replays ? ['もう一度見た', `${replays}回`, 'dim'] : null,
    ];

    if (kentei) {
      const lv = LADDER[cfg.level];
      const nextLv = LADDER[cfg.level + 1];
      resultScreen({
        root, L, pass: all,
        title: all ? `${lv.name} 合格！` : `${lv.name} 不合格`,
        sub: all
          ? (nextLv ? `次は ${nextLv.name}（${nextLv.n}音・1音${sec(nextLv.ms)}）` : 'いちばん上の段まで合格しました')
          : gaveUp ? '答えを見ました。この級をもう一度どうぞ' : `あと ${qs.length - okN}問で合格。全問正解で合格です`,
        badge: newBest ? '最高記録' : null,
        tiles: tl, body,
        primary: all && cfg.level < top ? ['次の級へ', () => runLevel(cfg.level + 1)] : ['もう一度この級', () => runLevel(cfg.level)],
        secondary: [
          all && cfg.level >= top ? null : ['10級から', () => runLevel(0)],
          ['設定を変える', setup],
        ],
        foot: [h('span', {}, `問題番号 #${seed}`), shareButton(game, gs, { ...ms, style: 'kentei', startLevel: String(cfg.level) }, seed)],
      });
    } else {
      const faster = Math.max(150, Math.round((cfg.ms * 0.85) / 10) * 10);
      resultScreen({
        root, L, pass: all,
        title: all ? '全問正解！' : `${qs.length}問中 ${okN}問 正解`,
        sub: all
          ? (replays ? `もう一度見て全問正解。次は見直さずに` : `次は少し速くしてみましょう（1音${sec(faster)}）`)
          : gaveUp ? '答えを見ました。下で出た順を確かめられます' : 'まちがえた音は下で確かめられます',
        tiles: tl, body,
        primary: ['もう一度', () => run(cfg, newSeed())],
        secondary: [
          all
            ? [`少し速く（${sec(faster)}）`, () => { ms = { ...ms, ms: faster }; saveSettings('mode', game.id, ms); run({ ...cfg, ms: faster }, newSeed()); }]
            : ['同じ問題で再挑戦', () => run(cfg, seed, weights)],
          ['設定を変える', setup],
        ],
        foot: [shareButton(game, gs, { ...ms, style: 'free', count: cfg.n, ms: cfg.ms }, seed)],
      });
    }
  }
}
