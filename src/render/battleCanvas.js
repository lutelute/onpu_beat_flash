// オトバトルの絵（canvas）。見せるだけで、進み方は何も決めない。
//
//   並べ方（大きさ・位置の数）… core/battleLayout.js（テストと同じ計算）
//   楽譜（五線・音部記号・音符）… render/notation.js
//   敵の姿（五線の札を抱えた怪物）… render/battleMonsters.js
//   ここ … それらを組み合わせて 1 コマを描き、エンジンの出来事（命中・突破…）を演出にする
//
// 上から（fall）：下の五線が砦で、真ん中に砲台がある。
// 四方から（around）：画面の真ん中に、五線を丸めた輪の砦と砲台がある。
// 色は CSS の変数から読むので、明るい画面・暗い画面のどちらにも合う。
import { midiOfStep } from '../core/music.js';
import { battleGeometry, engineLayout } from '../core/battleLayout.js';
import { makeNotation, staffSpan, naturalsFor } from './notation.js';
import { makeMonsters } from './battleMonsters.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (x) => 1 - (1 - x) ** 3;
const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
// 音ごとの色（もとのオトバトルと同じ並び。ド = 赤 … シ = 紫。明るい画面ではミの黄色を濃くする）
const NOTE_COLORS = ['#ef4444', '#dc2626', '#f97316', '#ea580c', '#eab308', '#22c55e', '#16a34a', '#3b82f6', '#2563eb', '#6366f1', '#4f46e5', '#a855f7'];
// ステージごとの背景の色合い（もとのオトバトルの各面の色相。6 面めからは回していく）
const STAGE_HUES = [210, 150, 280, 35, 0];
const stageHue = (n) => (n <= STAGE_HUES.length ? STAGE_HUES[n - 1] : (STAGE_HUES.at(-1) + (n - STAGE_HUES.length) * 47) % 360);
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
  const beams = []; // 砲台からの光
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
    return engineLayout(G);
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
    const pc = ((midiOfStep(prompt.step, prompt.acc ?? 0) % 12) + 12) % 12;
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
  }

  function drawBase(jammed) {
    const { g, baseY } = G;
    const sp = Math.max(3, g * 0.42);
    ctx.save();
    ctx.strokeStyle = flash > 0 ? C.ng : C.sub;
    ctx.globalAlpha = flash > 0 ? 0.5 + flash : around ? 0.4 : 0.35;
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
    // 砲台：金色の全音符に砲身
    const { x, y } = cannon();
    const r = Math.max(10, g * 1.25);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(aim + Math.PI / 2);
    ctx.fillStyle = jammed ? C.sub : C.ink;
    roundRect(-r * 0.22, -r * 2.1 + recoil * r * 0.5, r * 0.44, r * 1.6, r * 0.2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = jammed ? 'transparent' : C.gold;
    ctx.shadowBlur = jammed ? 0 : 14;
    ctx.fillStyle = jammed ? C.sub : C.gold;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.25, r * 0.85, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = C.bg;
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

  // ---------------- 演出 ----------------
  function burst(x, y, color, n = 16, power = 1) {
    const k = reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 180) * power;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.7, max: 0.7, size: 2 + Math.random() * 4, color, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
    }
  }
  function pop(text, x, y, color, size = 18, life = 0.95) {
    pops.push({ text, x, y, color, size, life, max: life });
  }
  function shoot(tx, ty, color) {
    const c = cannon();
    aimTo = Math.atan2(ty - c.y, tx - c.x);
    recoil = 1;
    beams.push({ x0: c.x, y0: c.y, x1: tx, y1: ty, color, life: 0.22, max: 0.22 });
  }
  const aboveCannon = () => {
    const c = cannon();
    return { x: c.x, y: c.y - (around ? G.geo.ring + 16 : 34) };
  };

  /** エンジンの出来事を絵にする（s = いまの状態） */
  function fx(ev, s) {
    const { g, panelH, bossH } = G;
    if (ev.type === 'hit') {
      const { x, y } = posOf(ev.e);
      shoot(x, y, C.gold);
      ghosts.push({ e: { ...ev.e }, life: 0.38, max: 0.38, color: C.ok, mood: 'dead' });
      burst(x, y, C.ok, 18);
      burst(x, y, C.gold, 8, 0.7);
      pop(ev.e.q.reveal(naming), x, y - panelH * 0.2, C.ok, Math.max(17, g * 2), 0.7);
      pop(`+${ev.pts}`, x, y + panelH * 0.3, C.sub, 13, 0.6);
      shake = Math.max(shake, 0.08);
    } else if (ev.type === 'boss') {
      if (s.boss || ev.down) {
        const { cy, noteX } = bossGeo(s.boss ?? { phrase: [] }, ev.bossY, ev.n);
        const x = noteX(ev.idx);
        shoot(x, cy, C.gold);
        burst(x, cy, C.ok, 10, 0.7);
        pop(ev.q.reveal(naming), x, cy - bossH * 0.42, C.ok, Math.max(14, g * 1.5), 0.8);
      }
      if (ev.phraseDone) {
        shake = Math.max(shake, 0.35);
        pop(ev.down ? '撃破！' : 'フレーズ成功！', W / 2, H * 0.45, C.gold, 26, 1.2);
      }
    } else if (ev.type === 'miss') {
      if (ev.blame) ev.blame.wobble = 0.4;
      // 何と答えたか（マイクで答えたとき、何の音に聞こえたかが分かるように）
      // 何と答えたかは、戦場の外の知らせの行（battleHud）に出す。ここは砲台の小さな印だけ
      const p = aboveCannon();
      pop('×', p.x, p.y, C.ng, 22, 0.6);
      shake = Math.max(shake, 0.12);
    } else if (ev.type === 'breach') {
      const { x, y } = posOf(ev.e);
      ghosts.push({ e: { ...ev.e }, life: 0.5, max: 0.5, color: C.ng, mood: 'angry' });
      burst(x, around ? y : G.baseY, C.ng, 22, 1.1);
      flash = 1;
      shake = Math.max(shake, 0.45);
      // 何の音だったかを見せる（覚え直せるように）
      // 何の音だったかは、消えていく札（音符を見せる）と、戦場の外の知らせの行で伝える（ほかの敵の楽譜に文字を重ねない）
    } else if (ev.type === 'bossBreach') {
      flash = 1;
      shake = Math.max(shake, 0.7);
      burst(W / 2, around ? G.geo.fy - G.geo.ring : G.baseY, C.ng, 40, 1.4);
    } else if (ev.type === 'bossDown') {
      burst(W / 2, cyBoss(ev.boss.y), C.gold, 60, 1.6);
      burst(W / 2, cyBoss(ev.boss.y), C.tone, 30, 1.2);
      shake = Math.max(shake, 0.8);
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
    aim += (aimTo - aim) * Math.min(1, dt * 14);
    for (const list of [ghosts, parts, pops, beams]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        o.life -= dt;
        if (o.life <= 0) list.splice(i, 1);
      }
    }
    for (const p of parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      p.vx *= 0.985;
      p.rot += p.vr * dt;
    }
    for (const p of pops) p.y -= 28 * dt;
  }

  /** 1 コマ描く。o.aim = 照準（画面の px）、o.heard = マイクで聞こえている音 */
  function draw(s, dt, { jammed = false, aim: target = null, heard = undefined } = {}) {
    update(dt);
    stage = s.stage;
    cur = s;
    for (const e of s.enemies) if (e.wobble > 0) e.wobble = Math.max(0, e.wobble - dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 背景：ステージごとにうっすら色を変える（もとのオトバトルの面の色）
    const tint = ctx.createLinearGradient(0, 0, 0, H);
    tint.addColorStop(0, `hsl(${stageHue(stage)} 70% ${C.dark ? 45 : 55}% / ${C.dark ? 0.16 : 0.1})`);
    tint.addColorStop(1, `hsl(${stageHue(stage)} 70% 50% / 0)`);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    // 砦に近いところをうっすら赤く（ここまで来たら危ない）
    if (around) {
      const r0 = G.geo.ring;
      const gr = ctx.createRadialGradient(G.geo.fx, G.geo.fy, r0, G.geo.fx, G.geo.fy, r0 + Math.max(G.unitW, G.unitH) * 0.9);
      gr.addColorStop(0, `rgb(216 67 59 / ${C.dark ? 0.16 : 0.1})`);
      gr.addColorStop(1, 'rgb(216 67 59 / 0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    } else {
      const dz = G.topY + DANGER * travel() + G.unitH / 2;
      const gr = ctx.createLinearGradient(0, dz, 0, G.baseY);
      gr.addColorStop(0, 'rgb(216 67 59 / 0)');
      gr.addColorStop(1, `rgb(216 67 59 / ${C.dark ? 0.14 : 0.08})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, dz, W, G.baseY - dz);
    }
    drawFlash();
    // 破片は敵のうしろに（読んでいる楽譜にかからないように）
    for (const p of parts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (s.boss) drawBoss(s.boss);
    for (const e of s.enemies) drawEnemy(e);
    for (const gh of ghosts) {
      const k = gh.life / gh.max;
      drawEnemy(gh.e, { alpha: k, scale: 1 + (1 - k) * 0.18, border: gh.color, reveal: true, mood: gh.mood });
    }
    // 光の筋
    for (const b of beams) {
      const k = b.life / b.max;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = b.color;
      ctx.lineCap = 'round';
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2 + 4 * k;
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y0);
      ctx.lineTo(b.x1, b.y1);
      ctx.stroke();
      ctx.restore();
    }
    // 揺れは砦と砲台だけ（楽譜は揺らさない）
    ctx.save();
    if (shake > 0 && !reduced) {
      const m = shake * 10;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    drawBase(jammed);
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
