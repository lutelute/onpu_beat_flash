// オトバトルの景色（canvas）。札（楽譜）のうしろだけに描き、楽譜の読みやすさは変えない。
//
//   景色 … 面（ステージ）ごとに替わる。画面の大きさ・面・明るさが変わったときだけ、別の canvas に描いておく（毎コマは描かない）
//   漂うもの … 音符・ほたる・きらめき・砂ぼこり・火の粉・星。毎コマ動かすが数は少なく、動きを減らす設定では出さない
//
// 上から（fall）は横から見た景色（空・遠くの城や森・手前の丘・砦の石垣と砲台の台）。
// 四方から（around）は上から見た広場（地面の模様・砦へ向かう道・砦の石の台）。
// 面の替わり目は、前の景色から少しずつ入れ替える。

// 音ごとの色（もとのオトバトルと同じ並び。ド = 赤 … シ = 紫）。札の音符の色分けと、広場の「12 音の輪」に使う
export const NOTE_COLORS = ['#ef4444', '#dc2626', '#f97316', '#ea580c', '#eab308', '#22c55e', '#16a34a', '#3b82f6', '#2563eb', '#6366f1', '#4f46e5', '#a855f7'];

// 面ごとの景色。はじめの 5 面は、もとのオトバトルの面の名前と色相に合わせてある
const SCENES = [
  { id: 'gate', hue: 210 }, // ハ長調の門：青空と遠くの城門
  { id: 'forest', hue: 150 }, // 低音の森：針葉樹の森とほたる
  { id: 'maze', hue: 280 }, // 半音の迷宮：鍵盤のように並ぶ柱
  { id: 'dusk', hue: 35 }, // 三種の調べ：夕焼けと 3 つの塔
  { id: 'king', hue: 0 }, // 不協和の王：とげの山と城、火の粉
];
/** 面 n（1 から）の景色。6 面めからは「混沌」で、色相を回していく */
export function sceneOf(n) {
  if (n >= 1 && n <= SCENES.length) return SCENES[Math.floor(n) - 1];
  const k = Number.isFinite(n) ? Math.max(1, Math.floor(n) - SCENES.length) : 1; // おかしな番号でも色が決まるように
  return { id: 'chaos', hue: (SCENES.at(-1).hue + k * 47) % 360 };
}
/** 漂うものの種類 */
export const MOTE_OF = { gate: 'note', forest: 'firefly', maze: 'sparkle', dusk: 'dust', king: 'ember', chaos: 'star' };

/** 種つきの乱数（景色の形を、同じ大きさ・同じ面なら同じにする） */
function rnd(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hsl = (h, s, l, a = 1) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;

// 手前の地面の色（明るい画面。上 → 砦のそば）。草地・森の下草・石の床・砂・焼けた土
const GROUND = {
  gate: [[95, 30, 85], [85, 24, 78]], forest: [[130, 26, 81], [125, 22, 73]], maze: [[280, 18, 87], [280, 14, 80]],
  dusk: [[38, 48, 83], [32, 40, 75]], king: [[350, 16, 76], [350, 13, 68]],
};
/** 景色の色。明るい画面はうすい色、暗い画面は夜 */
function palette(scene, dark) {
  const h = scene.hue;
  if (dark) {
    const p = {
      skyTop: hsl(h + 10, 45, 7), skyBot: hsl(h, 38, 17), far: hsl(h, 28, 15), mid: hsl(h, 26, 12),
      glow: hsl(h + 30, 80, 70, 0.22), stone: hsl(h, 8, 19), stoneLine: hsl(h, 10, 11), floor0: hsl(h, 30, 15), floor1: hsl(h, 34, 7),
      mark: hsl(h, 40, 55, 0.14), road: hsl(h, 22, 19, 0.55),
    };
    if (scene.id === 'dusk') Object.assign(p, { skyTop: hsl(260, 40, 9), skyBot: hsl(15, 45, 20), glow: hsl(20, 90, 60, 0.3) });
    if (scene.id === 'king') Object.assign(p, { skyTop: hsl(350, 40, 6), skyBot: hsl(5, 50, 16), glow: hsl(18, 95, 55, 0.35) });
    p.ground = [hsl(h, 24, 11), hsl(h, 22, 7)];
    return p;
  }
  const gd = GROUND[scene.id] ?? [[h, 22, 85], [h, 18, 78]];
  const p = {
    ground: gd.map(([a, b, c]) => hsl(a, b, c)),
    skyTop: hsl(h, 58, 84), skyBot: hsl(h + 18, 55, 94), far: hsl(h, 24, 82), mid: hsl(h, 22, 76),
    glow: hsl(h + 30, 90, 97, 0.9), stone: hsl(35, 16, 84), stoneLine: hsl(35, 14, 70), floor0: hsl(h, 36, 94), floor1: hsl(h, 30, 84),
    mark: hsl(h, 30, 45, 0.09), road: hsl(35, 35, 90, 0.5),
  };
  if (scene.id === 'dusk') Object.assign(p, { skyTop: hsl(28, 70, 82), skyBot: hsl(45, 85, 91), far: hsl(25, 30, 78), mid: hsl(25, 26, 72), glow: hsl(30, 100, 88, 0.95) });
  if (scene.id === 'king') Object.assign(p, { skyTop: hsl(350, 40, 80), skyBot: hsl(15, 55, 90), far: hsl(350, 18, 74), mid: hsl(350, 16, 66), glow: hsl(10, 90, 90, 0.9) });
  if (scene.id === 'chaos') Object.assign(p, { skyTop: hsl(h, 40, 80), skyBot: hsl(h + 60, 45, 92) });
  return p;
}

/**
 * @param o.reduced 動きを減らす（漂うものを出さない・入れ替えをすぐに）
 * @returns { build, draw, scene }
 */
export function makeScenery({ reduced = false } = {}) {
  let cv = null; // いまの景色
  let prev = null; // 入れ替え中の前の景色
  let fade = 1; // 入れ替えの進み（1 で終わり）
  let key = '';
  let sizeKey = '';
  let env = null;
  let scene = sceneOf(1);
  let motes = [];

  const make = (W, H, dpr) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    return c;
  };

  /**
   * 景色を描いておく（変わったときだけ描き直す）
   * @param o { W, H, dpr, G（battleGeometry）, field, stage, dark, cannon: { x, y, r } }
   */
  function build(o) {
    const sc = sceneOf(o.stage);
    const k = `${o.W}x${o.H}@${o.dpr}|${o.field}|${sc.id}|${sc.hue}|${o.dark}`;
    if (k === key) return;
    const sk = `${o.W}x${o.H}@${o.dpr}|${o.field}|${o.dark}`;
    // 大きさが同じで面だけ替わったときは、前の景色から少しずつ入れ替える
    prev = cv && sk === sizeKey && !reduced ? cv : null;
    fade = prev ? 0 : 1;
    key = k;
    sizeKey = sk;
    scene = sc;
    env = o;
    cv = make(o.W, o.H, o.dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    const P = palette(sc, o.dark);
    const R = rnd(o.stage * 7919 + Math.round(o.W) * 31 + Math.round(o.H));
    if (o.field === 'around') paintArena(ctx, o, sc, P, R);
    else paintSide(ctx, o, sc, P, R);
    seedMotes(o, sc, R);
  }

  // ---------------- 横から見た景色（上から） ----------------
  function paintSide(ctx, o, sc, P, R) {
    const { W, H, G } = o;
    const base = G.baseY;
    const hz = base - Math.max(40, base * 0.3); // 遠くの景色の足もと
    // 空
    const sky = ctx.createLinearGradient(0, 0, 0, base);
    sky.addColorStop(0, P.skyTop);
    sky.addColorStop(1, P.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, base);
    // 星（暗い画面と混沌）
    if (o.dark || sc.id === 'chaos') stars(ctx, W, hz, R, o.dark ? 70 : 26, o.dark ? 1 : 0.35);
    if (sc.id === 'chaos') nebula(ctx, W, hz, sc.hue, o.dark, R);
    // 日・月
    sun(ctx, o, sc, P, W * (0.72 + R() * 0.12), sc.id === 'dusk' ? hz - 4 : base * (0.16 + R() * 0.06), Math.max(14, G.g * 2.2));
    // 遠く・なか・手前
    if (sc.id === 'gate') castle(ctx, W, W * (0.3 + R() * 0.4), hz, G.g, P.far, P.mid, R);
    else if (sc.id === 'forest') {
      forest(ctx, W, hz, G.g * 2.4, P.far, R, 0.9);
      forest(ctx, W, hz + G.g * 1.2, G.g * 3.6, P.mid, R, 0.55);
    } else if (sc.id === 'maze') keys(ctx, W, hz, G.g, P.far, P.mid, R);
    else if (sc.id === 'dusk') towers(ctx, W, hz, G.g, P.far, R);
    else if (sc.id === 'king') {
      peaks(ctx, W, hz, G.g * 6, P.far, R);
      darkCastle(ctx, W * (0.35 + R() * 0.3), hz, G.g, P.mid, R);
    } else isles(ctx, W, hz, G.g, P.far, R);
    // 地平線の光（不協和の王は溶岩、夕焼けは日の光）
    if (sc.id === 'king' || sc.id === 'dusk') {
      const gl = ctx.createLinearGradient(0, hz - G.g * 4, 0, hz + G.g);
      gl.addColorStop(0, 'rgb(0 0 0 / 0)');
      gl.addColorStop(1, P.glow);
      ctx.save();
      ctx.globalAlpha = o.dark ? 1 : 0.45;
      ctx.fillStyle = gl;
      ctx.fillRect(0, hz - G.g * 4, W, G.g * 5);
      ctx.restore();
    }
    // 手前の丘（地平線から砦まで。砦に近いほど少し濃く）
    const gr = ctx.createLinearGradient(0, hz, 0, base);
    gr.addColorStop(0, P.ground[0]);
    gr.addColorStop(1, P.ground[1]);
    hills(ctx, W, hz + G.g * 0.6, G.g * 1.6, base, gr, R);
    // 砦の石垣
    wall(ctx, o, P, R);
  }

  function stars(ctx, W, h, R, n, alpha) {
    ctx.save();
    for (let i = 0; i < n; i++) {
      const x = R() * W;
      const y = R() * h * 0.95;
      const r = 0.4 + R() * R() * 1.4;
      ctx.globalAlpha = alpha * (0.25 + R() * 0.65);
      ctx.fillStyle = R() < 0.15 ? '#ffe3b0' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function nebula(ctx, W, h, hue, dark, R) {
    for (let i = 0; i < 3; i++) {
      const x = W * (0.15 + R() * 0.7);
      const y = h * (0.2 + R() * 0.6);
      const r = Math.max(W, h) * (0.25 + R() * 0.2);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, hsl(hue + i * 60, 80, dark ? 45 : 75, dark ? 0.22 : 0.3));
      gr.addColorStop(1, hsl(hue + i * 60, 80, 50, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, h);
    }
  }

  function sun(ctx, o, sc, P, x, y, r) {
    ctx.save();
    const gr = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 4.5);
    gr.addColorStop(0, P.glow);
    gr.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    if (o.dark) {
      // 月（欠けた形）
      ctx.fillStyle = sc.id === 'king' ? '#ff9a7a' : '#f4ecd6';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
      ctx.arc(x + r * 0.35, y - r * 0.2, r * 0.62, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    } else {
      ctx.fillStyle = sc.id === 'dusk' ? '#ffb45e' : sc.id === 'king' ? '#ffd2c2' : '#fffaf0';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x, y, r * (sc.id === 'dusk' ? 1.5 : 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** なだらかな丘。y0 = 丘の高さの真ん中、amp = 起伏、bottom まで塗る */
  function hills(ctx, W, y0, amp, bottom, color, R) {
    const p1 = R() * 6;
    const p2 = R() * 6;
    const f1 = (2 + R() * 2) / W;
    const f2 = (5 + R() * 3) / W;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    for (let x = 0; x <= W + 8; x += 8) ctx.lineTo(x, y0 + Math.sin(x * f1 * Math.PI + p1) * amp * 0.6 + Math.sin(x * f2 * Math.PI + p2) * amp * 0.3);
    ctx.lineTo(W, bottom);
    ctx.closePath();
    ctx.fill();
  }

  /** ハ長調の門：二つの塔と門のある城 */
  function castle(ctx, W, cx, hz, g, far, mid, R) {
    hills(ctx, W, hz - g * 0.5, g * 1.2, hz + g * 3, far, R);
    const w = g * 16;
    const wh = g * 3.4;
    ctx.fillStyle = mid;
    ctx.fillRect(cx - w / 2, hz - wh, w, wh + g);
    // 城壁の凸凹
    for (let x = cx - w / 2; x < cx + w / 2 - g * 0.3; x += g * 1.2) ctx.fillRect(x, hz - wh - g * 0.6, g * 0.7, g * 0.7);
    // 塔（とんがり屋根と旗）
    for (const s of [-1, 1]) {
      const tx = cx + s * (w / 2 - g * 0.6);
      const tw = g * 2.6;
      const th = g * 7.5;
      ctx.fillRect(tx - tw / 2, hz - th, tw, th + g);
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.7, hz - th);
      ctx.lineTo(tx, hz - th - g * 3);
      ctx.lineTo(tx + tw * 0.7, hz - th);
      ctx.fill();
      ctx.fillRect(tx - 0.6, hz - th - g * 4.6, 1.2, g * 1.8);
      ctx.beginPath();
      ctx.moveTo(tx + 0.6, hz - th - g * 4.6);
      ctx.lineTo(tx + g * 1.5, hz - th - g * 4.15);
      ctx.lineTo(tx + 0.6, hz - th - g * 3.7);
      ctx.fill();
    }
    // 門（アーチ。奥の暗がり）
    ctx.save();
    ctx.fillStyle = 'rgb(0 0 0 / 0.22)';
    ctx.beginPath();
    ctx.moveTo(cx - g * 1.6, hz + g);
    ctx.lineTo(cx - g * 1.6, hz - g * 1.4);
    ctx.arc(cx, hz - g * 1.4, g * 1.6, Math.PI, 0);
    ctx.lineTo(cx + g * 1.6, hz + g);
    ctx.fill();
    ctx.restore();
  }

  /** 低音の森：針葉樹を横に並べる */
  function forest(ctx, W, hz, h, color, R, density) {
    ctx.fillStyle = color;
    ctx.fillRect(0, hz - h * 0.15, W, h * 0.4);
    let x = -h * R();
    while (x < W + h) {
      const th = h * (0.7 + R() * 0.6);
      const tw = th * 0.42;
      for (let k = 0; k < 3; k++) {
        const y = hz - th * (0.18 + k * 0.28);
        const ww = tw * (1 - k * 0.24);
        ctx.beginPath();
        ctx.moveTo(x - ww, y + th * 0.12);
        ctx.lineTo(x, y - th * 0.4);
        ctx.lineTo(x + ww, y + th * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      x += tw * (density + R() * 0.8);
    }
  }

  /** 半音の迷宮：鍵盤の白鍵・黒鍵のように、高さと色の違う柱が並ぶ */
  function keys(ctx, W, hz, g, far, mid, R) {
    const kw = g * 2.2;
    const blackOf = [false, true, false, true, false, false, true, false, true, false, true, false];
    let i = Math.floor(R() * 12);
    for (let x = -kw; x < W + kw; x += kw * 0.75) {
      const black = blackOf[i % 12];
      const h = black ? g * (5 + R() * 1.5) : g * (8 + R() * 3);
      ctx.fillStyle = black ? mid : far;
      ctx.fillRect(x, hz - h, kw * (black ? 0.6 : 0.72), h + g);
      // 柱の頭
      ctx.fillRect(x - g * 0.15, hz - h - g * 0.35, kw * (black ? 0.6 : 0.72) + g * 0.3, g * 0.35);
      i++;
    }
    // 柱をつなぐアーチの回廊
    ctx.fillStyle = mid;
    const ay = hz - g * 2.6;
    ctx.fillRect(0, ay, W, g * 0.6);
  }

  /** 三種の調べ：とんがり塔・丸屋根の塔・段々の塔 */
  function towers(ctx, W, hz, g, color, R) {
    hills(ctx, W, hz - g * 0.4, g * 1.4, hz + g * 3, color, R);
    ctx.fillStyle = color;
    const xs = [0.18, 0.5, 0.8].map((k) => W * (k + (R() - 0.5) * 0.08));
    // とんがり塔
    let x = xs[0];
    ctx.fillRect(x - g, hz - g * 8, g * 2, g * 8.5);
    ctx.beginPath();
    ctx.moveTo(x - g * 1.4, hz - g * 8);
    ctx.lineTo(x, hz - g * 13);
    ctx.lineTo(x + g * 1.4, hz - g * 8);
    ctx.fill();
    // 丸屋根の塔
    x = xs[1];
    ctx.fillRect(x - g * 1.6, hz - g * 6, g * 3.2, g * 6.5);
    ctx.beginPath();
    ctx.arc(x, hz - g * 6, g * 1.9, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x - 0.7, hz - g * 9.6, 1.4, g * 1.8);
    // 段々の塔
    x = xs[2];
    for (let k = 0; k < 4; k++) ctx.fillRect(x - g * (2.6 - k * 0.55), hz - g * (k + 1) * 1.6, g * (5.2 - k * 1.1), g * 1.7);
  }

  /** 不協和の王：ぎざぎざの山 */
  function peaks(ctx, W, hz, h, color, R) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, hz + h * 0.2);
    let x = 0;
    while (x < W) {
      const w = h * (0.35 + R() * 0.5);
      ctx.lineTo(x + w * 0.5, hz - h * (0.4 + R() * 0.6));
      ctx.lineTo(x + w * (0.7 + R() * 0.2), hz - h * (0.05 + R() * 0.25));
      x += w;
    }
    ctx.lineTo(W, hz + h * 0.2);
    ctx.closePath();
    ctx.fill();
  }

  /** 不協和の王の城：とげの塔 */
  function darkCastle(ctx, cx, hz, g, color, R) {
    ctx.fillStyle = color;
    const w = g * 14;
    ctx.fillRect(cx - w / 2, hz - g * 3, w, g * 4);
    for (let k = 0; k < 5; k++) {
      const tx = cx - w / 2 + (k + 0.5) * (w / 5);
      const th = g * (k === 2 ? 10 : 5 + R() * 3);
      const tw = g * (k === 2 ? 2.4 : 1.6);
      ctx.fillRect(tx - tw / 2, hz - th, tw, th);
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.75, hz - th);
      ctx.lineTo(tx - tw * 0.45, hz - th - g * 1.2);
      ctx.lineTo(tx, hz - th - g * (k === 2 ? 3.4 : 2.2));
      ctx.lineTo(tx + tw * 0.45, hz - th - g * 1.2);
      ctx.lineTo(tx + tw * 0.75, hz - th);
      ctx.fill();
    }
  }

  /** 混沌：浮かぶ島 */
  function isles(ctx, W, hz, g, color, R) {
    ctx.fillStyle = color;
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const x = W * ((i + 0.3 + R() * 0.4) / n);
      const y = hz - g * (2 + R() * 9);
      const w = g * (3 + R() * 4);
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x, y - g * 0.9, x + w, y);
      ctx.lineTo(x + w * 0.3, y + w * 0.6);
      ctx.lineTo(x, y + w * 0.9);
      ctx.lineTo(x - w * 0.35, y + w * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    hills(ctx, W, hz, g * 1.5, hz + g * 3, color, R);
  }

  /** 砦の石垣（上から）。上の縁に凸凹、真ん中に砲台の丸い台 */
  function wall(ctx, o, P, R) {
    const { W, H, G } = o;
    const top = G.baseY;
    const mh = Math.max(4, G.g * 0.7); // 凸凹の高さ
    ctx.save();
    // 凸凹（上の縁から上へ）
    ctx.fillStyle = P.stone;
    const mw = Math.max(10, G.g * 1.8);
    for (let x = 4; x < W; x += mw * 1.7) ctx.fillRect(x, top - mh, mw, mh + 1);
    // 石垣
    ctx.fillRect(0, top, W, H - top);
    // 石の目地
    ctx.strokeStyle = P.stoneLine;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    const rh = Math.max(9, (H - top) / 4);
    ctx.beginPath();
    for (let y = top + rh, r = 0; y < H; y += rh, r++) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      const bw = rh * 2.6;
      for (let x = (r % 2 ? bw / 2 : 0) + R() * 4; x < W; x += bw) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, Math.min(H, y + rh));
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 上の縁の影
    const sh = ctx.createLinearGradient(0, top, 0, top + 6);
    sh.addColorStop(0, 'rgb(0 0 0 / 0.16)');
    sh.addColorStop(1, 'rgb(0 0 0 / 0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, top, W, 6);
    // 砲台の台（丸い石の台）
    const c = o.cannon;
    ctx.fillStyle = P.stone;
    ctx.strokeStyle = P.stoneLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- 上から見た広場（四方から） ----------------
  function paintArena(ctx, o, sc, P, R) {
    const { W, H, G } = o;
    const { fx, fy, ring } = G.geo;
    const far = Math.hypot(W, H) / 2;
    const fl = ctx.createRadialGradient(fx, fy, ring, fx, fy, far);
    fl.addColorStop(0, P.floor0);
    fl.addColorStop(1, P.floor1);
    ctx.fillStyle = fl;
    ctx.fillRect(0, 0, W, H);
    if (sc.id === 'chaos') {
      nebula(ctx, W, H, sc.hue, o.dark, R);
      stars(ctx, W, H, R, o.dark ? 90 : 30, o.dark ? 1 : 0.35);
    } else if (o.dark) stars(ctx, W, H, R, 24, 0.45);
    // 地面の模様（道と砦のそばは避ける）
    const lanes = G.geo.lanes;
    const keep = Math.max(G.unitW, G.unitH) * 0.45;
    const free = (x, y) => Math.hypot(x - fx, y - fy) > ring + G.g * 5 && lanes.every((L) => segDist(x, y, L.x0, L.y0, fx, fy) > keep);
    ctx.save();
    ctx.fillStyle = P.mark;
    ctx.strokeStyle = P.mark;
    const n = Math.round((W * H) / (G.g * G.g * 30));
    for (let i = 0; i < n; i++) {
      const x = R() * W;
      const y = R() * H;
      if (!free(x, y)) continue;
      floorMark(ctx, sc.id, x, y, G.g, R, o.dark);
    }
    ctx.restore();
    // 砦へ向かう道
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.road;
    ctx.lineWidth = Math.max(8, G.unitW * 0.22);
    ctx.beginPath();
    for (const L of lanes) {
      ctx.moveTo(L.x0, L.y0);
      ctx.lineTo(fx, fy);
    }
    ctx.stroke();
    ctx.restore();
    // 砦の石の台
    ctx.save();
    ctx.fillStyle = P.stone;
    ctx.strokeStyle = P.stoneLine;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = o.dark ? 'rgb(0 0 0 / 0.6)' : 'rgb(60 40 10 / 0.2)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(fx, fy, ring + G.g * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    // 台の縁の石（8 つに区切る）
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.moveTo(fx + Math.cos(a) * (ring + G.g * 0.2), fy + Math.sin(a) * (ring + G.g * 0.2));
      ctx.lineTo(fx + Math.cos(a) * (ring + G.g * 0.9), fy + Math.sin(a) * (ring + G.g * 0.9));
    }
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
  }

  function floorMark(ctx, id, x, y, g, R, dark) {
    if (id === 'gate') {
      // 石だたみ（小さな丸い石）
      if (R() < 0.5) return;
      const w = g * (0.35 + R() * 0.4);
      ctx.beginPath();
      ctx.ellipse(x, y, w, w * 0.6, R() * 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === 'forest') {
      // 木のこずえ（上から見た丸い葉の固まり。まばらに）
      if (R() < 0.7) return;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(x + (R() - 0.5) * g * 1.6, y + (R() - 0.5) * g * 1.6, g * (0.6 + R() * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (id === 'maze') {
      // 迷路の壁（格子にそろえる）
      const c = g * 5;
      const gx = Math.round(x / c) * c;
      const gy = Math.round(y / c) * c;
      ctx.lineWidth = Math.max(2, g * 0.45);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      if (R() < 0.5) ctx.lineTo(gx + c, gy);
      else ctx.lineTo(gx, gy + c);
      ctx.stroke();
    } else if (id === 'dusk') {
      // 砂の波
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - g * 2, y);
      ctx.quadraticCurveTo(x, y - g * 0.8, x + g * 2, y);
      ctx.stroke();
    } else if (id === 'king') {
      // 地割れ（暗い画面では溶岩の色。まばらに）
      if (R() < 0.6) return;
      ctx.save();
      ctx.lineWidth = 1.4;
      if (dark) ctx.strokeStyle = 'rgb(255 110 50 / 0.35)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x;
      let py = y;
      for (let k = 0; k < 4; k++) {
        px += (R() - 0.5) * g * 3;
        py += (R() - 0.5) * g * 3;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, g * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const segDist = (px, py, x0, y0, x1, y1) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l));
    return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
  };

  // ---------------- 漂うもの ----------------
  function seedMotes(o, sc, R) {
    if (reduced) {
      motes = [];
      return;
    }
    const kind = MOTE_OF[sc.id];
    const n = Math.round(Math.min(26, Math.max(10, (o.W * o.H) / 24000)));
    const top = o.field === 'around' ? o.H : o.G.baseY;
    motes = Array.from({ length: n }, (_, i) => ({
      kind, x: R() * o.W, y: R() * top, ph: R() * Math.PI * 2, sp: 0.5 + R(), size: 0.7 + R() * 0.8,
      color: kind === 'note' || kind === 'star' ? NOTE_COLORS[(i * 5) % 12] : null,
    }));
  }

  function drawMotes(ctx, dt, t) {
    if (!motes.length || !env) return;
    const { W, H, G, field, dark } = env;
    const bottom = field === 'around' ? H : G.baseY;
    ctx.save();
    for (const m of motes) {
      const k = m.kind;
      if (k === 'note' || k === 'ember') m.y -= (k === 'ember' ? 26 : 9) * m.sp * dt;
      else if (k === 'dust') m.x += 14 * m.sp * dt;
      else if (k === 'firefly') {
        m.x += Math.cos(t * 0.7 * m.sp + m.ph) * 10 * dt;
        m.y += Math.sin(t * 0.9 * m.sp + m.ph * 2) * 8 * dt;
      }
      if (m.y < -10) m.y = bottom + 6;
      if (m.y > bottom + 8) m.y = -6;
      if (m.x > W + 10) m.x = -8;
      if (m.x < -10) m.x = W + 8;
      const sway = Math.sin(t * 1.3 * m.sp + m.ph);
      if (k === 'note') {
        ctx.globalAlpha = dark ? 0.32 : 0.22;
        noteMark(ctx, m.x + sway * 6, m.y, G.g * 0.55 * m.size, m.color);
      } else if (k === 'firefly') {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 * m.sp + m.ph));
        ctx.globalAlpha = a * (dark ? 0.95 : 0.6);
        const s = G.g * 1.6 * m.size;
        ctx.drawImage(glowSprite(dark ? 'rgb(214 255 120)' : 'rgb(150 200 40)'), m.x - s / 2, m.y - s / 2, s, s);
      } else if (k === 'sparkle') {
        const a = Math.max(0, Math.sin(t * 1.8 * m.sp + m.ph));
        ctx.globalAlpha = a * (dark ? 0.8 : 0.55);
        sparkle(ctx, m.x, m.y, G.g * 0.7 * m.size * (0.6 + a * 0.4), dark ? '#e7d4ff' : '#9a5ad8');
      } else if (k === 'dust') {
        ctx.globalAlpha = (dark ? 0.35 : 0.3) * (0.6 + 0.4 * sway);
        ctx.fillStyle = dark ? '#ffd9a0' : '#c98a3a';
        ctx.beginPath();
        ctx.arc(m.x, m.y + sway * 4, 1.1 * m.size + 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === 'ember') {
        const a = 0.5 + 0.5 * Math.sin(t * 6 * m.sp + m.ph);
        ctx.globalAlpha = (dark ? 0.9 : 0.55) * (0.4 + 0.6 * a) * Math.min(1, m.y / (bottom * 0.5));
        const s = G.g * 0.9 * m.size;
        ctx.drawImage(glowSprite('rgb(255 120 40)'), m.x + sway * 5 - s / 2, m.y - s / 2, s, s);
      } else {
        const a = 0.3 + 0.7 * Math.max(0, Math.sin(t * 1.5 * m.sp + m.ph));
        ctx.globalAlpha = a * (dark ? 0.85 : 0.45);
        sparkle(ctx, m.x, m.y, G.g * 0.45 * m.size, m.color);
      }
    }
    ctx.restore();
  }

  /**
   * 景色と漂うものを描く（ctx は画面の px の座標）
   * @param o.dim ボス戦などで景色を暗くする割合（0〜1）
   */
  function draw(ctx, dt, t, { dim = 0 } = {}) {
    if (!cv || !env) return;
    const { W, H } = env;
    if (prev && fade < 1) {
      fade = Math.min(1, fade + dt / 1.1);
      ctx.drawImage(prev, 0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.drawImage(cv, 0, 0, W, H);
      ctx.restore();
      if (fade >= 1) prev = null;
    } else ctx.drawImage(cv, 0, 0, W, H);
    drawMotes(ctx, dt, t);
    if (dim > 0) {
      ctx.save();
      ctx.fillStyle = env.dark ? `rgb(0 0 0 / ${0.35 * dim})` : `rgb(40 10 30 / ${0.14 * dim})`;
      ctx.fillRect(0, 0, W, env.field === 'around' ? H : env.G.baseY - Math.max(4, env.G.g * 0.7));
      ctx.restore();
    }
  }

  return { build, draw, scene: () => scene };
}

/** 光の玉の絵（色ごとに 1 回だけ作り、drawImage で使い回す。shadowBlur より軽い） */
const sprites = new Map();
export function glowSprite(color) {
  let s = sprites.get(color);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 48;
  const c = s.getContext('2d');
  const gr = c.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, 'rgb(255 255 255 / 1)');
  gr.addColorStop(0.3, 'rgb(255 255 255 / 0.55)');
  gr.addColorStop(1, 'rgb(255 255 255 / 0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 48, 48);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, 48, 48);
  sprites.set(color, s);
  return s;
}

/** 小さな音符の印（♪ の形）。漂うものと、命中の破片に使う */
export function noteMark(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.72, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.28);
  ctx.beginPath();
  ctx.moveTo(x + r * 0.85, y - r * 0.2);
  ctx.lineTo(x + r * 0.85, y - r * 3);
  ctx.quadraticCurveTo(x + r * 1.6, y - r * 2.4, x + r * 2, y - r * 1.6);
  ctx.stroke();
}

/** 4 つの角のきらめき */
export function sparkle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.15, y - r * 0.15, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.15, y + r * 0.15, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.15, y + r * 0.15, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.15, y - r * 0.15, x, y - r);
  ctx.fill();
}
