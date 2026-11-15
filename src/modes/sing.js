// なぞって採点：右から流れてくる音の帯を、歌うか弾いてなぞる。マイクの高さを 20 ms ごとに採点する（core/singScore.js）
// 流れ：（お手本）→ 1 小節数える → 旋律。どのオクターブで歌っても弾いても同じ点になる
import { h } from '../ui/dom.js';
import { getSettings, saveSettings, globalSettings, setGlobal, getRecord, offerRecord } from '../core/store.js';
import { audioReady, audioNow, clickAt, playEventsAt, stopAll, outputDelay } from '../render/audio.js';
import { enableMic, micStatus, onMicStatus, onMicFrame } from '../ui/mic.js';
import { makeMelody, melodyById, keyById } from '../core/melodies.js';
import { makeSingScorer, STRICTNESS, adviceOf, frameCredit } from '../core/singScore.js';
import { TEMPERAMENTS } from '../core/intonation.js';
import { freqToMidi, MIC_INSTRUMENTS } from '../core/pitch.js';
import { chromaName, midiSci } from '../core/music.js';
import { newSeed } from '../core/rng.js';
import { drawLane, laneColors, laneRange } from '../render/singLane.js';
import { setupScreen, phase, resultScreen, shareButton } from './common.js';
import { readShared } from './share.js';

const GUIDE = {
  start: 'はじめの音だけ',
  first: '先に全部聞く',
  with: 'いっしょに鳴らす（イヤホン）',
  none: 'なし',
};
// 時刻の合わせ方：メトロノームとお手本は、鳴らしてからスピーカーで聞こえるまで outputDelay() だけ遅れる。
// 弾く人は聞こえた拍に合わせるので、帯もその分だけ遅らせて描き、マイクの時刻からもその分を引く。
// マイクはさらに、音が届くまで（約 10 ms）と、高さを当てる窓（43 ms）の半分だけ遅れる
const MIC_LAG = 0.03;

const modeFields = () => [
  { key: 'bpm', type: 'slider', label: 'テンポ', min: 40, max: 140, step: 4, format: (v) => `♩ = ${v}` },
  {
    key: 'strict', type: 'segmented', label: 'きびしさ',
    options: Object.entries(STRICTNESS).map(([id, s]) => ({ id, label: s.label })),
    note: '高さのずれが、この幅の中なら満点。その倍までは少しだけ点が入ります（100 セントが半音）',
  },
  {
    key: 'guide', type: 'segmented', label: 'お手本の音',
    options: Object.entries(GUIDE).map(([id, label]) => ({ id, label })),
    note: '「いっしょに鳴らす」は、設定の「イヤホンで聞いている」がオンのときだけ（スピーカーの音をマイクが拾うので、オフのときは「はじめの音だけ」になります）',
  },
  { key: 'metronome', type: 'toggle', label: 'メトロノーム', note: '数えのあとも、拍ごとに小さく鳴らします（短い音なので、マイクは止めません）' },
];

const recordKey = (gen, gs, ms) => `sing|${gen.signature(gs)}|${ms.strict}`;
const fmtScore = (x) => x.toFixed(3);

/** 調に合わせた音名（♯の調は♯、♭の調は♭で） */
function namer(keyId, naming) {
  const flat = ['F', 'Bb', 'Eb'].includes(keyId);
  return (midi) => {
    const parts = chromaName(midi, naming).split('\n');
    return parts.length > 1 ? parts[flat ? 1 : 0] : parts[0];
  };
}

export function mountSing(root, { game, gen, life, query }) {
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
    const L = life.child();
    setupScreen({
      root, game, gen, modeFields: FIELDS, L, modeTitle: '進め方', sharedSeed,
      get: () => ({ gs, ms }),
      set: (p) => {
        if (p.gs) saveSettings('gen', gen.id, (gs = p.gs));
        if (p.ms) saveSettings('mode', game.id, (ms = p.ms));
      },
      info: () => {
        const r = getRecord(recordKey(gen, gs, ms));
        return `自己ベスト（この曲・調・目標・きびしさ）: ${r == null ? 'まだ記録なし' : `${fmtScore(r)} 点`}`;
      },
      onStart: () => run(takeSeed()),
    });
    root.insertBefore(micCard(L), root.children[1]);
  }

  /** マイクの札：オンにする・楽器を選ぶ（楽器で、旋律を置く高さと、聞く音域が変わる） */
  function micCard(L) {
    const line = h('p', { class: 'field-note', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn primary small', onclick: async () => {
      setGlobal({ mic: true });
      btn.disabled = true;
      await enableMic(true);
      btn.disabled = false;
      show(micStatus());
    } }, 'マイクをオンにする');
    const sel = h('select', { class: 'select', 'aria-label': 'マイクで聞く楽器' }, MIC_INSTRUMENTS.map((x) => h('option', { value: x.id }, x.label)));
    sel.value = globalSettings().micInstrument;
    sel.addEventListener('change', () => setGlobal({ micInstrument: sel.value }));
    const card = h('section', { class: 'card sing-mic' },
      h('h2', {}, 'マイク'),
      h('label', { class: 'tn-field' }, h('span', {}, '歌う・弾く楽器'), sel),
      btn, line,
      h('p', { class: 'field-note' }, 'どのオクターブで歌っても弾いても同じ点です。楽器を選ぶと、その楽器の音域で聞き、帯もその高さに出ます。'));
    function show(st) {
      const on = globalSettings().mic && st.state === 'on';
      btn.hidden = on || st.state === 'unsupported';
      line.textContent = on ? `${st.text}。` : st.state === 'off' ? 'はじめると、マイクをオンにします。' : st.text;
    }
    show(micStatus());
    onMicStatus(show, L);
    return card;
  }

  // ---------------- 歌う・弾く ----------------
  async function run(seed) {
    const L = life.child();
    phase('run');
    root.replaceChildren(h('p', { class: 'lead center' }, '準備しています…'));
    const g = globalSettings();
    if (!g.mic || micStatus().state !== 'on') {
      setGlobal({ mic: true });
      const st = await enableMic(true);
      if (!L.alive) return;
      if (st.state !== 'on') {
        L.end();
        setup();
        root.insertBefore(h('p', { class: 'notice' }, `マイクが使えません：${st.text}`), root.firstChild);
        return;
      }
    }
    const sound = await audioReady();
    if (!L.alive) return;
    const clock = sound ? audioNow : () => performance.now() / 1000;
    const inst = globalSettings().micInstrument;
    const mel = makeMelody({ id: gs.song, key: gs.key, bpm: ms.bpm, inst, seed });
    const tol = STRICTNESS[ms.strict].tol;
    const scorer = makeSingScorer({ notes: mel.notes, tol, temper: gs.temper, tonic: mel.tonic });
    const label = namer(gs.key, globalSettings().naming);
    const range = laneRange(mel.notes);
    const beat = mel.beat;
    const guide = ms.guide === 'with' && !globalSettings().micPhones ? 'start' : ms.guide;
    const events = mel.notes.map((n) => ({ midi: [n.midi], t: n.t, d: n.d * 0.95 }));

    // 時刻の割り振り（clock の秒）
    const t0 = clock() + 0.5;
    let countAt = t0;
    if (guide === 'first') {
      playEventsAt(events, t0, 0.7);
      countAt = t0 + mel.length + beat;
    } else if (guide === 'start') {
      playEventsAt([{ midi: [mel.notes[0].midi], t: 0, d: beat * 2 }], t0, 0.75);
      countAt = t0 + beat * 2.5;
    }
    const songAt = countAt + 4 * beat;
    const endAt = songAt + mel.length + 0.4;
    const clicks = [];
    for (let i = 0; i < 4; i++) clicks.push(countAt + i * beat);
    if (ms.metronome) for (let b = 0; b < mel.beats; b++) clicks.push(songAt + b * beat);
    clicks.forEach((t, i) => clickAt(t, i < 4 ? i === 0 : (Math.round((t - songAt) / beat) % 4) === 0));
    if (guide === 'with') playEventsAt(events, songAt, 0.6);

    // 画面
    const noteEl = h('span', { class: 'sing-note' }, '');
    const devEl = h('span', { class: 'sing-dev' }, '');
    const rateEl = h('span', { class: 'sing-rate' }, '');
    const cv = h('canvas', { class: 'sing-lane', 'aria-label': '流れてくる音の帯と、聞こえた高さの線' });
    const overlay = h('div', { class: 'sing-overlay', 'aria-live': 'polite' });
    const pbar = h('span');
    root.replaceChildren(
      h('div', { class: 'runbar' },
        h('div', { class: 'sing-hud' }, noteEl, devEl),
        h('button', { class: 'btn ghost small', onclick: () => stop() }, 'やめる', h('kbd', {}, 'Esc'))),
      h('div', { class: 'pbar' }, pbar),
      h('div', { class: 'sing-stage', dataset: { tone: 'sing' } }, cv, overlay, rateEl),
      h('p', { class: 'field-note center sing-foot' },
        `${melodyById(gs.song).label}・${keyById(gs.key).label}・${TEMPERAMENTS[gs.temper].label}・きびしさ ±${tol} セント`),
    );
    L.on(window, 'keydown', (e) => {
      if (e.key === 'Escape') stop();
    });

    // マイクの 1 枚ごと
    const heardLag = outputDelay(); // 鳴らした拍が聞こえるまで
    const trail = [];
    let live = null; // { note, c, t }
    let credit = 0;
    let judged = 0;
    onMicFrame((f) => {
      const t = f.t - songAt - heardLag - MIC_LAG;
      if (f.t < countAt - 0.2 || t > mel.length + 0.3) return;
      // メトロノームの音（高い短い音）を拾った枚は数えない
      if (f.freq && f.freq > 1000 && clicks.some((c) => f.t >= c && f.t < c + 0.07)) return;
      const m = f.freq && !f.weak ? freqToMidi(f.freq) : null; // 下限より小さい枚は数えない（今までどおり）
      trail.push({ t, m });
      const r = t >= 0 ? scorer.feed(t, m) : null;
      if (r) {
        live = { note: r.note, c: r.c, t };
        const into = t - r.note.t;
        if (into >= Math.min(0.12, r.note.d / 4)) {
          judged++;
          credit += frameCredit(r.c, tol);
        }
      }
    }, L);

    // 開発中だけ、自動テストから採点を覗けるようにする
    if (import.meta.env?.DEV) window.__sing = { scorer, heardLag, songAt, clock };
    let colors = laneColors(cv);
    let colorsAt = 0;
    let raf = 0;
    let done = false;
    const draw = (ms0) => {
      if (!L.alive) return;
      raf = requestAnimationFrame(draw);
      const now = clock() - heardLag; // いま聞こえている拍の時刻
      if (ms0 - colorsAt > 1000) {
        colors = laneColors(cv);
        colorsAt = ms0;
      }
      const t = now - songAt;
      drawLane({ cv, notes: scorer.items, now: t, trail, tol, col: colors, label, tonic: mel.tonic, range });
      pbar.style.width = `${Math.max(0, Math.min(100, (100 * t) / mel.length))}%`;
      // 数え・お手本
      if (now < countAt) overlay.textContent = guide === 'first' ? 'お手本' : guide === 'start' ? 'はじめの音' : '';
      else if (now < songAt) overlay.textContent = String(4 - Math.floor((now - countAt) / beat));
      else overlay.textContent = '';
      overlay.classList.toggle('show', !!overlay.textContent);
      // いまの音と、ずれ
      const cur = scorer.items.find((n) => t >= n.t && t < n.t + n.d) ?? scorer.items.find((n) => n.t > t);
      noteEl.textContent = cur ? label(cur.midi) : '';
      const fresh = live && t - live.t < 0.15 && live.note === cur;
      if (fresh && live.c != null) {
        const c = Math.round(live.c);
        // 半音より大きくずれているときは、向きだけ（−392 のような数は読みにくい）
        devEl.textContent = Math.abs(c) > 100 ? (c > 0 ? '▲ 高すぎ' : '▼ 低すぎ') : `${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c)}`;
        devEl.dataset.ok = Math.abs(live.c) <= tol ? 'ok' : Math.abs(live.c) <= tol * 2 ? 'near' : 'off';
      } else {
        devEl.textContent = '';
        delete devEl.dataset.ok;
      }
      rateEl.textContent = judged ? `音程 ${Math.round((100 * credit) / judged)}%` : '';
      if (now >= endAt && !done) finish();
    };
    raf = requestAnimationFrame(draw);
    L.signal.addEventListener('abort', () => cancelAnimationFrame(raf), { once: true });

    function stop() {
      if (done) return;
      done = true;
      stopAll();
      L.end();
      setup();
    }
    function finish() {
      done = true;
      L.end();
      result(seed, scorer, trail, mel, label, range, tol);
    }
  }

  // ---------------- 結果 ----------------
  function result(seed, scorer, trail, mel, label, range, tol) {
    const L = life.child();
    const r = scorer.result();
    const key = recordKey(gen, gs, ms);
    // 何も聞こえなかったとき（マイクが外れていたなど）は記録しない
    const heard = r.notes.some((n) => n.near > 0);
    const isNew = heard && offerRecord(key, r.total);
    const rec = getRecord(key);
    const advice = adviceOf(r, label, tol);
    const pct = (x) => (x == null ? '—' : `${Math.round(x)}`);
    // 全体の帯（横に流して見る）
    const wholeW = Math.max(320, Math.round(mel.length * 56) + 60);
    const cv = h('canvas', { class: 'sing-whole', style: { width: `${wholeW}px` }, 'aria-label': '旋律全体の帯と、聞こえた高さの線' });
    const wholeBox = h('div', { class: 'sing-whole-wrap' }, cv);
    requestAnimationFrame(() => {
      if (!L.alive) return;
      drawLane({ cv, notes: scorer.items, now: null, trail, tol, col: laneColors(cv), label, tonic: mel.tonic, range, pps: (wholeW - 60) / mel.length });
    });
    const random = gs.song === 'random';
    resultScreen({
      root, L, pass: r.total >= 90,
      title: `${fmtScore(r.total)} 点`,
      sub: `${melodyById(gs.song).label}・${keyById(gs.key).label}・${TEMPERAMENTS[gs.temper].label}`,
      badge: isNew && rec === r.total ? '自己ベスト' : null,
      tiles: [
        ['音程', `${pct(r.pitch)}%`, r.pitch >= 85 ? 'ok' : r.pitch < 60 ? 'ng' : ''],
        ['安定', pct(r.stable), r.stable == null ? 'dim' : r.stable >= 80 ? 'ok' : r.stable < 50 ? 'ng' : ''],
        ['出だし', pct(r.attack), r.attack >= 80 ? 'ok' : r.attack < 50 ? 'ng' : ''],
        ['ビブラート', `${r.vibrato.count} 回`, r.vibrato.count ? 'ok' : 'dim'],
      ],
      line: [
        ['くせ', r.bias == null ? '—' : `${r.bias > 0 ? '+' : r.bias < 0 ? '−' : '±'}${Math.abs(Math.round(r.bias))} セント`],
        ['テンポ', `♩ = ${ms.bpm}`],
        ['きびしさ', `±${tol} セント`],
      ],
      body: [
        advice.length ? h('ul', { class: 'sing-advice' }, advice.map((a) => h('li', {}, a))) : null,
        h('h3', {}, '高さの線'),
        h('p', { class: 'field-note' }, '帯の緑が、合っていたところ。横に動かすと最後まで見られます。'),
        wholeBox,
        h('h3', {}, '音ごとの音程'),
        h('p', { class: 'field-note' }, `その高さを鳴らしていたときの、ずれの真ん中（セント）。真ん中の線が${TEMPERAMENTS[gs.temper].label}の目標、緑の帯が ±${tol / 2} セント`),
        intonationChart(r.byPitch, label, tol),
      ],
      primary: [random ? 'ちがう旋律で' : 'もう一度', () => run(random ? newSeed() : seed)],
      secondary: [random ? ['同じ旋律でもう一度', () => run(seed)] : null, ['設定を変える', setup]],
      foot: [h('span', {}, `自己ベスト: ${rec == null ? '—' : `${fmtScore(rec)} 点`}`), shareButton(game, gs, ms, seed)],
    });
  }
}

/** 音ごとのずれ（横棒。左が低い、右が高い） */
function intonationChart(byPitch, label, tol) {
  const max = 50;
  return h('div', { class: 'sing-into' }, byPitch.map((b) => {
    const v = b.mean;
    const a = v == null ? 0 : Math.min(max, Math.abs(v));
    const cls = v == null ? 'none' : Math.abs(v) <= tol / 2 ? 'ok' : Math.abs(v) <= tol ? 'near' : 'off';
    return h('div', { class: `si-row ${cls}` },
      h('span', { class: 'si-name' }, label(b.midi), h('small', {}, midiSci(b.midi))),
      h('span', { class: 'si-track' },
        h('span', { class: 'si-band', style: { left: `${50 - (50 * tol) / 2 / max}%`, width: `${(100 * tol) / 2 / max}%` } }),
        h('span', { class: 'si-zero' }),
        v == null ? null : h('span', { class: 'si-bar', style: { left: v >= 0 ? '50%' : `${50 - (50 * a) / max}%`, width: `${(50 * a) / max}%` } })),
      h('span', { class: 'si-val' }, v == null ? '聞こえず' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v))}`),
      h('span', { class: 'si-cover' }, `${Math.round(100 * b.cover)}%`));
  }));
}

