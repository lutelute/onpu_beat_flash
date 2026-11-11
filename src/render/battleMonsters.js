// オトバトルの敵の姿（canvas）。五線の札を両手で抱えた怪物。
// 札（五線と音符）は render/notation.js が描くので、ここは札の「うしろ」（体・頭・足）と「まえ」（手）だけ。
// 楽譜が読みにくくならないよう、札の中には何も重ねない（手は札の縁にかかるだけ）。
//
// 表情：ふだん → 近づくと怒る（眉と赤い目、口を開ける）→ 外されたとき（責められた敵）はびくっとして目をつぶる → 倒されると目が × になる。
// 目は砲台のほうを見て、ときどきまばたきする。

// 体の色（明るい画面 / 暗い画面）。ふつうの敵は 4 種類、隊列は兵隊、ボスの手下とボスは赤黒い
const BODY = {
  light: { drop: ['#4b2f7a', '#1f5c50', '#8c2f22', '#27467a'], row: '#6e1835', minion: '#5e1028', boss: '#4a0f22' },
  dark: { drop: ['#7d5cc0', '#3a9a85', '#cc5a43', '#5a82c8'], row: '#b73a63', minion: '#a52e55', boss: '#8a2246' },
};
const EYE = { white: '#ffe7a3', pupil: '#16110f', glow: '#ff4b3a' };

/** 種から 0〜1 の決まった数（敵ごとに、まばたきの間合いや形を変える） */
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function makeMonsters(ctx, { reduced = false } = {}) {
  /** まばたき中か（敵ごとに 2.6〜4.6 秒に 1 回、0.12 秒） */
  const blinking = (t, seed) => {
    const every = 2.6 + hash(seed) * 2;
    return (t + hash(seed + 1) * every) % every < 0.12;
  };

  /**
   * つり上がった目（s = -1 左目 / 1 右目）。瞳は縦長で、look のほうを向く
   * mood: calm（にらむ）・angry（赤く光る）・hurt（> <）・dead（×）
   */
  function eye(x, y, r, s, look, { blink, mood }) {
    ctx.save();
    ctx.lineCap = 'round';
    if (mood === 'dead') {
      ctx.strokeStyle = EYE.pupil;
      ctx.lineWidth = Math.max(1.6, r * 0.38);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.6, y + r * 0.6);
      ctx.moveTo(x + r * 0.6, y - r * 0.6);
      ctx.lineTo(x - r * 0.6, y + r * 0.6);
      ctx.stroke();
    } else if (blink || mood === 'hurt') {
      ctx.strokeStyle = EYE.pupil;
      ctx.lineWidth = Math.max(1.6, r * 0.34);
      ctx.beginPath();
      if (mood === 'hurt') {
        // びくっとした「> <」
        ctx.moveTo(x - s * r * 0.7, y - r * 0.5);
        ctx.lineTo(x + s * r * 0.5, y);
        ctx.lineTo(x - s * r * 0.7, y + r * 0.5);
      } else {
        ctx.moveTo(x - r, y - s * r * 0.1);
        ctx.lineTo(x + r, y + s * r * 0.1);
      }
      ctx.stroke();
    } else {
      // 目の形：内側（鼻のほう）が下がった、にらむ形
      const tilt = s * 0.32;
      if (mood === 'angry' && !reduced) {
        ctx.shadowColor = EYE.glow;
        ctx.shadowBlur = r * 2.2;
      }
      ctx.fillStyle = mood === 'angry' ? '#ff8a6e' : EYE.white;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.15, r * 0.72, tilt, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // まぶた（上をまっすぐ切って、目つきを悪く）
      ctx.fillStyle = 'rgb(0 0 0 / 0.0)';
      const d = Math.hypot(look.x - x, look.y - y) || 1;
      const k = r * 0.42;
      ctx.fillStyle = EYE.pupil;
      ctx.beginPath();
      ctx.ellipse(x + ((look.x - x) / d) * k, y + ((look.y - y) / d) * k * 0.5, r * 0.24, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 眉（いつもしかめている。angry ではもっと強く） */
  function brows(x, y, r, gap, color, strong) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.8, r * (strong ? 0.5 : 0.38));
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of [-1, 1]) {
      const ex = x + s * gap;
      ctx.moveTo(ex + s * r * 1.15, y - r * (strong ? 1.35 : 1.15));
      ctx.lineTo(ex - s * r * 0.85, y - r * (strong ? 0.55 : 0.7));
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 角（2 本）。big = ボスの太い角 */
  function horns(x, by, rx, g, color, big = false) {
    ctx.fillStyle = color;
    const k = big ? 1.5 : 1; // ボスの角の大きさは core/battleLayout.js の MONSTER.bossHead と合わせてある
    for (const s of [-1, 1]) {
      const bx = x + s * rx * 0.55;
      ctx.beginPath();
      ctx.moveTo(bx - s * g * 0.45 * k, by);
      ctx.quadraticCurveTo(bx + s * g * 0.55 * k, by - g * 0.9 * k, bx + s * g * 0.95 * k, by - g * 1.6 * k);
      ctx.quadraticCurveTo(bx + s * g * 0.25 * k, by - g * 0.75 * k, bx + s * g * 0.42 * k, by + g * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** 牙のある口（札の上の縁から上に見える）。open = 大きく開ける */
  function mouth(x, y, w, g, open) {
    const h = g * (open ? 0.62 : 0.36);
    ctx.save();
    ctx.fillStyle = '#1a0a0e';
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - h * 2.1, x + w, y);
    ctx.closePath();
    ctx.fill();
    // 上の牙（ぎざぎざ）
    ctx.fillStyle = '#fff6e6';
    const n = 4;
    for (let i = 0; i < n; i++) {
      const fx = x - w * 0.72 + (i * w * 1.44) / (n - 1);
      const top = y - h * (1.05 - Math.abs(i - (n - 1) / 2) * 0.18);
      ctx.beginPath();
      ctx.moveTo(fx - g * 0.17, top);
      ctx.lineTo(fx + g * 0.17, top);
      ctx.lineTo(fx, top + g * (i === 0 || i === n - 1 ? 0.42 : 0.3));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 札のうしろ（体・頭・足）。x, y = 札の真ん中、w・h = 札の大きさ、g = 線の間隔
   * @param o.kind   'drop' | 'row' | 'minion'
   * @param o.seed   敵ごとの番号（形・色・まばたき）
   * @param o.look   目が見る点 { x, y }
   * @param o.mood   'calm' | 'angry' | 'hurt' | 'dead'
   * @param o.t      時刻（秒）
   * @param o.dark   暗い画面
   * @returns 体の色（手を同じ色で描く）
   */
  function back(x, y, w, h, g, { kind = 'drop', seed = 0, look, mood = 'calm', t = 0, dark = false }) {
    const pal = dark ? BODY.dark : BODY.light;
    const variety = Math.floor(hash(seed + 7) * 4);
    const body = kind === 'row' ? pal.row : kind === 'minion' ? pal.minion : pal.drop[variety];
    // 怒ると震える
    const shiver = mood === 'angry' && !reduced ? Math.sin(t * 40 + seed) * g * 0.06 : 0;
    const bob = reduced ? 0 : Math.sin(t * 5 + seed) * g * 0.12;
    const top = y - h / 2; // 札の上端
    const bottom = y + h / 2;
    const rx = Math.min(w * 0.44, g * 3.8);
    const ry = g * 1.95; // 頭は高く（札から上に大きく出す）
    const hx = x + shiver;
    const hy = top - g * 0.75 + bob; // 頭の真ん中
    const sw = w / 2 + g * 0.42; // 肩幅の半分（札より少し広く、両側に肩と腕が見える）
    ctx.save();
    ctx.lineJoin = 'round';
    // 影（足もと）
    ctx.fillStyle = 'rgb(0 0 0 / 0.14)';
    ctx.beginPath();
    ctx.ellipse(x, bottom + g * 0.7, w * 0.42, g * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // 足（爪つきで、のしのし歩く）
    ctx.fillStyle = body;
    for (const s of [-1, 1]) {
      const step = reduced ? 0 : Math.max(0, Math.sin(t * 8 + seed + (s > 0 ? Math.PI : 0))) * g * 0.25;
      const fx = x + s * w * 0.25;
      const fy = bottom + g * 0.3 - step;
      ctx.beginPath();
      ctx.ellipse(fx, fy, g * 0.95, g * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f3e6cf';
      for (const c of [-0.45, 0, 0.45]) {
        ctx.beginPath();
        ctx.moveTo(fx + c * g - g * 0.11, fy + g * 0.25);
        ctx.lineTo(fx + c * g + g * 0.11, fy + g * 0.25);
        ctx.lineTo(fx + c * g, fy + g * 0.58);
        ctx.fill();
      }
      ctx.fillStyle = body;
    }
    // 頭の飾り（種類で変える）：0 = トゲの背、1 = 角、2 = 一本角、3 = こうもりの耳。手下は角、隊列はかぶと
    const hornY = hy - ry * 0.55;
    if (kind === 'minion' || (kind === 'drop' && variety === 1)) horns(hx, hornY, rx, g, body);
    else if (kind === 'drop' && variety === 0) {
      ctx.beginPath();
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + ((i + 0.5) / n) * Math.PI;
        const bx = hx + Math.cos(a) * rx * 0.92;
        const by = hy + Math.sin(a) * ry * 0.92;
        const tx = hx + Math.cos(a) * (rx + g * 0.75);
        const ty = hy + Math.sin(a) * (ry + g * 0.75);
        const da = 0.17;
        ctx.moveTo(hx + Math.cos(a - da) * rx * 0.92, hy + Math.sin(a - da) * ry * 0.92);
        ctx.lineTo(tx, ty);
        ctx.lineTo(hx + Math.cos(a + da) * rx * 0.92, hy + Math.sin(a + da) * ry * 0.92);
        ctx.lineTo(bx, by);
      }
      ctx.fill();
    } else if (kind === 'drop' && variety === 2) {
      ctx.beginPath();
      ctx.moveTo(hx - g * 0.4, hy - ry * 0.85);
      ctx.lineTo(hx + g * 0.15, hy - ry - g * 1.25);
      ctx.lineTo(hx + g * 0.45, hy - ry * 0.85);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'drop' && variety === 3) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + s * rx * 0.3, hy - ry * 0.75);
        ctx.lineTo(hx + s * rx * 1.05, hy - ry * 1.45);
        ctx.lineTo(hx + s * rx * 0.95, hy - ry * 0.65);
        ctx.lineTo(hx + s * rx * 0.75, hy - ry * 0.85);
        ctx.closePath();
        ctx.fill();
      }
    }
    // 頭と体（札のうしろ）。肩は札より広く、腕は札の両脇を通って手で札をつかむ
    ctx.beginPath();
    ctx.ellipse(hx, hy, rx, ry, 0, Math.PI, 0);
    ctx.quadraticCurveTo(x + sw, top - g * 0.2, x + sw, top + g * 0.6);
    ctx.lineTo(x + sw - g * 0.1, bottom - g * 0.3);
    ctx.lineTo(x - sw + g * 0.1, bottom - g * 0.3);
    ctx.lineTo(x - sw, top + g * 0.6);
    ctx.quadraticCurveTo(x - sw, top - g * 0.2, hx - rx, hy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgb(0 0 0 / 0.35)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // 胸のあたりの影（体に厚みを出す）
    ctx.fillStyle = 'rgb(0 0 0 / 0.12)';
    ctx.beginPath();
    ctx.ellipse(hx, hy + ry * 0.55, rx * 0.8, ry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = body;
    if (kind === 'row') {
      // 兵隊のかぶと（目のところだけ細く開いている）
      ctx.fillStyle = dark ? '#2b2228' : '#231a1f';
      ctx.beginPath();
      ctx.ellipse(hx, hy + ry * 0.05, rx * 1.04, ry * 1.02, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - g * 0.3, hy - ry * 0.95);
      ctx.lineTo(hx, hy - ry - g * 0.9);
      ctx.lineTo(hx + g * 0.3, hy - ry * 0.95);
      ctx.fill();
      // 目の細い窓から赤く光る目
      const vy = hy - ry * 0.3;
      ctx.fillStyle = '#120c0f';
      ctx.fillRect(hx - rx * 0.8, vy - g * 0.32, rx * 1.6, g * 0.64);
      ctx.save();
      if (!reduced) {
        ctx.shadowColor = EYE.glow;
        ctx.shadowBlur = g * 0.9;
      }
      ctx.fillStyle = mood === 'dead' ? '#5a4a4a' : EYE.glow;
      const blink = mood === 'calm' && blinking(t, seed);
      for (const s of [-1, 1]) {
        if (!blink) ctx.fillRect(hx + s * rx * 0.38 - g * 0.32, vy - g * 0.13, g * 0.64, g * 0.26);
      }
      ctx.restore();
      mouth(hx, top - 0.5, Math.min(rx * 0.55, g * 1.6), g, mood === 'angry');
      ctx.restore();
      return body;
    }
    // 目・眉・口
    const er = g * 0.52;
    const gap = Math.min(rx * 0.45, g * 1.25);
    const ey = hy - ry * 0.25;
    const blink = mood === 'calm' && blinking(t, seed);
    for (const s of [-1, 1]) eye(hx + s * gap, ey, er, s, look, { blink, mood });
    if (mood !== 'dead') brows(hx, ey, er, gap, '#120c0f', mood === 'angry');
    mouth(hx, top - 0.5, Math.min(rx * 0.55, g * 1.6), g, mood === 'angry');
    ctx.restore();
    return body;
  }

  /** 札のまえ（札の縁をつかむ、爪のある手） */
  function front(x, y, w, h, g, { body }) {
    ctx.save();
    for (const s of [-1, 1]) {
      const hx = x + s * (w / 2 + g * 0.05);
      const hy = y - h * 0.18;
      ctx.fillStyle = body;
      ctx.strokeStyle = 'rgb(0 0 0 / 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(hx, hy, g * 0.46, g * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 札にかかる爪（札の縁の余白の中だけ）
      ctx.fillStyle = '#f3e6cf';
      for (const c of [-0.32, 0.05, 0.42]) {
        const cy = hy + c * g;
        ctx.beginPath();
        ctx.moveTo(hx - s * g * 0.2, cy - g * 0.1);
        ctx.lineTo(hx - s * g * 0.2, cy + g * 0.1);
        ctx.lineTo(hx - s * g * 0.62, cy + g * 0.02);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** ボスの魔物：札の上に大きな頭と太い角、赤く光る目と牙。x = 札の真ん中、top = 札の上端、w = 札の幅 */
  function bossBack(x, top, w, g, { look, t = 0, dark = false, hurt = 0 }) {
    const body = dark ? BODY.dark.boss : BODY.light.boss;
    const rx = Math.min(w * 0.36, g * 7.5);
    const ry = g * 2.7;
    const bob = reduced ? 0 : Math.sin(t * 2.4) * g * 0.15;
    const hy = top - g * 0.5 + bob;
    ctx.save();
    horns(x, hy - ry * 0.6, rx * 1.3, g, body, true);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, hy, rx, ry, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgb(0 0 0 / 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const er = g * 0.75;
    const gap = rx * 0.4;
    const ey = hy - ry * 0.5;
    for (const s of [-1, 1]) eye(x + s * gap, ey, er, s, look, { blink: false, mood: hurt > 0 ? 'hurt' : 'angry' });
    brows(x, ey, er, gap, '#120c0f', true);
    mouth(x, top - 0.5, Math.min(rx * 0.6, g * 3), g * 1.3, hurt <= 0);
    ctx.restore();
    return body;
  }

  return { back, front, bossBack };
}
