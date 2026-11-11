// リズム：右から流れてくる音符を、線に重なった瞬間に答える
// 時刻はすべて音の時計（audioNow）で決める。メトロノーム・表示・判定がずれないように
import { h, typingInField } from '../ui/dom.js';
import { makePad } from '../ui/pads.js';
import { onMidiNote } from '../ui/midi.js';
import { makeRng, newSeed } from '../core/rng.js';
import { CLEFS, RANGES } from '../core/music.js';
import { getSettings, saveSettings, globalSettings, recordAnswer, getRecord, offerRecord } from '../core/store.js';
import { audioReady, audioNow, clickAt, playEventsAt, stopAll, sfx } from '../render/audio.js';
import { staffSVG, glyphPath, STAFF, COLOR } from '../render/staff.js';
import { breakdown, setupScreen, shareButton, spaceOf, snapshotWeights, weightFn, phase, resultScreen } from './common.js';
import { readShared } from './share.js';
import { makeRhythmEngine, WINDOWS } from '../core/rhythmEngine.js';

const SVGNS = 'http://www.w3.org/2000/svg';

const DENSITY = {
  every2: { label: '2拍に1つ', gaps: [2] },
  every1: { label: '1拍に1つ', gaps: [1] },
  mix: { label: '1拍か2拍', gaps: [1, 2] },
  eighth: { label: '半拍もまぜる', gaps: [0.5, 1, 1, 2] },
};
const LENGTH = { n16: { label: '16音', n: 16 }, n32: { label: '32音', n: 32 }, n64: { label: '64音', n: 64 }, endless: { label: 'エンドレス', n: Infinity } };
const GRADE = {
  perfect: { label: 'Perfect', pts: 3, color: COLOR.ok },
  great: { label: 'Great', pts: 2, color: COLOR.ok },
  good: { label: 'Good', pts: 1, color: COLOR.warn },
  miss: { label: 'Miss', pts: 0, color: COLOR.ng },
};

const modeFields = () => [
  {
    key: 'pad', type: 'segmented', label: '答えるところ',
    options: [{ id: 'keys', label: '鍵盤' }, { id: 'buttons', label: 'ボタン' }],
    note: '答え方を「鍵盤で（高さまで）」にしているときは、高さまで答える横長の鍵盤になります',
  },
  { key: 'bpm', type: 'slider', label: 'テンポ', min: 40, max: 200, step: 4, format: (v) => `♩ = ${v}` },
  { key: 'density', type: 'segmented', label: '音符の間隔', options: Object.entries(DENSITY).map(([id, d]) => ({ id, label: d.label })) },
  { key: 'length', type: 'segmented', label: '長さ', options: Object.entries(LENGTH).map(([id, d]) => ({ id, label: d.label })) },
  { key: 'metronome', type: 'toggle', label: 'メトロノーム' },
  { key: 'pitch', type: 'toggle', label: '当たったら音符の音を鳴らす', note: 'ランダムな音の並びがそのままメロディーになります。マイクで答えるときは、「イヤホンで聞いている」がオンのときだけ鳴らします' },
  {
    key: 'offset', type: 'slider', label: 'タイミングの調整', min: -200, max: 200, step: 10,
    format: (v) => (v === 0 ? '0 ミリ秒' : `${v > 0 ? '+' : ''}${v} ミリ秒`),
    note: 'いつも「遅め」と出るならプラスへ（Bluetooth のイヤホンは音が遅れがち）',
  },
];

const recordKey = (gen, gs, ms) => `rhythm|${gen.signature({ ...gs, clefs: [gs.clefs[0]] })}|${ms.bpm}|${ms.density}|${ms.length}`;

export function mountRhythm(root, { game, gen, life, query }) {
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
      ...setupBase, L: life.child(), modeTitle: 'リズム', sharedSeed,
      info: () => {
        const r = getRecord(recordKey(gen, gs, ms));
        return [
          gs.clefs.length > 1 ? `リズムでは最初の音部記号（${CLEFS[gs.clefs[0]].label}）だけを使います。` : '',
          ms.length === 'endless' ? '' : `自己ベスト（この設定）: ${r == null ? 'まだ記録なし' : `${r}%`}`,
        ].filter(Boolean).join('　');
      },
      onStart: () => run(takeSeed()),
    });
  }

  // ---------------- 演奏 ----------------
  // weights: 「同じ問題でもう一度」のときは前回の重みの写しを使う（同じ並びになる）
  async function run(seed, weights = snapshotWeights(gen, gs)) {
    const L = life.child();
    phase('run');
    const g = globalSettings();
    const space = spaceOf(gen, gs);
    root.replaceChildren(h('p', { class: 'lead center' }, '準備しています…'));
    // 音が出せるなら音の時計で、出せなければ画面の時計で進める（音なしでも遊べる）
    const sound = await audioReady();
    if (!L.alive) return;
    const clock = sound ? audioNow : () => performance.now() / 1000;
    const rs = { ...gs, clefs: [gs.clefs[0]] };
    const clef = rs.clefs[0];
    const range = RANGES[rs.range];
    const rng = makeRng(seed);
    const beat = 60 / ms.bpm;
    const gaps = DENSITY[ms.density].gaps;
    const total = LENGTH[ms.length].n;
    const offset = ms.offset / 1000;

    // 画面：背景の五線（VexFlow）に、流れる音符の層を描き足す
    // 狭い画面では描く幅を縮めて、そのぶん大きく映す
    const W = Math.round(Math.min(440, Math.max(280, root.clientWidth * 0.62)));
    const hitX = 88;
    const lookBeats = W < 360 ? 3 : 4; // 線に届く何拍前から見えるか（狭い画面は短く）
    const speed = (W - hitX - 24) / (lookBeats * beat); // px / 秒
    const stage = h('div', { class: 'stage staff rhythm', html: staffSVG({ clef, items: [], frame: range, width: W }) });
    const svg = stage.querySelector('svg');
    const el = (tag, attrs) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    const yOf = (p) => STAFF.bottomY - p * STAFF.half;
    // 帯と縦の線は五線の下に敷く（五線の線を途切れさせない）
    svg.insertBefore(el('line', { x1: hitX, x2: hitX, y1: STAFF.topY - 30, y2: STAFF.bottomY + 30, class: 'hitline' }), svg.firstChild);
    svg.insertBefore(el('rect', { x: hitX - 13, y: STAFF.topY - 30, width: 26, height: 100, rx: 8, class: 'hitzone' }), svg.firstChild);
    const clip = el('clipPath', { id: 'lane-clip' });
    clip.append(el('rect', { x: 58, y: -500, width: W, height: 1500 }));
    svg.append(clip);
    const lane = el('g', { 'clip-path': 'url(#lane-clip)' });
    svg.append(lane);
    const pop = el('text', { x: hitX, y: STAFF.topY - 40, 'text-anchor': 'middle', class: 'pop' });
    svg.append(pop);

    const combo = h('div', { class: 'scoreline' });
    const progress = h('div', { class: 'progress' });
    const count = h('div', { class: 'overlay' });
    // 音名で答えるときは 1 オクターブの鍵盤にもできる（黒鍵は臨時記号ありのときだけ押せる）
    let padSpec = gen.answerPad(rs);
    if (ms.pad === 'keys' && padSpec.type === 'name7') padSpec = { type: 'chroma', whiteOnly: true };
    const pad = makePad(padSpec, { naming: g.naming, keyHints: g.keyHints, onAnswer: press });
    root.replaceChildren(
      h('div', { class: 'runbar' }, progress, combo, h('button', { class: 'btn ghost small', onclick: () => finish(false) }, 'やめる', h('kbd', {}, 'Esc'))),
      h('div', { class: 'stage-wrap' }, stage, count),
      h('div', { class: 'hint' }, sound ? '音符が縦の線に重なった瞬間に答える' : '音が出せない状態です（音なしで進みます）。音符が縦の線に重なった瞬間に答える'),
      pad.el,
    );

    // 音符を 1 つ描く（符頭と加線）
    function drawNote(q) {
      const p = q.prompt.step - CLEFS[clef].bottom;
      const y = yOf(p);
      const gEl = el('g', { class: 'rnote' });
      const ledgers = [];
      for (let lp = -2; lp >= p; lp -= 2) ledgers.push(lp);
      for (let lp = 10; lp <= p; lp += 2) ledgers.push(lp);
      for (const lp of ledgers) gEl.append(el('line', { x1: -10, x2: 10, y1: yOf(lp), y2: yOf(lp), class: 'ledger' }));
      gEl.append(el('path', { d: glyphPath('noteheadBlack', -5.9, y), class: 'head' }));
      // 符尾：真ん中の線より下は右に上向き、上は左に下向き（四分音符の形）
      gEl.append(p < 4
        ? el('line', { x1: 5.3, x2: 5.3, y1: y - 1, y2: y - 34, class: 'stem' })
        : el('line', { x1: -5.3, x2: -5.3, y1: y + 1, y2: y + 34, class: 'stem' }));
      const acc = q.prompt.acc;
      if (acc) gEl.append(el('path', { d: glyphPath(acc > 0 ? 'accidentalSharp' : 'accidentalFlat', -19, y), class: 'head' }));
      lane.append(gEl);
      return gEl;
    }

    const t0 = clock() + 0.5; // 1 拍目
    const firstT = t0 + 4 * beat; // 1 小節数えてから最初の音符
    const eng = makeRhythmEngine({ windows: WINDOWS });
    let made = 0;
    let nextT = firstT;
    let prev = null;
    let nextBeat = 0;
    const log = [];
    let ended = false;
    // 開発中だけ、自動テストから判定を覗けるようにする
    if (import.meta.env?.DEV) window.__rhythm = { eng, now: clock, offset };

    function produce(now) {
      while (made < total && nextT < now + (lookBeats + 1) * beat) {
        const q = gen.make(rs, { rng, prev, weight: weightFn(weights) });
        prev = q;
        const n = eng.add(q, nextT);
        n.el = drawNote(q);
        made++;
        nextT += beat * rng.pick(gaps);
      }
    }

    function show(grade, dt) {
      const G = GRADE[grade];
      const timing = grade === 'great' || grade === 'good' ? (dt < 0 ? ' 早め' : ' 遅め') : '';
      pop.textContent = G.label + timing;
      pop.setAttribute('fill', G.color);
      pop.classList.remove('go');
      void pop.getBoundingClientRect();
      pop.classList.add('go');
    }

    // 判定が出たら：色・音・記録・コンボ
    function after({ note, grade, dt }) {
      const ok = grade !== 'miss';
      note.el.classList.add(ok ? 'hit' : 'missed');
      note.el.style.color = GRADE[grade].color;
      recordAnswer(space, note.item.key, { ok, given: note.given });
      log.push({ q: note.item, id: note.given, ok, ms: Math.abs(dt) * 1000 });
      // マイクで答えるときは鳴らさない（鳴っているあいだマイクが止まり、次の音を取りこぼすため）。イヤホンなら鳴らす
      if (ok && ms.pitch && sound && (!g.mic || g.micPhones)) playEventsAt(note.item.sound, audioNow() + 0.005, 0.7);
      if (!ok && note.given != null && g.sound) sfx('ng');
      show(grade, dt);
      const { streak } = eng.score();
      combo.innerHTML = streak >= 2 ? `<b class="ok">${streak} コンボ</b>` : '';
    }

    function press(id) {
      if (ended) return;
      const r = eng.press(id, clock() - offset);
      if (r) after(r);
      else {
        pop.textContent = '…';
        pop.setAttribute('fill', COLOR.mute);
      }
    }

    function frame() {
      if (!L.alive || ended) return;
      const now = clock();
      produce(now);
      // メトロノーム（少し先まで予約。もう過ぎた拍は鳴らさない）
      const lastT = eng.notes.at(-1)?.t ?? 0;
      while (t0 + nextBeat * beat < now + 0.15 && (made < total || t0 + nextBeat * beat <= lastT)) {
        const bt = t0 + nextBeat * beat;
        if (ms.metronome && sound && bt > now - 0.03) clickAt(bt, nextBeat % 4 === 0);
        nextBeat++;
      }
      // 数え（最初の音符までの拍）
      const before = Math.ceil((firstT - now) / beat);
      const counting = before > 0 && before <= 4;
      count.textContent = counting ? String(before) : '';
      count.className = counting ? 'overlay show soft' : 'overlay';
      eng.sweep(now - offset).forEach(after);
      for (const n of eng.notes) n.el.setAttribute('transform', `translate(${(hitX + (n.t - now) * speed).toFixed(1)} 0)`);
      // 左へ抜けた音符は片づける
      eng.drop((n) => {
        const gone = n.judged && hitX + (n.t - now) * speed < 40;
        if (gone) n.el.remove();
        return gone;
      });
      progress.textContent = Number.isFinite(total) ? `${log.length} / ${total}` : `${log.length}音`;
      if (made >= total && eng.notes.every((n) => n.judged) && now > nextT - beat * 0.5) return finish(true);
      requestAnimationFrame(frame);
    }

    function finish(completed, note) {
      if (ended) return;
      ended = true;
      stopAll();
      L.end();
      const sc = eng.score();
      result(seed, { tally: sc.tally, maxStreak: sc.maxStreak, accuracy: sc.accuracy, log, completed, weights, note });
    }

    L.on(window, 'keydown', (e) => {
      if (typingInField(e) || e.repeat) return;
      if (e.key === 'Escape') return finish(false);
      if (pad.handleKey(e)) e.preventDefault();
    });
    // 裏に回ると画面が止まり、時計だけ進んでしまうので、そこで終わりにする
    L.on(document, 'visibilitychange', () => {
      if (document.hidden) finish(false, '画面を離れたので止めました。');
    });

    onMidiNote(L, (m) => pad.handleMidi(m));
    requestAnimationFrame(frame);
  }

  // ---------------- 結果 ----------------
  function result(seed, { tally, maxStreak, accuracy: acc, log, completed, weights, note }) {
    const L = life.child();
    const g = globalSettings();
    const n = log.length;
    let isNew = false;
    if (completed && Number.isFinite(LENGTH[ms.length].n)) isNew = offerRecord(recordKey(gen, gs, ms), acc);
    if (completed && g.sound) sfx(tally.miss === 0 ? 'fanfare' : 'ok');
    const rec = getRecord(recordKey(gen, gs, ms));
    const full = completed && tally.miss === 0 && n > 0;
    resultScreen({
      root, L, pass: full,
      title: full ? 'フルコンボ！' : completed ? (acc >= 90 ? 'よくできました' : '結果') : '途中までの結果',
      sub: `♩ = ${ms.bpm}・${DENSITY[ms.density].label}・${n}音`,
      badge: isNew ? '自己ベスト更新' : null,
      tiles: [
        ['正確さ', `${acc}%`, acc >= 90 ? 'ok' : ''],
        ['最大コンボ', `${maxStreak}`],
        ['Perfect', `${tally.perfect}`, 'dim'],
        ['Great', `${tally.great}`, 'dim'],
        ['Good', `${tally.good}`, 'dim'],
        ['Miss', `${tally.miss}`, tally.miss ? 'ng' : 'dim'],
      ],
      body: [note ? h('p', { class: 'notice' }, note) : null, breakdown(gen, { ...gs, clefs: [gs.clefs[0]] }, log, g.naming)].filter(Boolean),
      primary: ['もう一度', () => run(newSeed())],
      secondary: [['同じ問題で再挑戦', () => run(seed, weights)], ['設定を変える', setup]],
      foot: [h('span', {}, `自己ベスト: ${rec == null ? '—' : `${rec}%`}`), shareButton(game, gs, ms, seed)],
    });
  }
}
