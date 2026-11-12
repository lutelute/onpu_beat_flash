// オトバトルの絵（canvas）。見せるだけで、進み方は何も決めない。
//
//   並べ方（大きさ・位置の数）… core/battleLayout.js（テストと同じ計算）
//   楽譜（五線・音部記号・音符）… render/notation.js
//   敵の姿（五線の札を抱えた怪物）… render/battleMonsters.js
//   景色（面ごとの空・城・森…、漂う音符や火の粉）… render/battleScenery.js
//   ここ … それらを組み合わせて 1 コマを描き、エンジンの出来事（命中・突破…）を演出にする
//
// 上から（fall）：下の五線が砦で、真ん中に砲台がある。
// 四方から（around）：画面の真ん中に、五線を丸めた輪の砦と砲台がある。
// 色は CSS の変数から読むので、明るい画面・暗い画面のどちらにも合う。
import { midiOfStep } from '../core/music.js';
import { multiplier } from '../core/battleEngine.js';
import { battleGeometry, engineLayout } from '../core/battleLayout.js';
import { makeNotation, staffSpan, naturalsFor } from './notation.js';
import { makeMonsters } from './battleMonsters.js';
import { makeScenery, NOTE_COLORS, noteMark, sparkle, glowSprite } from './battleScenery.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - (1 - x) ** 3;
const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
const lerp = (a, b, k) => a + (b - a) * k;
/** 音の高さの種類（0 = ド … 11 = シ）。音ごとの色に使う */
const pcOf = (p) => (p && p.step != null ? ((midiOfStep(p.step, p.acc ?? 0) % 12) + 12) % 12 : null);
// コンボの倍率ごとの砲台の光（×2 青・×3 紫・×4 金）
const COMBO_GLOW = { 2: 'rgb(59 130 246)', 3: 'rgb(168 85 247)', 4: 'rgb(255 190 60)' };
const DANGER = 0.72; // ここより砦に近いと、怪物が怒り、札の縁が赤く光る

/**
 * @param canvas
 * @param o.frame     { lo, hi } 出す範囲（第1線 = 0 の位置）。札の高さを決める
 * @param o.clefs     使う音部記号（字形が札からはみ出さない高さにする）
 * @param o.maxPhrase ボスのフレーズの最大の音の数
 * @param o.naming    音名の呼び方（ヒントと答えの表示）
 * @param o.field     'fall'（上から）か 'around'（四方から）
 * @param o.colors    音符を音ごとに色分けするか
 * @param o.answerLabel (id) => 答えた音の表示（外したときに、何と答えたかを見せる）
 * @param o.look      'always'（いつも見える）か 'flash'（現れて flashMs だけ見える。ボスのフレーズは 1 音ずつ光る）
 */
export function makeBattleView(canvas, { frame, clefs = ['treble'], maxPhrase = 6, naming, field = 'fall', colors = false, answerLabel = (id) => id, look = 'always', flashMs = 900 }) {
  const flashSec = flashMs / 1000;
  const around = field === 'around';
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const notation = makeNotation(ctx);
  const monsters = makeMonsters(ctx, { reduced });
  const scenery = makeScenery({ reduced });
  let span = staffSpan(frame, clefs);
  /** 出す範囲・音部記号が変わったとき（「だんだん広がる」の面の替わり目）。このあと resize() を呼ぶ */
  function configure(o) {
    span = staffSpan(o.frame, o.clefs);
  }

  let G = null; // 並べ方（battleGeometry の結果）
  let W = 0;
  let H = 0;
  let dpr = 1;
  let C = {};
  let cur = null; // いま描いている状態（フラッシュ表示で、見えるかどうかを決めるのに使う）
  let stage = 1;

  // 演出
  const ghosts = []; // 倒した・突破した敵の消えていく絵
  const parts = []; // 破片
  const pops = []; // 浮かぶ文字
  const shots = []; // 飛んでいく音符の弾（着いたときに命中の演出）
  const rings = []; // 命中・出現の波紋
  const cracks = []; // 届かれたときの石垣のひび
  const later = []; // 少しあとに起きる演出 { at, fn }（ステージクリアの花火）
  const ringLit = new Array(12).fill(0); // 四方から：12 音の輪のうち、倒した音の光
  let rays = 0; // ボスを倒したときの光の筋（1 → 0）
  let raysAt = { x: 0, y: 0 };
  let dim = 0; // ボス戦で景色を暗くする割合
  let shake = 0;
  let flash = 0; // 砦の赤い光
  let aim = -Math.PI / 2;
  let aimTo = -Math.PI / 2;
  let recoil = 0;
  let time = 0;

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    C = {
      bg: v('--bg', '#f6f3ec'), surface: v('--surface', '#fff'), surface2: v('--surface-2', '#eee'),
      ink: v('--ink', '#1f1d1a'), sub: v('--sub', '#6b665d'), line: v('--line', '#e3dccd'),
      accent: v('--accent', '#2b4c7e'), ok: v('--ok', '#1e9e5a'), ng: v('--ng', '#d8433b'),
      gold: v('--gold', '#e3a11f'), focus: v('--focus-note', '#2b6cd6'), tone: v('--tone', '#b8325a'),
    };
    const th = document.documentElement.dataset.theme;
    C.dark = th === 'dark' || (th !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /** 入れ物の大きさに合わせる。戻り値はエンジンに渡す並べ方 */
  function resize() {
    const r = canvas.getBoundingClientRect();
    // 見えている大きさそのもので描く（水増しすると、低い画面で譜面が縦につぶれ、タップの位置もずれる）
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    G = battleGeometry({ W, H, span, maxPhrase, field });
    readColors();
    buildScenery();
    return engineLayout(G);
  }
  /** 景色を描いておく（大きさ・面・明るさが変わったときだけ、中で描き直す） */
  function buildScenery() {
    if (!G) return;
    const c = cannon();
    scenery.build({ W, H, dpr, G, field, stage, dark: C.dark, cannon: { x: c.x, y: c.y, r: cannonR() } });
  }
  const layout = () => engineLayout(G);

  // ---------------- 位置 ----------------
  const travel = () => Math.max(20, G.baseY - G.topY - G.unitH); // 敵（怪物ごと）の上端が動く距離（battleLayout と同じ）
  const cxOf = (x) => clamp(x * W, G.unitW / 2 + 4, W - G.unitW / 2 - 4); // 端の敵がはみ出さないように
  /** 敵 1 体（怪物ごと）の真ん中 */
  const unitAt = (e) => (around ? { x: cxOf(e.px ?? e.x), y: (e.py ?? 0) * H } : { x: cxOf(e.x), y: G.topY + G.unitH / 2 + e.y * travel() });
  /** 札（五線）の真ん中。命中の光や文字はここに出す */
  const posOf = (e) => {
    const u = unitAt(e);
    return { x: u.x, y: u.y + G.signDy };
  };
  const cannon = () => (around ? { x: G.geo.fx, y: G.geo.fy } : { x: W / 2, y: G.baseY + (H - G.baseY) * 0.55 });
  const cannonR = () => Math.max(10, G.g * 1.25);

  // ---------------- 小道具 ----------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function label(text, x, y, { color = C.ink, size = 13, weight = 700, align = 'center', bg = null, alpha = 1, halo = false, fit = false } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (fit) {
      // 画面の端で切れないように、文字の幅のぶん内側へ
      const w = ctx.measureText(text).width / 2 + 4;
      x = W > 2 * w ? clamp(x, w, W - w) : W / 2;
    }
    if (bg) {
      const w = ctx.measureText(text).width + size * 0.9;
      ctx.fillStyle = bg;
      roundRect(x - w / 2, y - size * 0.75, w, size * 1.5, size * 0.75);
      ctx.fill();
    }
    if (halo) {
      // 背景の絵に重なっても読めるように、地の色で縁取る
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = Math.max(3, size / 5);
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** 音符の色（色分けの設定なら音ごとの色） */
  function noteColor(prompt, color) {
    if (!colors || color !== C.ink) return color;
    const pc = pcOf(prompt);
    if (pc == null) return color;
    return pc === 4 && !C.dark ? '#b88300' : NOTE_COLORS[pc];
  }

  /** 隠れている音符の場所（フラッシュ表示）：五線の真ん中に「?」 */
  function drawHidden(cx, yOf) {
    label('?', cx, yOf(4), { color: C.sub, size: Math.max(12, G.g * 1.5), weight: 800, alpha: 0.75 });
  }

  // ---------------- 敵 ----------------
  /** フラッシュ表示：敵の音符が見えているか（現れたとき・もう一度見たときから flashSec のあいだ） */
  const enemyShown = (e) => look !== 'flash' || !cur || cur.t - Math.max(e.born, cur.peekAt) < flashSec;

  /** 敵 1 体：怪物のうしろ → 札（五線と音符）→ 手。o.mood で表情を決める（なければ近さから） */
  function drawEnemy(e, { alpha = 1, scale = 1, border = null, reveal = false, mood = null } = {}) {
    const g = G.g;
    const { panelW, panelH } = G;
    const u = unitAt(e);
    const wob = e.wobble > 0 && !reduced ? Math.sin(time * 60) * 3 * e.wobble : 0;
    const danger = e.y > DANGER;
    const face = mood ?? (e.wobble > 0 ? 'hurt' : danger ? 'angry' : 'calm');
    const c = cannon();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(u.x + wob, u.y + G.signDy);
    ctx.scale(scale, scale);
    const look = { x: (c.x - u.x - wob) / scale, y: (c.y - u.y - G.signDy) / scale };
    const kind = e.kind === 'row' ? 'row' : e.minion ? 'minion' : 'drop';
    const body = monsters.back(0, 0, panelW, panelH, g, { kind, seed: e.id, look, mood: face, t: time, C, dark: C.dark });
    // 札
    const x0 = -panelW / 2;
    const y0 = -panelH / 2;
    ctx.shadowColor = C.dark ? 'rgb(0 0 0 / 0.5)' : 'rgb(40 30 10 / 0.16)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = C.surface;
    roundRect(x0, y0, panelW, panelH, g * 0.7);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    const pulse = danger ? 0.55 + 0.45 * Math.sin(time * 9) : 0;
    ctx.lineWidth = danger ? 2.4 : 1.4;
    ctx.strokeStyle = border ?? (danger ? C.ng : C.line);
    if (danger && !border) ctx.globalAlpha = alpha * (0.45 + 0.55 * pulse);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    // 五線と音符（render/notation.js）
    const staffTop = y0 + ((span.hi - 8) / 2) * g + 1.2 * g;
    const yOf = notation.staff(x0 + g * 0.5, -x0 - g * 0.5, staffTop, e.q.prompt.clef, C.ink, g);
    const nx = x0 + panelW * 0.68;
    if (reveal || enemyShown(e)) notation.note(nx, yOf, e.q.prompt, noteColor(e.q.prompt, C.ink), g);
    else drawHidden(nx, yOf);
    monsters.front(0, 0, panelW, panelH, g, { body });
    if (e.hinted) label(e.q.reveal(naming), 0, panelH / 2 + 2, { size: Math.max(11, g * 1.25), color: C.ink, bg: C.surface2, alpha: 0.95 });
    ctx.restore();
  }

  // ---------------- ボス ----------------
  const cyBoss = (y) => (around
    ? G.geo.bossTop0 + (G.geo.bossTop1 - G.geo.bossTop0) * Math.min(1, y) + G.bossH / 2
    : G.topB + G.bossH / 2 + y * (G.baseY - G.topB - G.bossH));
  /** ボスの札の位置と、i 番目の音の横の位置（y・n を渡せば、その時点の位置で） */
  function bossGeo(b, y = b.y, n = b.phrase.length) {
    const { bossG: g, bossW, bossH } = G;
    const cy = cyBoss(y);
    const x0 = W / 2 - bossW / 2;
    const first = x0 + g * 6.2;
    const step = n > 1 ? (bossW - g * 8.8) / (n - 1) : 0;
    return { cx: W / 2, cy, x0, y0: cy - bossH / 2, noteX: (i) => (n === 1 ? W / 2 : first + i * step) };
  }

  function drawBoss(b) {
    const { bossG: g, bossW, bossH } = G; // ボスは自分の線間隔（ふつうの敵より大きい）
    const { cx, x0, y0, noteX } = bossGeo(b);
    const fl = b.flash > 0 ? b.flash / 0.5 : 0;
    const c = cannon();
    ctx.save();
    // 魔物のまわりの暗い気配（札のうしろ）
    bossAura(cx, y0 + bossH / 2, bossW, bossH);
    // 札を抱えた大きな魔物（頭と角は札の上）
    const body = monsters.bossBack(cx, y0, bossW, g, { look: c, t: time, dark: C.dark, hurt: b.flash });
    // 札
    ctx.shadowColor = C.dark ? 'rgb(0 0 0 / 0.6)' : 'rgb(80 10 30 / 0.22)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = C.surface;
    roundRect(x0, y0, bossW, bossH, g);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeStyle = fl ? C.gold : C.tone;
    ctx.stroke();
    // 上の帯（名前と HP）
    const band = g * 2.2;
    ctx.save();
    roundRect(x0, y0, bossW, bossH, g);
    ctx.clip();
    ctx.fillStyle = C.tone;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x0, y0, bossW, band);
    ctx.restore();
    label('ボス', x0 + g * 1.2, y0 + band / 2, { color: '#fff', size: Math.max(11, g * 1.2), align: 'left' });
    // HP（残りのフレーズの数）：「あと n」と四角
    const pip = g * 1.1;
    label(`あと${b.hp}フレーズ`, x0 + bossW - g * 1.2 - b.maxHp * (pip + 5) - g * 0.4, y0 + band / 2, { color: '#fff', size: Math.max(10, g * 0.95), align: 'right', weight: 700 });
    for (let i = 0; i < b.maxHp; i++) {
      const px = x0 + bossW - g * 1.2 - (b.maxHp - 1 - i) * (pip + 5) - pip;
      ctx.fillStyle = i < b.hp ? '#fff' : 'rgb(255 255 255 / 0.3)';
      roundRect(px, y0 + band / 2 - pip / 2, pip, pip, 3);
      ctx.fill();
    }
    // フレーズ（前の音の ♯・♭ が同じ高さに効いているときは ♮）
    const clef = b.phrase[0].prompt.clef;
    const staffTop = y0 + band + ((span.hi - 8) / 2) * g + 1.0 * g;
    const yOf = notation.staff(x0 + g * 0.6, x0 + bossW - g * 0.6, staffTop, clef, C.ink, g);
    const nat = naturalsFor(b.phrase.map((q) => q.prompt));
    const seq = b.seq ?? { t0: -Infinity, from: 0 };
    b.phrase.forEach((q, i) => {
      const x = noteX(i);
      const done = i < b.idx;
      const now = i === b.idx;
      if (now) {
        // いま弾く音：うしろに印
        ctx.fillStyle = C.focus;
        ctx.globalAlpha = 0.16;
        roundRect(x - g * 1.7, staffTop - g * 1.6 - ((span.hi - 8) / 2) * g, g * 3.4, ((span.hi - span.lo) / 2) * g + g * 3, g * 0.6);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = done ? 0.45 : 1;
      // フラッシュ表示：まだ弾いていない音は、順に光るあいだだけ見える
      const k = (cur ? cur.t : 0) - seq.t0 - (i - seq.from) * flashSec;
      const shown = done || look !== 'flash' || (i >= seq.from && k >= 0 && k < flashSec);
      if (shown) notation.note(x, yOf, q.prompt, noteColor(q.prompt, done ? C.ok : now ? C.focus : C.ink), g, nat[i]);
      else drawHidden(x, yOf);
      ctx.globalAlpha = 1;
    });
    // 札をつかむ大きな手
    monsters.front(cx, y0 + bossH / 2, bossW, bossH, g * 1.4, { body });
    if (fl && !reduced) {
      ctx.globalAlpha = fl * 0.5;
      ctx.fillStyle = C.gold;
      roundRect(x0, y0, bossW, bossH, g);
      ctx.fill();
    }
    ctx.restore();
  }

  /** ボスのまわりで渦を巻く暗い気配 */
  function bossAura(x, y, w, h) {
    const sp = glowSprite(C.dark ? 'rgb(255 70 130)' : 'rgb(90 10 50)');
    const t = reduced ? 0 : time;
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const a = t * 0.6 + (i / 7) * Math.PI * 2;
      const px = x + Math.cos(a) * w * 0.45;
      const py = y - h * 0.3 + Math.sin(a * 1.3) * h * 0.5;
      const sz = Math.max(w * 0.5, h * 1.1) * (0.8 + 0.2 * Math.sin(t * 1.7 + i));
      ctx.globalAlpha = C.dark ? 0.17 : 0.13;
      ctx.drawImage(sp, px - sz / 2, py - sz / 2, sz, sz);
    }
    ctx.restore();
  }

  // ---------------- 砦と砲台 ----------------
  /** 届かれたときの赤い光。敵より先に（うしろに）描いて、読んでいる楽譜にはかけない */
  function drawFlash() {
    if (flash <= 0) return;
    let gr;
    if (around) {
      gr = ctx.createRadialGradient(G.geo.fx, G.geo.fy, G.geo.ring, G.geo.fx, G.geo.fy, G.geo.ring + G.unitH * 1.4);
      gr.addColorStop(0, `rgb(216 67 59 / ${0.35 * flash})`);
      gr.addColorStop(1, 'rgb(216 67 59 / 0)');
    } else {
      gr = ctx.createLinearGradient(0, G.baseY - 60, 0, H);
      gr.addColorStop(0, 'rgb(216 67 59 / 0)');
      gr.addColorStop(1, `rgb(216 67 59 / ${0.35 * flash})`);
    }
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    // 画面の縁も赤く（どこから届かれても気づくように）
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vg.addColorStop(0, 'rgb(216 67 59 / 0)');
    vg.addColorStop(1, `rgb(216 67 59 / ${0.4 * flash})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /** 四方から：砦のまわりの「12 音の輪」。倒した音の色が光る */
  function drawToneRing() {
    const { fx: x0, fy: y0, ring } = G.geo;
    const R = ring + G.g * 2.2;
    const rot = reduced ? 0 : time * 0.08;
    ctx.save();
    ctx.strokeStyle = C.dark ? 'rgb(255 255 255 / 0.13)' : 'rgb(60 40 20 / 0.12)';
    ctx.lineWidth = 1;
    for (const d of [-0.65, 0.65]) {
      ctx.beginPath();
      ctx.arc(x0, y0, R + d * G.g, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = rot + (i / 12) * Math.PI * 2 - Math.PI / 2;
      const x = x0 + Math.cos(a) * R;
      const y = y0 + Math.sin(a) * R;
      const lit = ringLit[i];
      if (lit > 0) {
        const sz = G.g * 4 * lit;
        ctx.globalAlpha = lit;
        ctx.drawImage(glowSprite(NOTE_COLORS[i]), x - sz / 2, y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 0.5 + 0.5 * lit;
      ctx.fillStyle = NOTE_COLORS[i];
      ctx.beginPath();
      ctx.arc(x, y, G.g * (0.26 + 0.3 * lit), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBase(jammed, combo = 0) {
    const { g, baseY } = G;
    const sp = Math.max(3, g * 0.42);
    ctx.save();
    // 砦の五線（石垣に刻んだ線・砲台を囲む輪）。届かれると赤く光る
    ctx.strokeStyle = flash > 0 ? C.ng : C.dark ? '#d9cdb4' : '#6f604a';
    ctx.globalAlpha = flash > 0 ? 0.5 + flash * 0.5 : around ? 0.42 : 0.5;
    ctx.lineWidth = 1;
    if (around) {
      // 砦 = 砲台を囲む五線の輪
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(G.geo.fx, G.geo.fy, G.geo.core + i * G.geo.sp, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // 砦 = 横いっぱいの五線
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        ctx.moveTo(0, baseY + 3 + i * sp);
        ctx.lineTo(W, baseY + 3 + i * sp);
      }
      ctx.stroke();
    }
    ctx.restore();
    // 届かれたところの、石垣のひび
    for (const k of cracks) drawCrack(k);
    // 砲台
    const { x, y } = cannon();
    const r = cannonR();
    const m = multiplier(combo);
    // コンボの光（×2 青・×3 紫・×4 金）。速く回るほど倍率が高い
    if (m > 1 && !jammed) {
      const col = COMBO_GLOW[Math.min(4, m)];
      const sz = r * (4.4 + (reduced ? 0 : 0.4 * Math.sin(time * 5)));
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glowSprite(col), x - sz / 2, y - sz / 2, sz, sz);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([r * 0.55, r * 0.35]);
      ctx.lineDashOffset = reduced ? 0 : -time * 26 * m;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 砲身（金の輪のついた筒）
    const back = recoil * r * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aim + Math.PI / 2);
    ctx.fillStyle = jammed ? C.sub : C.dark ? '#4a4f5c' : '#2d2a26';
    roundRect(-r * 0.3, -r * 2.15 + back, r * 0.6, r * 1.65, r * 0.22);
    ctx.fill();
    ctx.fillStyle = jammed ? C.sub : C.gold;
    roundRect(-r * 0.38, -r * 2.3 + back, r * 0.76, r * 0.34, r * 0.12);
    ctx.fill();
    // 撃った瞬間の、砲口の光
    if (recoil > 0.35 && !jammed) {
      const sz = r * 2.6 * recoil;
      ctx.globalAlpha = recoil;
      ctx.drawImage(glowSprite('rgb(255 222 130)'), -sz / 2, -r * 2.3 + back - sz / 2, sz, sz);
    }
    ctx.restore();
    // 金の全音符
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = jammed ? 'transparent' : C.gold;
    ctx.shadowBlur = jammed ? 0 : 14;
    ctx.fillStyle = jammed ? C.sub : C.gold;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.25, r * 0.85, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // 光の照り
    ctx.fillStyle = 'rgb(255 255 255 / 0.35)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.55, -r * 0.35, r * 0.4, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = around ? (C.dark ? '#2a2c31' : '#efe7d6') : C.dark ? '#2a2c31' : '#efe7d6';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.5, r * 0.62, 0.9, 0, Math.PI * 2);
    ctx.fill();
    if (jammed) {
      // 撃てないあいだ：回る点線
      ctx.strokeStyle = C.ng;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -time * 40;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** 石垣のひび（上から：届かれた横の位置。四方から：砦の石の台） */
  function drawCrack(k) {
    const a = Math.min(1, k.life / k.max / 0.4);
    const R = k.rnd;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.dark ? '#0b0b0d' : '#4a3b2a';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      let px = k.x;
      let py = k.y;
      ctx.moveTo(px, py);
      for (let i = 0; i < 4; i++) {
        const along = (R[(j * 8 + i * 2) % R.length] * 0.8 + 0.2) * G.g;
        const side = (R[(j * 8 + i * 2 + 1) % R.length] - 0.5) * G.g * 1.8;
        px += k.ux * along - k.uy * side;
        py += k.uy * along + k.ux * side;
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    // 割れ目の赤い光
    ctx.globalAlpha = a * 0.6 * Math.min(1, k.life);
    ctx.strokeStyle = C.ng;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- 演出 ----------------
  /**
   * 破片を飛ばす。shape: 'bit'（四角）・'note'（♪）・'spark'（きらめき）・'puff'（煙）
   * grav = 下向きの重さ（花火の音符は軽く、ゆっくり落ちる）
   */
  function burst(x, y, color, n = 16, power = 1, { shape = 'bit', grav = 420, life = 0.7 } = {}) {
    const k = reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 180) * power;
      const c = Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life, max: life, size: 2 + Math.random() * 4, color: c, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, shape, grav });
    }
  }
  function puff(x, y, color, n = 4) {
    for (let i = 0; i < (reduced ? 1 : n); i++) {
      const a = Math.random() * Math.PI * 2;
      parts.push({ x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30 - 20, life: 0.6, max: 0.6, size: G.g * (0.8 + Math.random() * 0.6), color, rot: 0, vr: 0, shape: 'puff', grav: -30 });
    }
  }
  function ripple(x, y, color, r1, life = 0.42, width = 3) {
    if (reduced) return; // 動きを減らす設定では、広がる輪は出さない
    rings.push({ x, y, r0: G.g * 0.8, r1, color, life, max: life, width });
  }
  function pop(text, x, y, color, size = 18, life = 0.95) {
    pops.push({ text, x, y, color, size, life, max: life });
  }
  /** 当たったところの演出：波紋・破片・飛び散る音符 */
  function impact(x, y, color, big = 1) {
    ripple(x, y, color, G.g * 7 * big);
    burst(x, y, color, Math.round(14 * big));
    burst(x, y, NOTE_COLORS, Math.round(5 * big), 0.8, { shape: 'note', grav: -50, life: 0.9 });
    burst(x, y, C.gold, Math.round(6 * big), 0.7, { shape: 'spark', grav: 120, life: 0.6 });
  }
  /**
   * 砲台から音符の弾を撃つ。着いたら onHit()。戻り値は着くまでの秒数（動きを減らす設定では 0 で、すぐ onHit）
   */
  function shoot(tx, ty, onHit) {
    const c = cannon();
    aimTo = Math.atan2(ty - c.y, tx - c.x);
    recoil = 1;
    const d = Math.hypot(tx - c.x, ty - c.y);
    const dur = reduced ? 0 : Math.min(0.16, 0.05 + d / 3200);
    if (!dur) {
      onHit?.();
      return 0;
    }
    const r = cannonR() * 2.2;
    shots.push({ x0: c.x + Math.cos(aimTo) * r, y0: c.y + Math.sin(aimTo) * r, x1: tx, y1: ty, t: 0, dur, onHit });
    return dur;
  }
  const aboveCannon = () => {
    const c = cannon();
    return { x: c.x, y: c.y - (around ? G.geo.ring + 16 : 34) };
  };
  /** ひびを入れる（x, y から ux, uy の向きへ） */
  function crack(x, y, ux, uy) {
    cracks.push({ x, y, ux, uy, life: 2.2, max: 2.2, rnd: Array.from({ length: 24 }, Math.random) });
  }
  /** 花火（ステージクリア） */
  function firework() {
    const x = W * (0.18 + Math.random() * 0.64);
    const y = (around ? H : G.baseY) * (0.12 + Math.random() * 0.3);
    const col = NOTE_COLORS[Math.floor(Math.random() * 12)];
    ripple(x, y, col, G.g * 9, 0.6, 2);
    burst(x, y, col, 26, 1.1, { shape: 'spark', grav: 90, life: 1.1 });
    burst(x, y, NOTE_COLORS, 6, 0.6, { shape: 'note', grav: 40, life: 1.2 });
  }

  /** エンジンの出来事を絵にする（s = いまの状態） */
  function fx(ev, s) {
    const { g, panelH, bossH } = G;
    if (ev.type === 'hit') {
      const { x, y } = posOf(ev.e);
      const pc = pcOf(ev.e.q.prompt);
      const ghost = { e: { ...ev.e }, life: 0.38, max: 0.38, hold: 0, color: C.ok, mood: 'dead' };
      ghosts.push(ghost);
      const dur = shoot(x, y, () => {
        impact(x, y, C.ok);
        pop(ev.e.q.reveal(naming), x, y - panelH * 0.2, C.ok, Math.max(17, g * 2), 0.7);
        pop(`+${ev.pts}`, x, y + panelH * 0.3, C.sub, 13, 0.6);
        if (pc != null) ringLit[pc] = 1;
        shake = Math.max(shake, 0.08);
      });
      // 弾が着くまでは、倒された敵はそのままの姿（びくっとして）で待つ
      ghost.hold = dur;
      ghost.life += dur;
      ghost.max += dur;
      // コンボの倍率が上がったとき
      if (ev.combo >= 10 && ev.combo % 10 === 0 && ev.combo <= 30) {
        const p = aboveCannon();
        pop(`コンボ ×${multiplier(ev.combo)}`, p.x, p.y - 14, C.gold, 20, 1.1);
      }
    } else if (ev.type === 'boss') {
      if (s.boss || ev.down) {
        const { cy, noteX } = bossGeo(s.boss ?? { phrase: [] }, ev.bossY, ev.n);
        const x = noteX(ev.idx);
        const pc = pcOf(ev.q.prompt);
        shoot(x, cy, () => {
          impact(x, cy, C.ok, 0.7);
          pop(ev.q.reveal(naming), x, cy - bossH * 0.42, C.ok, Math.max(14, g * 1.5), 0.8);
          if (pc != null) ringLit[pc] = 1;
        });
      }
      if (ev.phraseDone) {
        shake = Math.max(shake, 0.35);
        pop(ev.down ? '撃破！' : 'フレーズ成功！', W / 2, H * 0.45, C.gold, 26, 1.2);
      }
    } else if (ev.type === 'miss') {
      if (ev.blame) ev.blame.wobble = 0.4;
      // 何と答えたかは、戦場の外の知らせの行（battleHud）に出す。ここは砲台の小さな印と煙だけ
      const p = aboveCannon();
      pop('×', p.x, p.y, C.ng, 22, 0.6);
      const c = cannon();
      puff(c.x, c.y - cannonR(), C.dark ? 'rgb(160 160 170)' : 'rgb(120 110 100)');
      shake = Math.max(shake, 0.12);
    } else if (ev.type === 'breach') {
      // 何の音だったかは、消えていく札（音符を見せる）と、戦場の外の知らせの行で伝える（ほかの敵の楽譜に文字を重ねない）
      const { x, y } = posOf(ev.e);
      ghosts.push({ e: { ...ev.e }, life: 0.5, max: 0.5, color: C.ng, mood: 'angry' });
      if (around) {
        const d = Math.hypot(x - G.geo.fx, y - G.geo.fy) || 1;
        const ux = (G.geo.fx - x) / d;
        const uy = (G.geo.fy - y) / d;
        const rr = G.geo.ring + G.g * 0.9;
        burst(G.geo.fx - ux * rr, G.geo.fy - uy * rr, C.ng, 22, 1.1);
        crack(G.geo.fx - ux * rr, G.geo.fy - uy * rr, ux, uy);
      } else {
        burst(x, G.baseY, C.ng, 22, 1.1);
        burst(x, G.baseY, C.dark ? '#5a5a62' : '#b8ab92', 10, 0.8);
        crack(x, G.baseY, 0, 1);
      }
      flash = 1;
      shake = Math.max(shake, 0.45);
    } else if (ev.type === 'bossBreach') {
      flash = 1;
      shake = Math.max(shake, 0.7);
      const x = W / 2;
      const y = around ? G.geo.fy - G.geo.ring : G.baseY;
      burst(x, y, C.ng, 40, 1.4);
      for (const dx of [-1, 0, 1]) crack(x + dx * G.g * 4, y, dx * 0.4, 1);
    } else if (ev.type === 'bossDown') {
      const y = cyBoss(ev.boss.y);
      burst(W / 2, y, C.gold, 60, 1.6);
      burst(W / 2, y, C.tone, 30, 1.2);
      burst(W / 2, y, NOTE_COLORS, 18, 1.1, { shape: 'note', grav: 60, life: 1.4 });
      ripple(W / 2, y, C.gold, Math.max(W, H) * 0.5, 0.8, 5);
      rays = 1;
      raysAt = { x: W / 2, y };
      shake = Math.max(shake, 0.8);
    } else if (ev.type === 'bossStart') {
      shake = Math.max(shake, 0.3);
      const y = cyBoss(0);
      ripple(W / 2, y, C.tone, G.bossW * 0.6, 0.7, 4);
      puff(W / 2, y, C.dark ? 'rgb(120 40 80)' : 'rgb(90 20 50)', 8);
    } else if (ev.type === 'spawn') {
      // 現れたところに、小さな煙の輪
      const { x, y } = posOf(ev.e);
      ripple(x, y, C.dark ? 'rgb(200 180 255)' : 'rgb(110 80 140)', G.g * 5, 0.35, 1.5);
    } else if (ev.type === 'stageClear') {
      for (let i = 0; i < (reduced ? 1 : 5); i++) later.push({ at: time + 0.1 + i * 0.32, fn: firework });
    } else if (ev.type === 'peek') {
      const p = aboveCannon();
      pop('もう一度', p.x, p.y, C.sub, 15, 0.8);
    } else if (ev.type === 'vanish') {
      ghosts.push({ e: { ...ev.e }, life: 0.4, max: 0.4, color: C.gold, mood: 'dead' });
      const { x, y } = posOf(ev.e);
      burst(x, y, C.gold, 10, 0.8);
    }
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt);
    flash = Math.max(0, flash - dt * 1.6);
    recoil = Math.max(0, recoil - dt * 6);
    rays = Math.max(0, rays - dt / 1.4);
    aim += (aimTo - aim) * Math.min(1, dt * 14);
    dim += ((cur?.boss ? 1 : 0) - dim) * Math.min(1, dt * 1.5);
    for (let i = 0; i < 12; i++) ringLit[i] = Math.max(0, ringLit[i] - dt * 1.4);
    for (const list of [ghosts, parts, pops, rings, cracks]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        o.life -= dt;
        if (o.life <= 0) list.splice(i, 1);
      }
    }
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i];
      sh.t += dt;
      if (sh.t >= sh.dur) {
        shots.splice(i, 1);
        sh.onHit?.();
      }
    }
    for (let i = later.length - 1; i >= 0; i--) {
      if (time >= later[i].at) later.splice(i, 1)[0].fn();
    }
    for (const p of parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      p.vx *= 0.985;
      p.rot += p.vr * dt;
    }
    for (const p of pops) p.y -= 28 * dt;
  }

  function drawParts() {
    for (const p of parts) {
      const k = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.shape === 'puff') {
        ctx.globalAlpha = k * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1 + (1 - k) * 1.6), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'note') {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.rotate(Math.sin(p.rot) * 0.4);
        noteMark(ctx, 0, 0, G.g * 0.5, p.color);
      } else if (p.shape === 'spark') {
        ctx.globalAlpha = k;
        sparkle(ctx, 0, 0, p.size * 1.3, p.color);
      } else {
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
    }
  }

  function drawRings() {
    for (const r of rings) {
      const k = 1 - r.life / r.max;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, ease(k)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** ボスを倒したときの、回る光の筋 */
  function drawRays() {
    if (rays <= 0) return;
    const { x, y } = raysAt;
    const n = 12;
    const L = Math.hypot(W, H);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(reduced ? 0 : time * 0.6);
    ctx.globalAlpha = rays * 0.45;
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - 0.08) * L, Math.sin(a - 0.08) * L);
      ctx.lineTo(Math.cos(a + 0.08) * L, Math.sin(a + 0.08) * L);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  /** 飛んでいく音符の弾（尾を引く光） */
  function drawShots() {
    for (const sh of shots) {
      const k = ease(Math.min(1, sh.t / sh.dur));
      const hx = lerp(sh.x0, sh.x1, k);
      const hy = lerp(sh.y0, sh.y1, k);
      const tk = Math.max(0, k - 0.45);
      const tx = lerp(sh.x0, sh.x1, tk);
      const ty = lerp(sh.y0, sh.y1, tk);
      ctx.save();
      const gr = ctx.createLinearGradient(tx, ty, hx, hy);
      gr.addColorStop(0, 'rgb(255 200 80 / 0)');
      gr.addColorStop(1, 'rgb(255 226 140 / 0.95)');
      ctx.strokeStyle = gr;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, G.g * 0.5);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      const sz = G.g * 3.4;
      ctx.drawImage(glowSprite('rgb(255 200 70)'), hx - sz / 2, hy - sz / 2, sz, sz);
      ctx.fillStyle = '#fffaf0';
      ctx.beginPath();
      ctx.ellipse(hx, hy, G.g * 0.5, G.g * 0.36, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** 1 コマ描く。o.aim = 照準（画面の px）、o.heard = マイクで聞こえている音 */
  function draw(s, dt, { jammed = false, aim: target = null, heard = undefined } = {}) {
    cur = s;
    update(dt);
    if (s.stage !== stage) {
      // 面が替わった：景色を入れ替える
      stage = s.stage;
      buildScenery();
    }
    for (const e of s.enemies) if (e.wobble > 0) e.wobble = Math.max(0, e.wobble - dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 景色（面ごと。ボス戦では少し暗く）
    scenery.draw(ctx, dt, time, { dim });
    // 砦に近いところをうっすら赤く（ここまで来たら危ない）
    if (around) {
      const r0 = G.geo.ring;
      const gr = ctx.createRadialGradient(G.geo.fx, G.geo.fy, r0, G.geo.fx, G.geo.fy, r0 + Math.max(G.unitW, G.unitH) * 0.9);
      gr.addColorStop(0, `rgb(216 67 59 / ${C.dark ? 0.16 : 0.1})`);
      gr.addColorStop(1, 'rgb(216 67 59 / 0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
      drawToneRing();
    } else {
      const dz = G.topY + DANGER * travel() + G.unitH / 2;
      const gr = ctx.createLinearGradient(0, dz, 0, G.baseY);
      gr.addColorStop(0, 'rgb(216 67 59 / 0)');
      gr.addColorStop(1, `rgb(216 67 59 / ${C.dark ? 0.14 : 0.08})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, dz, W, G.baseY - dz);
    }
    drawFlash();
    // 光の筋・波紋・破片は敵のうしろに（読んでいる楽譜にかからないように）
    drawRays();
    drawRings();
    drawParts();
    if (s.boss) drawBoss(s.boss);
    for (const e of s.enemies) drawEnemy(e);
    for (const gh of ghosts) {
      // 弾が着くまで（hold）は、そのままの濃さでびくっとしている
      const held = gh.hold > 0 && gh.life > gh.max - gh.hold;
      const k = held ? 1 : gh.life / (gh.max - (gh.hold || 0));
      drawEnemy(gh.e, { alpha: k, scale: 1 + (1 - k) * 0.18, border: held ? null : gh.color, reveal: true, mood: held ? 'hurt' : gh.mood });
    }
    drawShots();
    // 揺れは砦と砲台だけ（楽譜は揺らさない）
    ctx.save();
    if (shake > 0 && !reduced) {
      const m = shake * 10;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    drawBase(jammed, s.combo);
    ctx.restore();
    if (target) drawAim(s, target);
    if (heard !== undefined) drawHeard(heard);
    for (const p of pops) {
      const k = p.life / p.max;
      label(p.text, p.x, p.y, { color: p.color, size: p.size * (1 + (1 - ease(Math.min(1, (1 - k) * 4))) * 0.4), alpha: Math.min(1, k * 2.5), weight: 800, halo: true, fit: true });
    }
  }

  /** マイク：いま聞こえている音（もとのオトバトルの「検出中」の表示）。heard = { text, gated } か null */
  function drawHeard(heard) {
    const c = cannon();
    const x = around ? c.x : c.x + Math.max(10, G.g * 1.25) * 2.4;
    const y = around ? c.y + G.geo.ring + 14 : c.y;
    const color = heard && !heard.gated ? C.ink : C.sub;
    const mx = around ? x - 20 : x + 5;
    ctx.save();
    ctx.globalAlpha = heard ? 1 : 0.55;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    roundRect(mx - 3, y - 8, 6, 10, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, y - 1, 5.5, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.moveTo(mx, y + 4.5);
    ctx.lineTo(mx, y + 8);
    ctx.stroke();
    ctx.restore();
    const text = heard ? (heard.gated ? '…' : heard.text) : '';
    if (text) label(text, mx + 10, y, { color, size: 13, align: 'left', halo: true });
  }

  /** 照準：十字と、いちばん近い敵の枠（同じ音が 2 つあるとき、こちらを撃つ） */
  function drawAim(s, p) {
    const { g, panelW, panelH } = G;
    let best = null;
    let bd = Infinity;
    for (const e of s.enemies) {
      const q = posOf(e);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) [best, bd] = [e, d];
    }
    ctx.save();
    if (best && bd < Math.max(panelW, panelH) * 1.6) {
      const q = posOf(best);
      ctx.strokeStyle = C.focus;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -time * 20;
      roundRect(q.x - panelW / 2 - 5, q.y - panelH / 2 - 5, panelW + 10, panelH + 10, g);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = C.focus;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    const r = 11;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(p.x + dx * (r - 4), p.y + dy * (r - 4));
      ctx.lineTo(p.x + dx * (r + 6), p.y + dy * (r + 6));
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 画面の上での敵（札）の位置（照準からの近さを測る） */
  const where = (e) => posOf(e);
  /** ボスの「いま弾く音」の画面の上の位置 */
  const bossNoteAt = (b) => {
    const { cy, noteX } = bossGeo(b);
    return { x: noteX(b.idx), y: cy };
  };
  /** 砲台のあたりを押したか（フラッシュ表示で「もう一度見る」に使う） */
  const onCannon = (p) => {
    const c = cannon();
    return Math.hypot(p.x - c.x, p.y - c.y) < Math.max(28, around ? G.geo.ring : G.g * 3);
  };

  return { resize, layout, configure, draw, fx, where, bossNoteAt, onCannon, colors: () => C };
}
