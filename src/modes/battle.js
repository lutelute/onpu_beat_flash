// バトル（オトバトル）：降りてくる（または四方から迫る）敵の五線を読んで、その音を答えて撃つ
//
// 出題（音部記号・範囲・臨時記号・答え方）は「譜読み」の生成器の設定をそのまま使う。
// 「だんだん広がる」コースでは、もとのオトバトルの面のように、ステージごとに音部記号・範囲・臨時記号が増える。
// 照準：画面をタップ（マウスなら重ねる）すると、同じ音の敵が 2 つ以上いるとき照準に近いほうを撃つ。
// 進行と判定は core/battleEngine.js、絵は render/battleCanvas.js。
// 答えは記録（苦手な音）にも数える。外したときは、いちばん近い敵の音をまちがえたものとして数える。
import { h, typingInField, onControl } from '../ui/dom.js';
import { makePad } from '../ui/pads.js';
import { onMidiNote } from '../ui/midi.js';
import { onMicLevel } from '../ui/mic.js';
import { makeRng, newSeed } from '../core/rng.js';
import { RANGES, CLEF_ORDER, CLEFS } from '../core/music.js';
import { getSettings, saveSettings, globalSettings, recordAnswer, getRecord, offerRecord } from '../core/store.js';
import { audioReady, playEvents, stopAll, sfx } from '../render/audio.js';
import { makeBattle, SPEEDS, stageParams } from '../core/battleEngine.js';
import { makeBattleView } from '../render/battleCanvas.js';
import { breakdown, setupScreen, shareButton, spaceOf, snapshotWeights, weightFn, phase, resultScreen } from './common.js';
import { readShared } from './share.js';
import { makeBattleHud } from '../ui/battleHud.js';
import { toast } from '../ui/toast.js';

const LENGTH = {
  s3: { label: '3ステージ', n: 3 },
  s5: { label: '5ステージ', n: 5 },
  endless: { label: 'エンドレス', n: Infinity },
};
const SPEED_LABEL = { slow: 'ゆっくり', normal: 'ふつう', fast: 'はやい', auto: 'おまかせ' };
const sec = (ms) => `${(ms / 1000).toFixed(2)}秒`;

// 「だんだん広がる」コース。はじめの 5 面は、もとのオトバトルの面の名前と順番（テノール記号を足してある）
const COURSE = [
  { name: 'ハ長調の門', clefs: ['treble'], range: 'staff', accidentals: 'none', news: 'ト音記号・五線の中の音から' },
  { name: '低音の森', clefs: ['treble', 'bass'], range: 'staff', accidentals: 'none', news: 'ヘ音記号が加わります' },
  { name: '半音の迷宮', clefs: ['treble', 'bass'], range: 'near', accidentals: 'sharp', news: '♯ と、五線のすぐ外の音が加わります' },
  { name: '三種の調べ', clefs: ['treble', 'bass', 'alto'], range: 'near', accidentals: 'both', news: 'アルト記号と ♭ が加わります' },
  { name: '不協和の王', clefs: ['treble', 'bass', 'alto', 'tenor'], range: 'ledger1', accidentals: 'both', news: 'テノール記号と加線1本が加わります' },
  { name: '混沌', clefs: CLEF_ORDER, range: 'ledger2', accidentals: 'both', news: '7つの音部記号すべて・加線2本まで' },
  { name: '混沌', clefs: CLEF_ORDER, range: 'ledger3', accidentals: 'both', news: '加線3本まで' },
];
const courseOf = (n) => {
  const c = COURSE[Math.min(n, COURSE.length) - 1];
  return n >= 6 ? { ...c, name: `混沌 ${n - 5}` } : c;
};

// 遊び方（設定の画面で出題より先に出す）と、細かい設定（出題のあと）
const mainFields = () => [
  {
    key: 'field', type: 'segmented', label: '戦い方',
    options: [{ id: 'fall', label: '上から' }, { id: 'around', label: '四方から' }],
    note: '「四方から」は、もとのオトバトルのように、真ん中の砦へまわりから迫ってきます（縦長の画面では上と下から、横長なら左右からも）',
  },
  {
    key: 'course', type: 'segmented', label: 'ステージ',
    options: [{ id: 'set', label: 'この設定で' }, { id: 'grow', label: 'だんだん広がる' }],
    note: '「だんだん広がる」は、もとのオトバトルの面のように、ト音記号の五線の中から始まり、ヘ音記号・♯・アルト記号…と増えていきます（音部記号・範囲・臨時記号は面ごとに決まります）',
  },
  {
    key: 'length', type: 'segmented', label: '長さ',
    options: Object.entries(LENGTH).map(([id, d]) => ({ id, label: d.label })),
    note: '1ステージ ＝ 敵の群れ 3つ ＋ ボス。ボスは五線の短いフレーズを持っていて、左から順に答えると削れます',
  },
  {
    key: 'speed', type: 'segmented', label: '敵の速さ', options: Object.entries(SPEED_LABEL).map(([id, label]) => ({ id, label })),
    note: 'おまかせ：群れごとに、届かれたら少しゆっくり、早めに倒せていたら少し速くします',
  },
  {
    key: 'look', type: 'segmented', label: '音符の見え方',
    options: [{ id: 'always', label: 'いつも見える' }, { id: 'flash', label: 'フラッシュ' }],
    note: 'フラッシュ：敵の音符は現れて少しのあいだだけ見え、あとは「?」になります。ボスのフレーズは 1 音ずつ光って消えるので、覚えて順に答えます。Space（砲台をタップ）でもう一度見られますが、コンボは切れます',
  },
  { key: 'flashMs', type: 'slider', label: '見える時間（1音）', min: 200, max: 2500, step: 50, format: sec, show: (s) => s.look === 'flash' },
];
const moreFields = () => [
  {
    key: 'pad', type: 'segmented', label: '答えるところ',
    options: [{ id: 'keys', label: '鍵盤' }, { id: 'buttons', label: 'ボタン' }],
    note: 'ボタン：大きなボタンで答えます（♯・♭ があるときは 12 音を 6 列 × 2 段に）。答え方を「鍵盤で（高さまで）」にしているときは、どちらでも高さまで答える横長の鍵盤になります',
  },
  {
    key: 'hint', type: 'toggle', label: '近づいた敵に音名を出す（はじめての人向け）',
    note: '音名が出てから倒すと得点は半分で、苦手な音の記録にも数えません',
  },
  {
    key: 'colors', type: 'toggle', label: '音符を音ごとに色分けする（もとのオトバトルの色）',
    note: 'ドは赤、レは橙…と色で分かります。色で覚えてしまわないよう、慣れたら外しましょう。ハイスコアは色なしと別に残します',
  },
  {
    key: 'pitch', type: 'toggle', label: '倒したら音符の音を鳴らす',
    note: 'マイクで答える設定のときは鳴らしません（アプリの音をマイクが拾わないように）。「イヤホンで聞いている」をオンにすれば鳴ります',
  },
];

// ハイスコアの記録の名前。前からある「上から・この設定で・色なし」は前と同じ名前のまま
const recordKey = (gen, gs, ms) => {
  const what = ms.course === 'grow' ? `grow:${gs.answer}` : gen.signature(gs);
  const extra = [ms.field === 'around' ? 'around' : '', ms.colors ? 'color' : '', ms.look === 'flash' ? `flash${ms.flashMs}` : ''].filter(Boolean).join('+');
  return `battle|${what}|${ms.length}|${ms.speed}${extra ? `|${extra}` : ''}`;
};
// もとのオトバトル（同じ場所で公開していれば読める）の最高点。点の付け方が違うので、見せるだけ
const oldBest = () => {
  try {
    return Number(localStorage.getItem('otobattle_best_score')) || 0;
  } catch {
    return 0;
  }
};

const modeFields = (s) => [...mainFields(s), ...moreFields(s)];

/** 「だんだん広がる」の面の一覧（設定の画面で、出題の設定の代わりに見せる） */
const coursePreview = () =>
  h('ol', { class: 'course-list' },
    COURSE.map((c, i) => h('li', {},
      h('b', {}, i < 5 ? c.name : `混沌 ${i - 4}`),
      h('span', {}, `${c.clefs.length === CLEF_ORDER.length ? '7つの音部記号' : c.clefs.map((k) => CLEFS[k].short).join('・')}／${RANGES[c.range].label}${c.accidentals === 'none' ? '' : `／${{ sharp: '♯', flat: '♭', both: '♯♭' }[c.accidentals]}`}`))));

export function mountBattle(root, { game, gen, life, query }) {
  const FIELDS = modeFields;
  let engine = null; // いちばん最近の 1 回（結果の画面で使う）
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
  // もとのオトバトルの案内ページから来た人は、前と同じ遊び方（四方から・だんだん広がる）で始める
  if (!shared && new URLSearchParams(query || '').get('from') === 'otobattle') {
    ms = { ...ms, field: 'around', course: 'grow' };
    saveSettings('mode', game.id, ms);
    toast('もとのオトバトルと同じ「四方から・だんだん広がる」にしてあります');
  }
  const takeSeed = () => {
    const s = sharedSeed ?? newSeed();
    sharedSeed = null;
    return s;
  };

  setup();

  // ---------------- 設定 ----------------
  function setup() {
    setupScreen({
      root, game, gen, modeFields: mainFields, moreFields, L: life.child(), modeTitle: '遊び方', sharedSeed, modeFirst: true,
      // 「だんだん広がる」では、音部記号・範囲・臨時記号は面ごとに決まるので、出題の設定の代わりに面の一覧を見せる
      genView: (m) => (m.course === 'grow'
        ? { hide: ['clefs', 'range', 'accidentals'], note: h('div', { class: 'field-note' }, '面ごとに決まります（答え方と「苦手な音を多めに」はこの設定を使います）', coursePreview()) }
        : null),
      get: () => ({ gs, ms }),
      set: (p) => {
        if (p.gs) saveSettings('gen', gen.id, (gs = p.gs));
        if (p.ms) saveSettings('mode', game.id, (ms = p.ms));
      },
      info: () => {
        const r = getRecord(recordKey(gen, gs, ms));
        const old = oldBest();
        // はじめるボタンの近くに、いまの遊び方を一行で
        const what = [ms.field === 'around' ? '四方から' : '上から', ms.course === 'grow' ? 'だんだん広がる' : null, LENGTH[ms.length]?.label, `速さ ${SPEED_LABEL[ms.speed]}`, ms.look === 'flash' ? 'フラッシュ' : null].filter(Boolean).join('・');
        return `${what}　｜　ハイスコア: ${r == null ? 'まだ記録なし' : r.toLocaleString()}${old ? `　／　もとのオトバトルの最高点: ${old.toLocaleString()}（数え方が違うので別）` : ''}`;
      },
      onStart: () => run(takeSeed()),
    });
  }

  // ---------------- 遊ぶ ----------------
  // 苦手の重み：「だんだん広がる」なら、どの面の音でも引けるように全部の音で
  const allGs = () => ({ ...gs, clefs: CLEF_ORDER, range: 'ledger3', accidentals: 'both' });
  async function run(seed, weights = snapshotWeights(gen, ms.course === 'grow' ? allGs() : gs)) {
    const L = life.child();
    phase('run');
    const g = globalSettings();
    const space = spaceOf(gen, gs);
    root.replaceChildren(h('p', { class: 'lead center' }, '準備しています…'));
    const sound = await audioReady();
    if (!L.alive) return;
    const micHears = g.mic && !g.micPhones; // マイクがスピーカーの音を拾うおそれがある
    const pitchSound = sound && ms.pitch && !micHears;
    // マイクで答えるときは、高さのある効果音を雑音の音に替える（マイクがアプリの音を聞かずに済む時間を短く）
    const MIC_SFX = { ok: 'pop', ng: 'thud', tick: null };
    const fx = (kind) => {
      const k = micHears && kind in MIC_SFX ? MIC_SFX[kind] : kind;
      if (k && sound && g.sound) sfx(k);
    };

    // 問題の素：ふつうの敵は 1 音ずつ、ボスは同じ音部記号の並び。
    // 乱数は「問題」「ボスの音部記号」「敵の出し方」で分ける（倒す速さや画面の幅で問題の並びが変わらないように）
    const rngQ = makeRng(seed);
    const rngClef = makeRng(seed + 7919);
    const rng = makeRng(seed + 104729);
    const weight = weightFn(weights);
    let prev = null;
    const grow = ms.course === 'grow';
    // ステージ n の出題の設定（「だんだん広がる」なら面ごとに替わる）
    const gsOf = (n) => {
      if (!grow) return gs;
      const c = courseOf(n);
      return { ...gs, clefs: c.clefs, range: c.range, accidentals: c.accidentals };
    };
    const ask = (s) => {
      const q = gen.make(s, { rng: rngQ, prev, weight });
      prev = q;
      return q;
    };
    const make = (n = 1) => ask(gsOf(n));
    const makePhrase = (k, n = 1) => {
      const sg = gsOf(n);
      const one = { ...sg, clefs: [rngClef.pick(sg.clefs)] };
      return Array.from({ length: k }, () => ask(one));
    };

    // 画面：上に状態（ui/battleHud.js）、真ん中に戦場（render/battleCanvas.js）、下に答え（ui/pads.js）
    const hud = makeBattleHud({ onPause: () => pause(true), onResume: () => pause(false), onQuit: () => finish('quit') });
    const around = ms.field === 'around';
    const canvas = h('canvas', {
      class: 'battle-canvas',
      'aria-label': around ? 'バトルの画面。四方から真ん中の砦へ迫る五線の音を答えて撃ちます' : 'バトルの画面。上から降りてくる五線の音を答えて撃ちます',
    });
    const wrap = h('div', { class: 'stage-wrap battle', dataset: { tone: 'battle', field: ms.field } }, canvas, hud.banner, hud.pauseBox);

    // 答えるところ：「鍵盤」なら鍵盤の形、「ボタン」なら大きなボタン（12 音のときは 6 列 × 2 段）
    const padOf = (sg) => {
      const spec = gen.answerPad(sg);
      if (ms.pad === 'keys' && spec.type === 'name7') return { type: 'chroma', whiteOnly: true };
      if (ms.pad === 'buttons' && spec.type === 'chroma') return { ...spec, grid: true };
      return spec;
    };
    let padKey = JSON.stringify(padOf(gsOf(1)));
    let pad = makePad(padOf(gsOf(1)), { naming: g.naming, keyHints: g.keyHints, onAnswer: press });
    root.replaceChildren(hud.bar, wrap, hud.notice, pad.el);

    const view = makeBattleView(canvas, {
      frame: RANGES[gsOf(1).range], clefs: gsOf(1).clefs, maxPhrase: stageParams(99).phrase, naming: g.naming,
      field: ms.field, colors: ms.colors, answerLabel: (id) => gen.answerLabel(id, gs, g.naming),
      look: ms.look, flashMs: ms.flashMs,
    });
    const flash = ms.look === 'flash';
    const b = makeBattle({
      rng, make, makePhrase, field: ms.field, ...view.resize(),
      speed: SPEEDS[ms.speed] ?? 1, stages: LENGTH[ms.length]?.n ?? 3, hint: ms.hint, adapt: ms.speed === 'auto',
    });
    // 「だんだん広がる」：ステージが替わったら、パネルの高さと答えるところを合わせ直す（敵はいない時）
    function applyStage(n) {
      if (!grow) return;
      const sg = gsOf(n);
      view.configure({ frame: RANGES[sg.range], clefs: sg.clefs });
      b.setLayout(view.resize());
      const spec = padOf(sg);
      const k = JSON.stringify(spec);
      if (k !== padKey) {
        padKey = k;
        const next = makePad(spec, { naming: g.naming, keyHints: g.keyHints, onAnswer: press });
        pad.el.replaceWith(next.el);
        pad = next;
      }
    }

    // 照準：タップ（マウスは重ねる）した場所。null ならいちばん砦に近い敵を撃つ
    let aim = null;
    const rank = (c) => {
      const p = c === 'boss' ? view.bossNoteAt(b.s.boss) : view.where(c);
      return Math.hypot(p.x - aim.x, p.y - aim.y);
    };
    const at = (e) => ({ x: e.offsetX, y: e.offsetY });
    L.on(canvas, 'pointermove', (e) => {
      if (e.pointerType === 'mouse') aim = at(e);
    });
    L.on(canvas, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse') aim = null;
    });
    L.on(canvas, 'pointerdown', (e) => {
      const p = at(e);
      // フラッシュ表示：砲台を押すと「もう一度見る」
      if (flash && view.onCannon(p)) return peek();
      // 指：照準のところをもう一度タップすると外す
      if (e.pointerType !== 'mouse' && aim && Math.hypot(aim.x - p.x, aim.y - p.y) < 30) aim = null;
      else aim = p;
    });
    // 開発中だけ、自動テストから中を覗けるようにする
    if (import.meta.env?.DEV) window.__battle = { b, press, view, aim: (p) => (aim = p) };
    const ro = new ResizeObserver(() => b.setLayout(view.resize()));
    ro.observe(wrap);
    L.signal.addEventListener('abort', () => ro.disconnect(), { once: true });
    // 端末の明るさが変わったら、色を読み直す
    L.on(matchMedia('(prefers-color-scheme: dark)'), 'change', () => b.setLayout(view.resize()));

    let paused = false;
    let paceNote = ''; // おまかせで速さを変えたとき、次の見出しに添える
    let ended = false;
    let last = 0;
    const showBanner = hud.show;

    function updateHud() {
      const s = b.s;
      hud.update({
        hearts: s.hearts, maxHearts: s.maxHearts, stage: s.stage, total: LENGTH[ms.length]?.n ?? Infinity,
        boss: s.phase === 'boss' || s.phase === 'bossIntro', wave: s.wave, waves: b.params().waves,
        name: grow ? courseOf(s.stage).name : '', score: s.score, combo: s.combo,
      });
    }

    // 答えた鍵盤を少しのあいだ緑（当たり）か赤（外れ）に光らせる（MIDI・マイクで答えたときも、何が届いたか分かるように）
    let keyTimer = 0;
    function flashKey(id, cls) {
      L.clear(keyTimer);
      pad.clear();
      pad.mark(id, cls);
      keyTimer = L.timeout(() => pad.clear(), 260);
    }

    // 出来事 → 絵・音・記録・見出し
    function handle(events) {
      for (const ev of events) {
        view.fx(ev, b.s);
        if (ev.type === 'hit') flashKey(ev.e.q.answer, 'ok');
        else if (ev.type === 'boss') flashKey(ev.q.answer, 'ok');
        else if (ev.type === 'miss') flashKey(ev.id, 'ng');
        if (ev.type === 'hit') {
          if (!ev.e.hinted) recordAnswer(space, ev.e.q.key, { ok: true, given: null });
          if (pitchSound) playEvents(ev.e.q.sound.map((x) => ({ ...x, d: 0.6 })), { delay: 0.005, vel: 0.62 });
          else fx('pop');
        } else if (ev.type === 'boss') {
          recordAnswer(space, ev.q.key, { ok: true, given: null });
          if (pitchSound) playEvents(ev.q.sound.map((x) => ({ ...x, d: 0.5 })), { delay: 0.005, vel: 0.62 });
          else fx('pop');
          if (ev.phraseDone && !ev.down) {
            fx('ok');
            showBanner('フレーズ成功！', `ボスの残り ${b.s.boss?.hp ?? 0}`, 1100, 'small');
          }
        } else if (ev.type === 'miss') {
          // 音名が出ている敵のぶんは、倒したときと同じく記録に数えない
          if (ev.q && !ev.hinted) recordAnswer(space, ev.q.key, { ok: false, given: ev.id });
          fx('ng');
          // 何と答えたか（マイク・MIDI で答えたとき、何が届いたか分かるように）。正解は出さない
          hud.say(`× ${gen.answerLabel(ev.id, gs, g.naming)}　その音の敵はいません`, 'bad', 1400);
        } else if (ev.type === 'breach') {
          if (!ev.e.hinted) recordAnswer(space, ev.e.q.key, { ok: false, given: null });
          fx('thud');
          hud.say(`届かれた：${ev.e.q.reveal(g.naming)} だった${ev.guarded ? '（続けて届いたのでハートはそのまま）' : ''}`, 'bad');
        } else if (ev.type === 'bossBreach') {
          recordAnswer(space, b.s.boss.phrase[b.s.boss.idx].key, { ok: false, given: null });
          fx('thud');
          showBanner('ボスに届かれた！', 'ハート −2', 1300, 'bad');
        } else if (ev.type === 'phase') {
          if (ev.phase === 'intro') {
            applyStage(ev.stage);
            const first = flash
              ? '消えたら Space（砲台をタップ）でもう一度見られます'
              : around ? '迫ってくる五線の音を答えて撃とう' : '降りてくる五線の音を答えて撃とう';
            if (grow) {
              const c = courseOf(ev.stage);
              showBanner(`ステージ ${ev.stage}　${c.name}`, ev.stage <= COURSE.length ? c.news : '敵が速くなります', 2000);
            } else showBanner(`ステージ ${ev.stage}`, ev.stage === 1 ? first : '敵が速くなります', 1700);
          }
          else if (ev.phase === 'between') {
            showBanner(`群れ ${ev.wave}/${b.params().waves}`, paceNote, paceNote ? 1400 : 1100, 'small');
            paceNote = '';
          }
          else if (ev.phase === 'bossIntro') {
            showBanner('ボス出現', flash ? '1音ずつ光るフレーズを覚えて、順に答えよう' : 'フレーズを左から順に答えよう', 1900, 'bad');
            paceNote = '';
            fx('tick');
          }
        } else if (ev.type === 'pace') {
          paceNote = ev.slower ? '少しゆっくりにします' : '少し速くします';
        } else if (ev.type === 'stageClear') {
          fx('fanfare');
          showBanner('ステージクリア！', `+${ev.bonus.toLocaleString()}${ev.perfect ? '（ノーダメージ）' : ''}${ev.healed ? '・ハート回復' : ''}`, 2500, 'good');
        } else if (ev.type === 'over') {
          showBanner('ゲームオーバー', '', 2000, 'bad');
          L.timeout(() => finish('over'), 1600);
        } else if (ev.type === 'won') {
          finish('won');
        }
      }
      updateHud();
    }

    function peek() {
      if (ended || paused || !flash) return;
      if (b.peek()) handle(b.take());
    }

    function press(id) {
      if (ended || paused) return;
      const r = b.press(id, aim ? rank : undefined);
      if (r) handle(b.take());
    }

    function frameLoop(now) {
      if (!L.alive || ended) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (!paused) {
        b.step(dt);
        const ev = b.take();
        if (ev.length) handle(ev);
      }
      hud.tick(now);
      view.draw(b.s, paused ? 0 : dt, { jammed: b.jammed(), aim, heard });
      requestAnimationFrame(frameLoop);
    }

    function pause(on) {
      // 終わった直後（結果の画面へ移るまでの間）は止めない
      if (ended || paused === on || b.s.phase === 'over' || b.s.phase === 'won') return;
      paused = on;
      hud.setPaused(on);
      if (on) stopAll();
      last = 0;
    }

    function finish(how) {
      if (ended) return;
      if (b.s.phase === 'over') how = 'over';
      ended = true;
      stopAll();
      L.end();
      result(seed, how, weights);
    }

    L.on(window, 'keydown', (e) => {
      if (typingInField(e) || e.repeat) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        return pause(!paused);
      }
      if (paused) {
        // ボタンに合わせて Enter を押したときは、そのボタンに任せる
        if (e.key === 'Enter' && !onControl(e)) {
          e.preventDefault();
          pause(false);
        }
        return;
      }
      if (flash && e.key === ' ' && !onControl(e)) {
        e.preventDefault();
        return peek();
      }
      if (pad.handleKey(e)) e.preventDefault();
    });
    // 裏に回ったら止める（戻ってきたら「続ける」で再開）
    L.on(document, 'visibilitychange', () => {
      if (document.hidden) pause(true);
    });
    L.on(window, 'blur', () => pause(true));
    onMidiNote(L, (m) => pad.handleMidi(m));
    // マイク：聞こえている音を砲台の横に出す（何に聞こえているか分かるように）
    let heard;
    if (g.mic) {
      heard = null;
      onMicLevel(({ midi, gated }) => {
        if (gated) heard = { gated: true };
        else if (midi == null) heard = null;
        else heard = { text: gen.answerLabel(String(gs.answer === 'piano' ? midi : midi % 12), gs, g.naming) };
      }, L);
    }

    engine = b;
    updateHud();
    handle(b.take());
    requestAnimationFrame(frameLoop);
  }

  // ---------------- 結果 ----------------
  function result(seed, how, weights) {
    const L = life.child();
    const g = globalSettings();
    const s = engine.s;
    const log = s.log.filter((r) => !r.hinted);
    const ok = log.filter((r) => r.ok).length;
    const acc = log.length ? Math.round((100 * ok) / log.length) : 0;
    const isNew = s.score > 0 && offerRecord(recordKey(gen, gs, ms), s.score);
    const rec = getRecord(recordKey(gen, gs, ms));
    const won = how === 'won';
    if (won && g.sound) sfx('fanfare');
    const reached = won ? `${s.stage}ステージ クリア` : `ステージ ${s.stage}${ms.course === 'grow' ? `（${courseOf(s.stage).name}）` : ''} まで`;
    resultScreen({
      root, L, pass: won,
      title: won ? 'クリア！' : how === 'over' ? 'ゲームオーバー' : '途中までの結果',
      sub: `${reached}・${ms.field === 'around' ? '四方から・' : ''}${ms.look === 'flash' ? `フラッシュ ${sec(ms.flashMs)}・` : ''}${SPEED_LABEL[ms.speed]}`,
      badge: isNew ? 'ハイスコア更新' : null,
      tiles: [
        ['スコア', s.score.toLocaleString(), isNew ? 'ok' : ''],
        ['正答率', `${acc}%`, acc >= 90 ? 'ok' : ''],
        ['最大コンボ', `${s.maxCombo}`],
      ],
      line: [
        ['倒した敵', `${s.kills}`],
        ['外した', `${s.misses}`, s.misses ? 'ng' : ''],
        ['届かれた', `${s.breaches}`, s.breaches ? 'ng' : ''],
        ms.look === 'flash' ? ['もう一度見た', `${s.peeks}`] : null,
        ms.speed === 'auto' ? ['最後の速さ', `${(1 / s.pace).toFixed(2)}倍`] : null,
      ],
      body: [
        log.length ? null : h('p', { class: 'notice' }, s.log.length ? '音名が出てから答えた分は、正答率と苦手な音の記録に数えていません。' : 'まだ答えていません。'),
        breakdown(gen, gs, log.map((r) => ({ q: r.q, id: r.id, ok: r.ok, ms: r.ms ?? 0 })), g.naming),
      ].filter(Boolean),
      primary: ['もう一度（新しい展開）', () => run(newSeed())],
      secondary: [['同じ展開で再挑戦', () => run(seed, weights)], ['設定を変える', setup]],
      foot: [h('span', {}, `ハイスコア: ${rec == null ? '—' : rec.toLocaleString()}`), shareButton(game, gs, ms, seed)],
    });
  }
}
